// Forge 2.0 — Project-Specific TypeScript Types
// ════════════════════════════════════════════════════════════════

// ── Indexing Progress ────────────────────────────────────────────

/**
 * Represents the current granular phase of the project indexing process.
 * This provides more detailed progress than the `Project.indexStatus`.
 */
export type IndexPhase = 'tree' | 'fetch' | 'chunk' | 'embed' | 'store' | 'done' | 'error' | null

/**
 * Provides detailed progress information during the indexing process,
 * often used for UI updates.
 */
export interface IndexProgress {
  phase: IndexPhase
  filesTotal?: number
  filesDone?: number
  chunksTotal?: number
  message: string
}