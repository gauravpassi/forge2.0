// ════════════════════════════════════════════════════════════════
// RAG Indexer
// Indexes an entire repo into pgvector knowledge base.
// Also supports incremental re-indexing of changed files.
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

export interface IndexProgress {
  phase: 'tree' | 'fetch' | 'chunk' | 'embed' | 'store' | 'done' | 'error'
  filesTotal: number
  filesDone: number
  chunksTotal: number
  message: string
}

export type ProgressCallback = (progress: IndexProgress) => void

// ── Full repo index ───────────────────────────────────────────────

export async function indexRepository(
  projectId: string,
  repoFullName: string,
  defaultBranch: string,
  accessToken: string,
  onProgress?: ProgressCallback
): Promise<{ chunksIndexed: number }> {
  const { owner, repo } = splitRepoName(repoFullName)
  const report = (p: Omit<IndexProgress, 'filesTotal' | 'filesDone' | 'chunksTotal'> & Partial<IndexProgress>) => {
    onProgress?.({
      filesTotal: p.filesTotal ?? 0,
      filesDone: p.filesDone ?? 0,
      chunksTotal: p.chunksTotal ?? 0,
      ...p,
    } as IndexProgress)
  }

  try {
    await updateProjectIndexStatus(projectId, 'indexing')

    // 1. Get file tree
    report({ phase: 'tree', message: 'Fetching repo file tree…' })
    const files = await getRepoTree(accessToken, owner, repo, defaultBranch)
    report({ phase: 'fetch', filesTotal: files.length, message: `Found ${files.length} indexable files` })

    // 2. Clear existing chunks
    await deleteProjectChunks(projectId)

    // 3. Fetch file contents in parallel batches
    const contentMap = await batchGetFileContents(
      accessToken,
      owner,
      repo,
      files,
      5,
      (done, total) => {
        report({ phase: 'fetch', filesDone: done, filesTotal: total, message: `Fetching files… ${done}/${total}` })
      }
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
      const rawChunks = chunkFile(filePath, content)
      rawChunks.forEach((chunk, idx) => {
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

    report({ phase: 'embed', chunksTotal: allChunks.length, message: `Embedding ${allChunks.length} chunks…` })

    // 5. Embed in batches and store
    const EMBED_BATCH = 20
    const STORE_BATCH = 100
    let stored = 0
    const rowBuffer: Parameters<typeof insertChunks>[0] = []

    for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
      const batch = allChunks.slice(i, i + EMBED_BATCH)
      const embeddings = await embedBatch(batch.map((c) => c.content))

      batch.forEach((chunk, j) => {
        rowBuffer.push({
          projectId,
          filePath: chunk.filePath,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          summary: null, // generated on-demand during search if needed
          language: chunk.language,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          tokenCount: chunk.tokenCount,
          embedding: embeddings[j],
        })
      })

      stored += batch.length
      report({
        phase: 'store',
        chunksTotal: allChunks.length,
        filesDone: stored,
        filesTotal: allChunks.length,
        message: `Embedding & storing… ${stored}/${allChunks.length} chunks`,
      })

      // Flush to DB in batches
      if (rowBuffer.length >= STORE_BATCH) {
        await insertChunks(rowBuffer.splice(0, STORE_BATCH))
      }
    }

    // Flush remaining
    if (rowBuffer.length > 0) {
      await insertChunks(rowBuffer)
    }

    await updateProjectIndexStatus(projectId, 'ready', new Date())
    report({ phase: 'done', chunksTotal: allChunks.length, message: `Indexed ${allChunks.length} chunks from ${contentMap.size} files` })

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
  changedFiles: string[],       // list of file paths that were modified
  defaultBranch: string
): Promise<void> {
  if (changedFiles.length === 0) return
  const { owner, repo } = splitRepoName(repoFullName)

  for (const filePath of changedFiles) {
    // Fetch new content
    const { getFileContent } = await import('@/lib/github')
    const content = await getFileContent(accessToken, owner, repo, filePath, defaultBranch)
    if (!content) {
      // File deleted
      await deleteFileChunks(projectId, filePath)
      continue
    }

    // Delete old chunks for this file
    await deleteFileChunks(projectId, filePath)

    // Rechunk and re-embed
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
