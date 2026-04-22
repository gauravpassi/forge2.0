import { Octokit } from '@octokit/rest'
import type { GithubRepo, RepoFile } from '@/types'

// ── Client factory ────────────────────────────────────────────────

export function getOctokit(accessToken: string) {
  return new Octokit({ auth: accessToken })
}

// ── Repo listing ──────────────────────────────────────────────────

export async function listUserRepos(accessToken: string): Promise<GithubRepo[]> {
  const octokit = getOctokit(accessToken)
  const repos: GithubRepo[] = []
  let page = 1

  while (true) {
    const { data } = await octokit.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      page,
    })
    repos.push(
      ...data.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        name: r.name,
        private: r.private,
        default_branch: r.default_branch,
        description: r.description ?? null,
        language: r.language ?? null,
        stargazers_count: r.stargazers_count,
        updated_at: r.updated_at ?? null,
      }))
    )
    if (data.length < 100) break
    page++
    if (page > 10) break // safety cap: 1000 repos max
  }
  return repos
}

// ── Repo tree (all files recursively) ────────────────────────────

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi',
  'go',
  'rs',
  'java', 'kt', 'kts',
  'rb',
  'php',
  'cs',
  'cpp', 'cc', 'cxx', 'c', 'h', 'hpp',
  'swift',
  'scala',
  'r',
  'sh', 'bash',
  'sql',
  'md', 'mdx',
  'json', 'yaml', 'yml', 'toml',
  'env',
  'prisma',
  'graphql', 'gql',
  'html', 'css', 'scss', 'sass',
  'vue', 'svelte',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  '.turbo', 'coverage', '__pycache__', '.pytest_cache',
  'vendor', 'target', '.cargo', 'venv', '.venv',
  '.cache', '.parcel-cache', 'out',
])

export function isIndexableFile(filePath: string): boolean {
  const parts = filePath.split('/')
  // Skip if any path segment is a skip dir
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return false
  }
  // Check extension
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (!CODE_EXTENSIONS.has(ext)) return false
  // Skip very large config / lock files
  const basename = parts[parts.length - 1]
  if (basename === 'package-lock.json' || basename === 'yarn.lock' || basename === 'pnpm-lock.yaml') return false
  return true
}

export async function getRepoTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoFile[]> {
  const octokit = getOctokit(accessToken)
  const { data } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: '1',
  })

  return (data.tree ?? [])
    .filter(
      (item) =>
        item.type === 'blob' &&
        item.path &&
        isIndexableFile(item.path) &&
        (item.size ?? 0) < 200_000 // skip files > 200 KB
    )
    .map((item) => ({
      path: item.path!,
      type: 'blob',
      size: item.size ?? 0,
      sha: item.sha ?? '',
    }))
}

// ── File content ──────────────────────────────────────────────────

export async function getFileContent(
  accessToken: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<string | null> {
  const octokit = getOctokit(accessToken)
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    })
    if (Array.isArray(data) || data.type !== 'file') return null
    // content is base64 encoded with newlines
    return Buffer.from(data.content, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

// ── Batch file fetch (with concurrency control) ───────────────────

export async function batchGetFileContents(
  accessToken: string,
  owner: string,
  repo: string,
  files: RepoFile[],
  concurrency = 5,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  let done = 0

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)
    await Promise.all(
      batch.map(async (file) => {
        const content = await getFileContent(accessToken, owner, repo, file.path)
        if (content !== null) results.set(file.path, content)
        done++
        onProgress?.(done, files.length)
      })
    )
  }
  return results
}

// ── PR creation ───────────────────────────────────────────────────

export async function createPullRequest(
  accessToken: string,
  owner: string,
  repo: string,
  options: {
    title: string
    body: string
    head: string    // branch with changes
    base: string    // target branch (usually main)
  }
) {
  const octokit = getOctokit(accessToken)
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
  })
  return data
}

// ── Utility: split "owner/repo" ───────────────────────────────────

export function splitRepoName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/')
  return { owner, repo }
}
