// ════════════════════════════════════════════════════════════════
// RAG Indexer
// ════════════════════════════════════════════════════════════════

import { getRepoTree, batchGetFileContents, splitRepoName } from '@/lib/github'
import { chunkFile, estimateTokens } from '@/lib/rag/chunker'
import { embedBatch } from '@/lib/ai/gemini'
import {
  deleteProjectChunks,
  deleteFileChunks,
  insertChunks,
  updateProjectIndexStatus,
} from '@/lib/supabase'
import type { RepoFile } from '@/types'

export interface IndexProgress {
  phase: 'tree' | 'fetch' | 'chunk' | 'embed' | 'store' | 'done' | 'error'
  filesTotal: number
  filesDone: number
  chunksTotal: number
  message: string
}

export type ProgressCallback = (progress: IndexProgress) => void

// ── File prioritisation ───────────────────────────────────────────
// Index the most architecturally important files first.
// Keeps quality high even when we cap file count for timeout safety.

const PRIORITY_SEGMENTS = [
  'types', 'type', 'interface', 'schema',
  'lib', 'utils', 'helper', 'constants',
  'auth', 'middleware', 'config',
  'api', 'route', 'server',
  'model', 'store', 'hook',
]

function fileImportanceScore(path: string): number {
  const lower = path.toLowerCase()
  const parts = lower.split('/')
  let score = 0
  for (const seg of parts) {
    const idx = PRIORITY_SEGMENTS.indexOf(seg)
    if (idx >= 0) score += (PRIORITY_SEGMENTS.length - idx)
  }
  // Penalise deeply nested files
  score -= Math.max(0, parts.length - 4) * 2
  return score
}

function prioritiseFiles(files: RepoFile[], max: number): RepoFile[] {
  const sorted = [...files].sort(
    (a, b) => fileImportanceScore(b.path) - fileImportanceScore(a.path)
  )
  return sorted.slice(0, max)
}

// ── Full repo index ───────────────────────────────────────────────

// Keep under Vercel Hobby 60s limit.
// Pro plan can raise this to 200+.
const MAX_FILES = 40

export async function indexRepository(
  projectId: string,
  repoFullName: string,
  defaultBranch: string,
  accessToken: string,
  onProgress?: ProgressCallback
): Promise<{ chunksIndexed: number }> {
  const { owner, repo } = splitRepoName(repoFullName)

  const report = (p: Partial<IndexProgress> & Pick<IndexProgress, 'phase' | 'message'>) => {
    onProgress?.({
      filesTotal: 0,
      filesDone: 0,
      chunksTotal: 0,
      ...p,
    })
  }

  try {
    await updateProjectIndexStatus(projectId, 'indexing')

    // 1. Get file tree
    report({ phase: 'tree', message: 'Fetching repo file tree…' })
    const allFiles = await getRepoTree(accessToken, owner, repo, defaultBranch)

    // Prioritise important files; cap to stay within timeout
    const files = prioritiseFiles(allFiles, MAX_FILES)
    const capped = allFiles.length > MAX_FILES
    report({
      phase: 'fetch',
      filesTotal: files.length,
      message: `Indexing ${files.length} of ${allFiles.length} files${capped ? ' (prioritised by importance)' : ''}`,
    })

    // 2. Clear existing chunks
    await deleteProjectChunks(projectId)

    // 3. Fetch file contents (concurrency 8 for speed)
    const contentMap = await batchGetFileContents(
      accessToken, owner, repo, files, 8,
      (done, total) => report({
        phase: 'fetch',
        filesDone: done,
        filesTotal: total,
        message: `Fetching files… ${done}/${total}`,
      })
    )

    // 4. Chunk all files
    report({ phase: 'chunk', filesTotal: files.length, message: 'Chunking code…' })
    const allChunks: Array<{
      filePath: string
      chunkIndex: number
      content: string
      language: string
      startLine: number | null
      endLine: number | null
      tokenCount: number | null
    }> = []

    for (const [filePath, content] of contentMap) {
      chunkFile(filePath, content).forEach((chunk, idx) => {
        allChunks.push({
          filePath: chunk.filePath,
          chunkIndex: idx,
          content: chunk.content,
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          tokenCount: estimateTokens(chunk.content),
        })
      })
    }

    report({
      phase: 'embed',
      chunksTotal: allChunks.length,
      message: `Embedding ${allChunks.length} chunks…`,
    })

    // 5. Embed ALL chunks in one embedBatch call.
    //    embedBatch handles internal batching (100/call) + rate-limit backoff.
    const allEmbeddings = await embedBatch(allChunks.map((c) => c.content))

    // 6. Store in Supabase in chunks of 100
    report({
      phase: 'store',
      chunksTotal: allChunks.length,
      message: `Storing ${allChunks.length} chunks…`,
    })

    const STORE_BATCH = 100
    const rows = allChunks.map((chunk, i) => ({
      projectId,
      filePath: chunk.filePath,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      summary: null,
      language: chunk.language,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      tokenCount: chunk.tokenCount,
      embedding: allEmbeddings[i],
    }))

    for (let i = 0; i < rows.length; i += STORE_BATCH) {
      await insertChunks(rows.slice(i, i + STORE_BATCH))
    }

    await updateProjectIndexStatus(projectId, 'ready', new Date())
    report({
      phase: 'done',
      chunksTotal: allChunks.length,
      message: `✓ Indexed ${allChunks.length} chunks from ${contentMap.size} files`,
    })

    return { chunksIndexed: allChunks.length }
  } catch (err) {
    await updateProjectIndexStatus(projectId, 'error')
    report({ phase: 'error', message: String(err) })
    throw err
  }
}

// ── Incremental re-index (after a task runs) ──────────────────────

export async function reindexChangedFiles(
  projectId: string,
  repoFullName: string,
  accessToken: string,
  changedFiles: string[],
  defaultBranch: string
): Promise<void> {
  if (changedFiles.length === 0) return
  const { owner, repo } = splitRepoName(repoFullName)
  const { getFileContent } = await import('@/lib/github')

  for (const filePath of changedFiles) {
    const content = await getFileContent(accessToken, owner, repo, filePath, defaultBranch)
    if (!content) {
      await deleteFileChunks(projectId, filePath)
      continue
    }
    await deleteFileChunks(projectId, filePath)
    const rawChunks = chunkFile(filePath, content)
    if (rawChunks.length === 0) continue
    const embeddings = await embedBatch(rawChunks.map((c) => c.content))
    await insertChunks(
      rawChunks.map((chunk, idx) => ({
        projectId,
        filePath: chunk.filePath,
        chunkIndex: idx,
        content: chunk.content,
        summary: null,
        language: chunk.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        tokenCount: estimateTokens(chunk.content),
        embedding: embeddings[idx],
      }))
    )
  }
}
