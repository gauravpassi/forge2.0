// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Git Operations
// Clone → branch → apply changes → commit → push
// Uses simple-git + temp directories
// ════════════════════════════════════════════════════════════════

import simpleGit, { SimpleGit } from 'simple-git'
import { mkdtemp, writeFile, mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { tmpdir } from 'os'

// ── Clone ─────────────────────────────────────────────────────────

/**
 * Clone a repo to a temp directory and return the path.
 * Uses the GitHub token for auth via HTTPS.
 */
export async function cloneRepo(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const cloneDir = await mkdtemp(join(tmpdir(), `forge-${owner}-${repo}-`))
  const remoteUrl = `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`

  const git = simpleGit()
  await git.clone(remoteUrl, cloneDir, ['--branch', branch, '--depth', '1'])

  // Configure git identity for commits
  const localGit = simpleGit(cloneDir)
  await localGit.addConfig('user.name', 'Forge AI')
  await localGit.addConfig('user.email', 'forge-ai@forge2.dev')

  return cloneDir
}

// ── Apply file changes ────────────────────────────────────────────

export interface FileChange {
  path: string           // relative to repo root
  content: string        // full file content (empty = delete)
  action: 'create' | 'update' | 'delete'
}

export async function applyFileChanges(
  cloneDir: string,
  changes: FileChange[]
): Promise<void> {
  for (const change of changes) {
    const absolutePath = join(cloneDir, change.path)

    if (change.action === 'delete') {
      try {
        await unlink(absolutePath)
      } catch {
        // File might not exist — ignore
      }
      continue
    }

    // Ensure parent directories exist
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, change.content, 'utf-8')
  }
}

// ── Commit & push ─────────────────────────────────────────────────

/**
 * Create a new branch, stage all changes, commit, and push.
 * Returns the branch name actually pushed.
 */
export async function commitAndPush(
  cloneDir: string,
  accessToken: string,
  owner: string,
  repo: string,
  branchName: string,
  commitMessage: string
): Promise<string> {
  const git: SimpleGit = simpleGit(cloneDir)

  // Create and checkout new branch
  await git.checkoutLocalBranch(branchName)

  // Stage all changes
  await git.add('.')

  // Check if there's anything to commit
  const status = await git.status()
  if (status.files.length === 0) {
    throw new Error('No changes to commit')
  }

  // Commit
  await git.commit(commitMessage)

  // Set remote with auth token embedded
  const remoteUrl = `https://x-access-token:${accessToken}@github.com/${owner}/${repo}.git`
  await git.remote(['set-url', 'origin', remoteUrl])

  // Push new branch
  await git.push('origin', branchName, ['--set-upstream'])

  return branchName
}

// ── Get diff (for debugging / PR body) ───────────────────────────

export async function getDiff(cloneDir: string): Promise<string> {
  const git: SimpleGit = simpleGit(cloneDir)
  return git.diff(['HEAD'])
}

// ── Cleanup ───────────────────────────────────────────────────────

export async function cleanupClone(cloneDir: string): Promise<void> {
  const { rm } = await import('fs/promises')
  try {
    await rm(cloneDir, { recursive: true, force: true })
  } catch {
    // Non-fatal
  }
}
