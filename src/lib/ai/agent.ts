// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Task Agent
// Orchestrates: RAG search → classify → plan → code gen → git → PR → deploy
// Auto-routes to the right model based on task complexity.
// ════════════════════════════════════════════════════════════════

import {
  generate,
  generateForComplexity,
  classifyComplexity,
  modelForComplexity,
  parseJsonResponse,
  MODELS,
  type TaskComplexity,
} from '@/lib/ai/gemini'
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
  complexity: TaskComplexity
  modelUsed: string
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

  // ── STEP 1: Mark running + initial RAG search ─────────────────
  await updateTask(taskId, { status: 'running' })

  const initialResults = await searchCodebase(projectId, description, { matchCount: 8 })
  const initialContext = buildContextFromResults(initialResults, 12_000)

  // ── STEP 2: Planning (always use Flash — fast & cheap) ────────
  // Planning just produces a JSON file list; doesn't need a heavy model.
  const planPrompt = buildPlanPrompt(description, initialContext, repoFullName)
  const planRaw = await generate(planPrompt, {
    model: MODELS.FLASH,
    temperature: 0.1,
    maxOutputTokens: 2048,
  })
  const plan = parseJsonResponse<AgentPlan & { queries?: string[] }>(planRaw)

  // ── STEP 3: Classify complexity AFTER we know the file count ──
  // Now we have real signal: how many files + description keywords.
  const complexity = classifyComplexity(description, plan.files.length)
  const modelUsed = modelForComplexity(complexity)

  console.log(
    `[Forge] Task complexity: ${complexity} | Model: ${modelUsed} | Files: ${plan.files.length}`
  )

  // ── STEP 4: Expanded RAG search using plan's search queries ───
  const searchQueries = [
    description,
    ...(plan.queries ?? []),
    ...plan.files.map((f) => `${f.path} ${f.reasoning}`),
  ].slice(0, 5)

  const expandedResults = await multiQuerySearch(projectId, searchQueries, { matchCount: 10 })
  const richContext = buildContextFromResults(expandedResults, 20_000)

  // ── STEP 5: Code generation (model varies by complexity) ──────
  const branchName = `forge/${slugify(description)}-${Date.now().toString(36)}`
  const cloneDir = await cloneRepo(accessToken, owner, repo, defaultBranch)

  const generatedFiles: Array<{
    path: string
    content: string
    action: AgentFileOp['action']
  }> = []

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

    // Focused RAG search for this specific file
    const fileResults = await searchCodebase(
      projectId,
      `${fileOp.path} ${fileOp.reasoning}`,
      { matchCount: 6, matchThreshold: 0.4 }
    )
    const fileContext = buildContextFromResults(
      dedup([...expandedResults, ...fileResults]).slice(0, 15),
      18_000
    )

    const codePrompt = buildCodeGenPrompt(
      description,
      fileContext,
      fileOp.path,
      fileOp.action,
      existingContent
    )

    // 🔑 Use complexity-appropriate model for code generation
    const generatedContent = await generateForComplexity(codePrompt, complexity)

    generatedFiles.push({ path: fileOp.path, content: generatedContent, action: fileOp.action })
  }

  // ── STEP 6: Commit message (always Flash — trivial task) ──────
  const commitMsgPrompt = buildCommitMessagePrompt(
    description,
    generatedFiles.map((f) => f.path)
  )
  const commitMessage = (
    await generate(commitMsgPrompt, {
      model: MODELS.FLASH,
      temperature: 0,
      maxOutputTokens: 100,
    })
  ).trim()

  // ── STEP 7: Apply changes, commit, push ───────────────────────
  await applyFileChanges(cloneDir, generatedFiles)
  const pushedBranch = await commitAndPush(
    cloneDir,
    accessToken,
    owner,
    repo,
    branchName,
    commitMessage
  )

  // ── STEP 8: PR description (Flash — narrative, not code) ──────
  const prDescPrompt = buildPRDescriptionPrompt(
    description,
    generatedFiles.map((f) => f.path),
    plan.summary
  )
  const prBody = await generate(prDescPrompt, {
    model: MODELS.FLASH,
    temperature: 0.2,
    maxOutputTokens: 1024,
  })

  const pr = await createPullRequest(accessToken, owner, repo, {
    title: `[Forge] ${plan.summary}`,
    body: prBody + `\n\n---\n*Complexity: **${complexity}** · Model: \`${modelUsed}\`*`,
    head: pushedBranch,
    base: defaultBranch,
  })

  // ── STEP 9: Vercel deploy (optional) ──────────────────────────
  let deployUrl: string | null = null
  if (vercelProject) {
    try {
      deployUrl = await triggerVercelDeploy(vercelProject, repoFullName)
    } catch {
      // Non-fatal
    }
  }

  // ── STEP 10: Incremental RAG re-index ────────────────────────
  const changedPaths = generatedFiles
    .filter((f) => f.action !== 'delete')
    .map((f) => f.path)

  reindexChangedFiles(projectId, repoFullName, accessToken, changedPaths, defaultBranch).catch(
    console.error
  )

  const filesChanged: FileChange[] = generatedFiles.map((f) => ({
    path: f.path,
    action: f.action,
  }))

  return {
    prUrl: pr.html_url,
    deployUrl,
    filesChanged,
    summary: plan.summary,
    branchName: pushedBranch,
    complexity,
    modelUsed,
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

function dedup<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>()
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item)
  }
  return Array.from(seen.values())
}
