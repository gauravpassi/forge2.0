import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ── Lazy-initialized clients (safe for builds without env vars) ───

let _supabase: SupabaseClient | null = null
let _supabaseAdmin: SupabaseClient | null = null

// Public client — for client-side reads (subject to RLS)
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) throw new Error('Supabase public env vars not set')
    _supabase = createClient(url, key)
  }
  return _supabase
}

// Service role client — for server-side mutations (bypasses RLS)
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase service role env vars not set')
    _supabaseAdmin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _supabaseAdmin
}

// ── User helpers ──────────────────────────────────────────────────

export async function upsertUser(user: {
  id: string
  githubLogin: string
  name: string | null
  avatarUrl: string | null
  email: string | null
}) {
  const { error } = await getSupabaseAdmin()
    .from('users')
    .upsert(
      {
        id: user.id,
        github_login: user.githubLogin,
        name: user.name,
        avatar_url: user.avatarUrl,
        email: user.email,
      },
      { onConflict: 'id' }
    )
  if (error) throw error
}

// ── Project helpers ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProject(row: any) {
  return {
    id:             row.id            as string,
    userId:         row.user_id       as string,
    repoFullName:   row.repo_full_name as string,
    repoId:         row.repo_id       as number | null,
    defaultBranch:  row.default_branch as string,
    lastIndexedAt:  row.last_indexed_at as string | null,
    indexStatus:    row.index_status  as 'idle' | 'indexing' | 'ready' | 'error',
    vercelProject:  row.vercel_project as string | null,
    createdAt:      row.created_at    as string,
  }
}

export async function getProject(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (error) throw error
  return mapProject(data)
}

export async function getUserProjects(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapProject)
}

export async function createProject(input: {
  userId: string
  repoFullName: string
  repoId: number
  defaultBranch: string
}) {
  const { data, error } = await getSupabaseAdmin()
    .from('projects')
    .insert({
      user_id: input.userId,
      repo_full_name: input.repoFullName,
      repo_id: input.repoId,
      default_branch: input.defaultBranch,
      index_status: 'idle',
    })
    .select()
    .single()
  if (error) throw error
  return mapProject(data)
}

export async function updateProjectIndexStatus(
  projectId: string,
  status: 'idle' | 'indexing' | 'ready' | 'error',
  lastIndexedAt?: Date
) {
  const { error } = await getSupabaseAdmin()
    .from('projects')
    .update({
      index_status: status,
      ...(lastIndexedAt ? { last_indexed_at: lastIndexedAt.toISOString() } : {}),
    })
    .eq('id', projectId)
  if (error) throw error
}

// ── Chunk helpers ─────────────────────────────────────────────────

export async function deleteProjectChunks(projectId: string) {
  const { error } = await getSupabaseAdmin()
    .from('code_chunks')
    .delete()
    .eq('project_id', projectId)
  if (error) throw error
}

export async function deleteFileChunks(projectId: string, filePath: string) {
  const { error } = await getSupabaseAdmin()
    .from('code_chunks')
    .delete()
    .eq('project_id', projectId)
    .eq('file_path', filePath)
  if (error) throw error
}

export async function insertChunks(
  chunks: Array<{
    projectId: string
    filePath: string
    chunkIndex: number
    content: string
    summary: string | null
    language: string | null
    startLine: number | null
    endLine: number | null
    tokenCount: number | null
    embedding: number[]
  }>
) {
  const rows = chunks.map((c) => ({
    project_id: c.projectId,
    file_path: c.filePath,
    chunk_index: c.chunkIndex,
    content: c.content,
    summary: c.summary,
    language: c.language,
    start_line: c.startLine,
    end_line: c.endLine,
    token_count: c.tokenCount,
    embedding: JSON.stringify(c.embedding), // pgvector expects array literal
  }))

  const { error } = await getSupabaseAdmin().from('code_chunks').insert(rows)
  if (error) throw error
}

// ── Task helpers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTask(row: any) {
  return {
    id:            row.id           as string,
    projectId:     row.project_id   as string,
    userId:        row.user_id      as string,
    description:   row.description  as string,
    status:        row.status       as 'queued' | 'running' | 'done' | 'failed',
    branchName:    row.branch_name  as string | null,
    prUrl:         row.pr_url       as string | null,
    deployUrl:     row.deploy_url   as string | null,
    error:         row.error        as string | null,
    resultSummary: row.result_summary as string | null,
    filesChanged:  row.files_changed  as Array<{ path: string; action: string }> | null,
    createdAt:     row.created_at   as string,
    completedAt:   row.completed_at as string | null,
  }
}

export async function createTask(input: {
  projectId: string
  userId: string
  description: string
}) {
  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      description: input.description,
      status: 'queued',
    })
    .select()
    .single()
  if (error) throw error
  return mapTask(data)
}

export async function updateTask(
  taskId: string,
  update: Partial<{
    status: string
    branchName: string
    prUrl: string
    deployUrl: string
    error: string
    resultSummary: string
    filesChanged: unknown
    completedAt: string
  }>
) {
  const mapped: Record<string, unknown> = {}
  if (update.status !== undefined) mapped.status = update.status
  if (update.branchName !== undefined) mapped.branch_name = update.branchName
  if (update.prUrl !== undefined) mapped.pr_url = update.prUrl
  if (update.deployUrl !== undefined) mapped.deploy_url = update.deployUrl
  if (update.error !== undefined) mapped.error = update.error
  if (update.resultSummary !== undefined) mapped.result_summary = update.resultSummary
  if (update.filesChanged !== undefined) mapped.files_changed = update.filesChanged
  if (update.completedAt !== undefined) mapped.completed_at = update.completedAt

  const { error } = await getSupabaseAdmin().from('tasks').update(mapped).eq('id', taskId)
  if (error) throw error
}

export async function getTaskById(taskId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()
  if (error) throw error
  return mapTask(data)
}

export async function getProjectTasks(projectId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map(mapTask)
}
