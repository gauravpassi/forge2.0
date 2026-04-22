// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Task Agent
//
// Model routing:
//   Simple  (fix/style, 1-2 files) → Gemini 2.0 Flash
//   Medium  (feature,   3-4 files) → Gemini 2.5 Flash
//   Complex (refactor,  5+ files)  → Claude Sonnet 4.5 + caching
//                                    (falls back to Gemini Thinking
//                                     if ANTHROPIC_API_KEY not set)
//
// Context strategy:
//   Planning      → Gemini Flash + broad RAG (cheap, fast)
//   Code gen      → Split context per file:
//                     CACHED  = system prompt + architecture chunks
//                     UNCACHED = file-specific chunks + existing file
//   Commit / PR   → Gemini Flash (trivial, no code needed)
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
import { claudeGenerate, isClaudeAvailable, CLAUDE_MODEL } from '@/lib/ai/claude'
import { buildSplitContext, trimExistingContent } from '@/lib/context/builder'
import { searchCodebase, multiQuerySearch, buildContextFromResults } from '@/lib/rag/search'
import {
  SYSTEM_PROMPT,
  buildPlanPrompt,
  buildCachedContextBlock,
  buildUncachedCodePrompt,
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

  // Helper: write a live progress message visible in the UI while polling
  const progress = (msg: string) => updateTask(taskId, { resultSummary: msg }).catch(() => {})

  // ── STEP 1: Mark running + broad initial RAG search ───────────
  await updateTask(taskId, { status: 'running' })
  await progress('🔍 Searching codebase for relevant context…')

  const initialResults = await searchCodebase(projectId, description, { matchCount: 8 })
  const initialContext = buildContextFromResults(initialResults, 10_000)

  // ── STEP 2: Plan (always Gemini Flash — fast JSON, no code) ───
  await progress('📋 Planning which files to change…')
  const planPrompt = buildPlanPrompt(description, initialContext, repoFullName)
  const planRaw = await generate(planPrompt, {
    model: MODELS.FLASH,
    temperature: 0.1,
    maxOutputTokens: 2048,
  })
  const plan = parseJsonResponse<AgentPlan & { queries?: string[] }>(planRaw)

  // ── STEP 3: Classify complexity (now we know file count) ──────
  const complexity = classifyComplexity(description, plan.files.length)
  const useClaudeForComplex = complexity === 'complex' && isClaudeAvailable()
  const modelUsed = useClaudeForComplex
    ? CLAUDE_MODEL
    : modelForComplexity(complexity)

  const modelLabel = useClaudeForComplex ? 'claude-sonnet-4-5' : modelUsed.split('/').pop()!
  await progress(
    `⚙️ ${complexity.toUpperCase()} task · ${plan.files.length} file${plan.files.length !== 1 ? 's' : ''} · model: ${modelLabel}`
  )

  console.log(
    `[Forge] complexity=${complexity} model=${modelUsed} ` +
    `files=${plan.files.length} claude=${useClaudeForComplex}`
  )

  // ── STEP 4: Expanded RAG search ───────────────────────────────
  await progress('🔍 Deep-searching for relevant patterns and types…')
  const searchQueries = [
    description,
    ...(plan.queries ?? []),
    ...plan.files.map((f) => `${f.path} ${f.reasoning}`),
  ].slice(0, 6)

  const allResults = await multiQuerySearch(projectId, searchQueries, {
    matchCount: 12,
    matchThreshold: 0.4,
  })

  // ── STEP 5: Code generation ───────────────────────────────────
  const branchName = `forge/${slugify(description)}-${Date.now().toString(36)}`
  const cloneDir = await cloneRepo(accessToken, owner, repo, defaultBranch)

  const generatedFiles: Array<{
    path: string
    content: string
    action: AgentFileOp['action']
  }> = []

  for (let i = 0; i < plan.files.length; i++) {
    const fileOp = plan.files[i]

    if (fileOp.action === 'delete') {
      await progress(`🗑️ Deleting ${fileOp.path} (${i + 1}/${plan.files.length})`)
      generatedFiles.push({ path: fileOp.path, content: '', action: 'delete' })
      continue
    }

    const actionVerb = fileOp.action === 'create' ? '✨ Creating' : '✏️ Updating'
    await progress(`${actionVerb} ${fileOp.path} (${i + 1}/${plan.files.length})…`)

    // Fetch existing content
    const rawExisting =
      fileOp.action === 'update'
        ? await getFileContent(accessToken, owner, repo, fileOp.path, defaultBranch)
        : null

    const existingContent = trimExistingContent(rawExisting, complexity)

    // Focused RAG for this file
    const fileSpecificResults = await searchCodebase(
      projectId,
      `${fileOp.path} ${fileOp.reasoning}`,
      { matchCount: 5, matchThreshold: 0.38 }
    )
    const combinedResults = dedup([...allResults, ...fileSpecificResults])

    let generatedContent: string

    if (useClaudeForComplex) {
      // ── Claude path: split context + prompt caching ───────────
      const { architectureContext, fileContext, stats } = buildSplitContext(
        combinedResults,
        fileOp.path,
        complexity
      )

      console.log(
        `[Forge] ${fileOp.path} — arch=${stats.architectureChunks} chunks/${stats.architectureTokens}tok ` +
        `file=${stats.fileChunks} chunks/${stats.fileTokens}tok`
      )

      const cachedBlock = buildCachedContextBlock(description, architectureContext)
      const uncachedBlock = buildUncachedCodePrompt(
        fileOp.path,
        fileOp.action,
        fileContext,
        existingContent
      )

      generatedContent = await claudeGenerate(
        SYSTEM_PROMPT,
        cachedBlock,
        uncachedBlock,
        {
          model: CLAUDE_MODEL,
          maxTokens: 8192,
          // Extended thinking for truly complex architecture tasks
          thinking: plan.files.length >= 7
            ? { budgetTokens: 5000 }
            : undefined,
        }
      )
    } else {
      // ── Gemini path: single-block context ────────────────────
      const { fileContext, architectureContext } = buildSplitContext(
        combinedResults,
        fileOp.path,
        complexity
      )
      const combinedContext = [architectureContext, fileContext]
        .filter(Boolean)
        .join('\n\n')

      const codePrompt = buildCodeGenPrompt(
        description,
        combinedContext,
        fileOp.path,
        fileOp.action,
        existingContent
      )

      generatedContent = await generateForComplexity(codePrompt, complexity)
    }

    generatedFiles.push({
      path: fileOp.path,
      content: generatedContent,
      action: fileOp.action,
    })
  }

  // ── STEP 6: Commit message (Gemini Flash — trivial) ───────────
  await progress('💬 Writing commit message…')
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

  // ── STEP 7: Commit & push via GitHub API (no git binary needed) ──
  await progress('🚀 Committing and pushing to GitHub…')
  await applyFileChanges(cloneDir, generatedFiles)  // no-op in API mode
  const pushedBranch = await commitAndPush(
    cloneDir,
    accessToken,
    owner,
    repo,
    branchName,
    commitMessage,
    generatedFiles  // pass changes directly to the API layer
  )

  // ── STEP 8: PR description (Gemini Flash) ────────────────────
  await progress('🔀 Opening pull request…')
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
    body:
      prBody +
      `\n\n---\n*Complexity: **${complexity}** · Model: \`${modelLabel}\`*`,
    head: pushedBranch,
    base: defaultBranch,
  })

  // ── STEP 9: Vercel deploy ─────────────────────────────────────
  let deployUrl: string | null = null
  if (vercelProject) {
    try {
      await progress('⚡ Triggering Vercel deploy…')
      deployUrl = await triggerVercelDeploy(vercelProject, repoFullName)
    } catch {
      // Non-fatal
    }
  }

  // ── STEP 10: Incremental RAG re-index (fire and forget) ───────
  const changedPaths = generatedFiles
    .filter((f) => f.action !== 'delete')
    .map((f) => f.path)

  reindexChangedFiles(
    projectId, repoFullName, accessToken, changedPaths, defaultBranch
  ).catch(console.error)

  return {
    prUrl: pr.html_url,
    deployUrl,
    filesChanged: generatedFiles.map((f) => ({
      path: f.path,
      action: f.action,
    })),
    summary: plan.summary,
    branchName: pushedBranch,
    complexity,
    modelUsed: useClaudeForComplex ? 'claude-sonnet-4-5' : modelUsed,
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
