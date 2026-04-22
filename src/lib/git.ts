// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Git Operations (GitHub REST API)
//
// Uses GitHub's Git Data API instead of the git binary.
// Works in Vercel serverless (no git binary needed).
//
// Flow:
//   1. Get base branch commit SHA
//   2. Create blobs for each changed file
//   3. Create a new tree (inheriting from base tree)
//   4. Create a commit pointing to the new tree
//   5. Create a new branch ref pointing to that commit
// ════════════════════════════════════════════════════════════════

import { getOctokit } from '@/lib/github'

export interface FileChange {
  path: string
  content: string        // full file content (empty string for deletes)
  action: 'create' | 'update' | 'delete'
}

// ── No-op stubs (kept so agent.ts import surface doesn't change) ──

/** No-op: we no longer clone to disk. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cloneRepo(
  _accessToken: string,
  _owner: string,
  _repo: string,
  _branch: string
): Promise<string> {
  return 'noop' // cloneDir is unused in the new flow
}

/** No-op: file changes are applied directly via API in commitAndPush. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function applyFileChanges(
  _cloneDir: string,
  _changes: FileChange[]
): Promise<void> {
  // Changes are now carried through agent.ts and applied in commitAndPush
}

// ── Core: create branch + commit via GitHub API ───────────────────

/**
 * Create a new branch and commit all file changes via the GitHub Git Data API.
 * No git binary required — pure REST calls.
 */
export async function commitAndPush(
  _cloneDir: string,           // ignored — kept for API compatibility
  accessToken: string,
  owner: string,
  repo: string,
  branchName: string,
  commitMessage: string,
  changes?: FileChange[]        // passed from agent.ts
): Promise<string> {
  if (!changes || changes.length === 0) {
    throw new Error('No file changes provided')
  }

  const octokit = getOctokit(accessToken)

  // 1. Find the default branch's latest commit SHA
  const { data: repoData } = await octokit.repos.get({ owner, repo })
  const defaultBranch = repoData.default_branch

  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${defaultBranch}`,
  })
  const baseSha = refData.object.sha

  // 2. Get the base commit to find its tree SHA
  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  })
  const baseTreeSha = baseCommit.tree.sha

  // 3. Build tree items — create blobs for creates/updates, null sha for deletes
  type TreeItem = {
    path: string
    mode: '100644'
    type: 'blob'
    sha?: string | null
    content?: string
  }

  const treeItems: TreeItem[] = []

  for (const change of changes) {
    if (change.action === 'delete') {
      treeItems.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: null,   // null = delete this path
      })
    } else {
      // Use inline content — GitHub creates the blob automatically
      treeItems.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        content: change.content,
      })
    }
  }

  // 4. Create a new tree inheriting from base
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeItems,
  })

  // 5. Create the commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [baseSha],
    author: {
      name: 'Forge AI',
      email: 'forge-ai@forge2.dev',
      date: new Date().toISOString(),
    },
  })

  // 6. Create the new branch ref pointing to the commit
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: newCommit.sha,
  })

  return branchName
}

/** No-op cleanup — nothing to clean up without local clone */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function cleanupClone(_cloneDir: string): Promise<void> {}
