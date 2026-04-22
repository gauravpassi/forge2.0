// ════════════════════════════════════════════════════════════════
// Smart Context Builder
//
// Splits RAG results into two tiers for Claude prompt caching:
//
//  CACHED (task-level)  — architecture chunks: types, configs,
//                         key lib files. Same across all files
//                         in a task → pay once, read at 10% cost.
//
//  UNCACHED (file-level) — the 3-5 chunks most relevant to the
//                          specific file being generated right now.
//
// Token budgets ensure we never blow the model's useful range.
// ════════════════════════════════════════════════════════════════

import type { SearchResult } from '@/types'

// ── Token estimation (1 token ≈ 3.5 chars for code) ──────────────
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// ── Architecture path signals ─────────────────────────────────────
// These files are structural — types, configs, auth, DB schema.
// They're useful across ALL files in a task, so they go in the
// cached tier.
const ARCHITECTURE_SEGMENTS = new Set([
  'types', 'type', 'interfaces', 'interface',
  'schema', 'schemas',
  'config', 'configs', 'configuration',
  'constants', 'constant',
  'middleware',
  'auth', 'authentication', 'authorization',
  'lib', 'utils', 'util', 'helpers', 'helper',
  'hooks',
  'prisma', 'database', 'db',
  'models', 'model',
  'store', 'state',
  'providers', 'provider',
])

function isArchitecturalFile(filePath: string): boolean {
  const segments = filePath.toLowerCase().split('/')
  const filename = segments[segments.length - 1].replace(/\.[^.]+$/, '')
  return (
    segments.some((s) => ARCHITECTURE_SEGMENTS.has(s)) ||
    ARCHITECTURE_SEGMENTS.has(filename)
  )
}

// ── Context budget definitions ────────────────────────────────────
export interface ContextBudgets {
  /** Max tokens for the cached architecture context */
  cachedTokens: number
  /** Max tokens for file-specific uncached context */
  fileTokens: number
  /** Max tokens for the existing file content */
  existingFileTokens: number
}

export const BUDGETS: Record<'simple' | 'medium' | 'complex', ContextBudgets> = {
  simple: {
    cachedTokens:       1_500,
    fileTokens:         1_000,
    existingFileTokens: 2_000,
  },
  medium: {
    cachedTokens:       2_500,
    fileTokens:         2_000,
    existingFileTokens: 3_000,
  },
  complex: {
    cachedTokens:       4_000,   // cached → pay once per task
    fileTokens:         3_000,   // uncached → per file
    existingFileTokens: 4_000,
  },
}

// ── Context split result ──────────────────────────────────────────
export interface SplitContext {
  /** Architecture-level context (to be cached by Claude) */
  architectureContext: string
  /** File-specific context (not cached) */
  fileContext: string
  /** Token stats for logging */
  stats: {
    architectureTokens: number
    fileTokens: number
    architectureChunks: number
    fileChunks: number
  }
}

// ── Main context builder ──────────────────────────────────────────

/**
 * Split RAG results into a cached architecture context and a
 * file-specific uncached context.
 *
 * @param allResults    All RAG results for this task (deduplicated)
 * @param targetFile    The file currently being generated
 * @param complexity    Task complexity tier
 */
export function buildSplitContext(
  allResults: SearchResult[],
  targetFile: string,
  complexity: 'simple' | 'medium' | 'complex'
): SplitContext {
  const budget = BUDGETS[complexity]

  // Remove self-referential chunks (chunks FROM the file we're generating)
  const relevant = allResults.filter((r) => r.filePath !== targetFile)

  // Partition into architecture vs feature chunks
  const archChunks = relevant.filter((r) => isArchitecturalFile(r.filePath))
  const featureChunks = relevant.filter((r) => !isArchitecturalFile(r.filePath))

  // Sort by similarity (most relevant first)
  archChunks.sort((a, b) => b.similarity - a.similarity)
  featureChunks.sort((a, b) => b.similarity - a.similarity)

  // ── Build cached architecture context ────────────────────────
  const archSections: string[] = []
  let archTokens = 0
  const archUsed = new Set<string>()

  for (const chunk of archChunks) {
    const section = formatChunk(chunk)
    const tokens = estimateTokens(section)
    if (archTokens + tokens > budget.cachedTokens) break
    // Deduplicate by file path — include at most 2 chunks per file
    const fileCount = [...archUsed].filter((p) => p === chunk.filePath).length
    if (fileCount >= 2) continue
    archSections.push(section)
    archUsed.add(chunk.filePath)
    archTokens += tokens
  }

  // ── Build uncached file-specific context ──────────────────────
  // For this tier, prefer feature chunks most similar to the target file path
  const targetName = targetFile.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
  const scoredFeature = featureChunks.map((chunk) => ({
    chunk,
    // Boost chunks whose file name matches the target file name
    score: chunk.similarity + (chunk.filePath.includes(targetName) ? 0.2 : 0),
  }))
  scoredFeature.sort((a, b) => b.score - a.score)

  const fileSections: string[] = []
  let fileTokens = 0
  const fileUsed = new Map<string, number>()

  for (const { chunk } of scoredFeature) {
    const section = formatChunk(chunk)
    const tokens = estimateTokens(section)
    if (fileTokens + tokens > budget.fileTokens) break
    // At most 2 chunks per file in this tier too
    const count = fileUsed.get(chunk.filePath) ?? 0
    if (count >= 2) continue
    fileSections.push(section)
    fileUsed.set(chunk.filePath, count + 1)
    fileTokens += tokens
  }

  return {
    architectureContext: archSections.length > 0
      ? '## Architecture & Type Context\n\n' + archSections.join('\n\n')
      : '',
    fileContext: fileSections.length > 0
      ? '## Related Code\n\n' + fileSections.join('\n\n')
      : '',
    stats: {
      architectureTokens: archTokens,
      fileTokens,
      architectureChunks: archSections.length,
      fileChunks: fileSections.length,
    },
  }
}

// ── Format a single chunk ─────────────────────────────────────────

function formatChunk(chunk: SearchResult): string {
  const location =
    chunk.startLine && chunk.endLine
      ? ` (lines ${chunk.startLine}–${chunk.endLine})`
      : ''
  return [
    `### ${chunk.filePath}${location}`,
    '```' + (chunk.language ?? ''),
    // Strip the "// File: ..." header that chunker prepends — it's redundant here
    chunk.content.replace(/^\/\/ File:.*\n\n?/m, '').trim(),
    '```',
  ].join('\n')
}

// ── Trim existing file content to budget ─────────────────────────

export function trimExistingContent(
  content: string | null,
  complexity: 'simple' | 'medium' | 'complex'
): string | null {
  if (!content) return null
  const budget = BUDGETS[complexity].existingFileTokens
  const maxChars = budget * 3.5
  if (content.length <= maxChars) return content
  // Keep the first 60% and last 40% — preserve imports and end of file
  const keep = Math.floor(maxChars)
  const head = Math.floor(keep * 0.6)
  const tail = keep - head
  return (
    content.slice(0, head) +
    '\n\n// ... [truncated for context budget] ...\n\n' +
    content.slice(-tail)
  )
}
