// ════════════════════════════════════════════════════════════════
// RAG Search
// Semantic search over the indexed code knowledge base.
// ════════════════════════════════════════════════════════════════

import { embedText } from '@/lib/ai/gemini'
import { supabaseAdmin } from '@/lib/supabase'
import type { SearchResult } from '@/types'

export interface SearchOptions {
  matchThreshold?: number   // cosine similarity threshold (0–1), default 0.45
  matchCount?: number       // max chunks to return, default 12
}

// ── Semantic search ───────────────────────────────────────────────

export async function searchCodebase(
  projectId: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { matchThreshold = 0.45, matchCount = 12 } = options

  // Embed the query
  const queryEmbedding = await embedText(query)

  // Call the pgvector similarity function
  const { data, error } = await supabaseAdmin.rpc('match_code_chunks', {
    query_embedding: queryEmbedding,
    match_project_id: projectId,
    match_threshold: matchThreshold,
    match_count: matchCount,
  })

  if (error) throw error

  return (data ?? []).map((row: {
    id: string
    file_path: string
    content: string
    summary: string | null
    language: string | null
    start_line: number | null
    end_line: number | null
    similarity: number
  }) => ({
    id: row.id,
    projectId,
    filePath: row.file_path,
    chunkIndex: 0,
    content: row.content,
    summary: row.summary,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    tokenCount: null,
    similarity: row.similarity,
  }))
}

// ── Build context string for AI prompt ───────────────────────────

export function buildContextFromResults(results: SearchResult[], maxChars = 20_000): string {
  if (results.length === 0) return 'No relevant code found in knowledge base.'

  const sections: string[] = []
  let totalChars = 0

  for (const result of results) {
    const section = [
      `### ${result.filePath} (lines ${result.startLine ?? '?'}–${result.endLine ?? '?'}, similarity: ${(result.similarity * 100).toFixed(0)}%)`,
      '```' + (result.language ?? ''),
      result.content,
      '```',
    ].join('\n')

    if (totalChars + section.length > maxChars) break
    sections.push(section)
    totalChars += section.length
  }

  return sections.join('\n\n')
}

// ── Multi-query search (better recall for complex tasks) ──────────

export async function multiQuerySearch(
  projectId: string,
  queries: string[],
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  // Run all queries in parallel
  const allResults = await Promise.all(
    queries.map((q) => searchCodebase(projectId, q, options))
  )

  // Deduplicate by chunk ID, keep highest similarity
  const seen = new Map<string, SearchResult>()
  for (const results of allResults) {
    for (const result of results) {
      const existing = seen.get(result.id)
      if (!existing || result.similarity > existing.similarity) {
        seen.set(result.id, result)
      }
    }
  }

  // Sort by similarity descending
  return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity)
}
