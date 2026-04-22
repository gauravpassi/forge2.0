// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Global TypeScript Types
// ════════════════════════════════════════════════════════════════

// ── Auth ─────────────────────────────────────────────────────────
export interface ForgeUser {
  id: string
  githubLogin: string
  name: string | null
  avatarUrl: string | null
  email: string | null
}

// ── Projects ─────────────────────────────────────────────────────
export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error'

export interface Project {
  id: string
  userId: string
  repoFullName: string      // "owner/repo"
  repoId: number | null
  defaultBranch: string
  lastIndexedAt: string | null
  indexStatus: IndexStatus
  vercelProject: string | null
  createdAt: string
}

// ── GitHub ────────────────────────────────────────────────────────
export interface GithubRepo {
  id: number
  full_name: string
  name: string
  private: boolean
  default_branch: string
  description: string | null
  language: string | null
  stargazers_count: number
  updated_at: string | null
}

export interface RepoFile {
  path: string
  type: 'blob' | 'tree'
  size: number
  sha: string
}

// ── RAG ──────────────────────────────────────────────────────────
export interface CodeChunk {
  id: string
  projectId: string
  filePath: string
  chunkIndex: number
  content: string
  summary: string | null
  language: string | null
  startLine: number | null
  endLine: number | null
  tokenCount: number | null
}

export interface SearchResult extends CodeChunk {
  similarity: number
}

// ── Tasks ─────────────────────────────────────────────────────────
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface FileChange {
  path: string
  action: 'create' | 'update' | 'delete'
}

export interface Task {
  id: string
  projectId: string
  userId: string
  description: string
  status: TaskStatus
  branchName: string | null
  prUrl: string | null
  deployUrl: string | null
  error: string | null
  resultSummary: string | null
  filesChanged: FileChange[] | null
  createdAt: string
  completedAt: string | null
}

// ── Agent ─────────────────────────────────────────────────────────
export interface AgentPlan {
  summary: string
  files: AgentFileOp[]
  testCommand?: string
}

export interface AgentFileOp {
  path: string
  action: 'create' | 'update' | 'delete'
  content?: string       // full file content (create/update)
  reasoning: string
}

// ── API Responses ─────────────────────────────────────────────────
export interface ApiSuccess<T> {
  data: T
  error?: never
}
export interface ApiError {
  error: string
  data?: never
}
export type ApiResponse<T> = ApiSuccess<T> | ApiError
