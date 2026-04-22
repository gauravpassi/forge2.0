// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Task Agent
// Orchestrates: RAG search → planning → code gen → git → PR → deploy
// ════════════════════════════════════════════════════════════════

import { generate, parseJsonResponse } from '@/lib/ai/gemini'
import { searchCodebase, multiQuerySearch, buildContextFromResults } from '@/lib/rag/search'
import {
  buildPlanPrompt,
  buildCodeGenPrompt,
  buildPRDescriptionPrompt,
  buildCommitMessagePrompt,
} from '@/lib/ai/prompts'
import { cloneRepo, applyFileChanges, commitAndPush } from '@/lib/git'
import { createPullRequest, getFileContent, splitRepoName } from '@/lib/github'
import { triggerVercelDeploy } from '@/lib/vercel'
import { updateTask } from '@/lib/supabase'
import { reindexChangedFiles } from '@/lib/rag/indexer'
import type { AgentPlan, AgentFileOp, FileChange } from '@/types'

export interface AgentRunInput {
  taskId: string
  projectId: string
  description: string
  repoFullName: string
  defaultBranch: string
  accessToken: string
  vercelProject?: string | null
}

export interface AgentRunResult {
  prUrl: string
  deployUrl: string | null
  filesChanged: FileChange[]
  summary: string
  branchName: string
}

// ── Main agent orchestration ──────────────────────────────────────

export async function runTaskAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const {
    taskId,
    projectId,
    description,
    repoFullName,
    defaultBranch,
    accessToken,
    vercelProject,
  } = input

  const { owner, repo } = splitRepoName(repoFullName)

  // ── STEP 1: Initial RAG search ────────────────────────────────
  await updateTask(taskId, { status: 'running' })

  const initialResults = await searchCodebase(projectId, description, { matchCount: 8 })
  const initialContext = buildContextFromResults(initialResults, 12_000)

  // ── STEP 2: Planning ──────────────────────────────────────────
  const planPrompt = buildPlanPrompt(description, initialContext, repoFullName)
  const planRaw = await generate(planPrompt, { temperature: 0.1, maxOutputTokens: 2048 })
  const plan = parseJsonResponse<AgentPlan & { queries?: string[] }>(planRaw)

  // ── STEP 3: Expanded RAG search using plan's queries ──────────
  const searchQueries = [
    description,
    ...(plan.queries ?? []),
    ...plan.files.map((f) => `${f.path} ${f.reasoning}`),
  ].slice(0, 5)

  const expandedResults = await multiQuerySearch(projectId, searchQueries, { matchCount: 10 })
  const richContext = buildContextFromResults(expandedResults, 20_000)

  // ── STEP 4: Code generation for each file ────────────────────
  const branchName = `forge/${slugify(description)}-${Date.now().toString(36)}`
  const cloneDir = await cloneRepo(accessToken, owner, repo, defaultBranch)

  const generatedFiles: Array<{ path: string; content: string; action: AgentFileOp['action'] }> = []

  for (const fileOp of plan.files) {
    if (fileOp.action === 'delete') {
      generatedFiles.push({ path: fileOp.path, content: '', action: 'delete' })
      continue
    }

    // Fetch current file content (if updating)
    const existingContent =
      fileOp.action === 'update'
        ? await getFileContent(accessToken, owner, repo, fileOp.path, defaultBranch)
        : null

    // Extra focused search for this specific file
    const fileResults = await searchCodebase(projectId, `${fileOp.path} ${fileOp.reasoning}`, {
      matchCount: 6,
      matchThreshold: 0.4,
    })
    const fileContext = buildContextFromResults(
      [...new Map([...expandedResults, ...fileResults].map((r) => [r.id, r])).values()].slice(0, 15),
      18_000
    )

    const codePrompt = buildCodeGenPrompt(
      description,
      fileContext,
      fileOp.path,
      fileOp.action,
      existingContent
    )

    const generatedContent = await generate(codePrompt, {
      temperature: 0.15,
      maxOutputTokens: 8192,
    })

    generatedFiles.push({ path: fileOp.path, content: generatedContent, action: fileOp.action })
  }

  // ── STEP 5: Commit message ─────────────────────────────────────
  const commitMsgPrompt = buildCommitMessagePrompt(
    description,
    generatedFiles.map((f) => f.path)
  )
  const commitMessage = (await generate(commitMsgPrompt, { temperature: 0, maxOutputTokens: 100 })).trim()

  // ── STEP 6: Apply changes, commit, push ───────────────────────
  await applyFileChanges(cloneDir, generatedFiles)
  const pushedBranch = await commitAndPush(
    cloneDir,
    accessToken,
    owner,
    repo,
    branchName,
    commitMessage
  )

  // ── STEP 7: Create Pull Request ───────────────────────────────
  const prDescPrompt = buildPRDescriptionPrompt(
    description,
    generatedFiles.map((f) => f.path),
    plan.summary
  )
  const prBody = await generate(prDescPrompt, { temperature: 0.2, maxOutputTokens: 1024 })

  const pr = await createPullRequest(accessToken, owner, repo, {
    title: `[Forge] ${plan.summary}`,
    body: prBody,
    head: pushedBranch,
    base: defaultBranch,
  })

  // ── STEP 8: Vercel deploy (optional) ──────────────────────────
  let deployUrl: string | null = null
  if (vercelProject) {
    try {
      deployUrl = await triggerVercelDeploy(vercelProject, repoFullName)
    } catch {
      // Non-fatal — PR was created successfully
    }
  }

  // ── STEP 9: Update RAG with changed files ─────────────────────
  const changedPaths = generatedFiles
    .filter((f) => f.action !== 'delete')
    .map((f) => f.path)

  // Fire-and-forget incremental re-index
  reindexChangedFiles(projectId, repoFullName, accessToken, changedPaths, defaultBranch).catch(
    console.error
  )

  const filesChanged: FileChange[] = generatedFiles.map((f) => ({
    path: f.path,
    action: f.action === 'delete' ? 'delete' : f.action,
  }))

  return {
    prUrl: pr.html_url,
    deployUrl,
    filesChanged,
    summary: plan.summary,
    branchName: pushedBranch,
  }
}

// ── Utilities ─────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
}
