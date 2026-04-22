// ════════════════════════════════════════════════════════════════
// Forge 2.0 — Claude Client
//
// Wraps Anthropic SDK with:
//  - Prompt caching (cache architecture context once per task)
//  - Extended thinking for complex tasks
//  - Lazy initialization (safe for builds without API key)
// ════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

// ── Model constants ───────────────────────────────────────────────
export const CLAUDE_MODEL = 'claude-sonnet-4-5'
export const CLAUDE_HAIKU  = 'claude-haiku-4-5'   // fallback cheap tier if needed

// ── Lazy client ───────────────────────────────────────────────────
let _client: Anthropic | null = null

export function getClaudeClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey === 'your-anthropic-api-key') {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

export function isClaudeAvailable(): boolean {
  const key = process.env.ANTHROPIC_API_KEY
  return !!key && key !== 'your-anthropic-api-key'
}

// ── Core generation ───────────────────────────────────────────────

export interface ClaudeGenerateOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  /** Enable extended thinking (budgetTokens = thinking token budget) */
  thinking?: { budgetTokens: number }
}

/**
 * Generate code with Claude, using prompt caching.
 *
 * @param systemPrompt       Cached — invariant for this task session
 * @param cachedContext      Cached — architecture/type context (same for all files in task)
 * @param uncachedPrompt     Not cached — file-specific content + task instruction
 */
export async function claudeGenerate(
  systemPrompt: string,
  cachedContext: string,
  uncachedPrompt: string,
  options: ClaudeGenerateOptions = {}
): Promise<string> {
  const client = getClaudeClient()
  const model = options.model ?? CLAUDE_MODEL

  // Build the user message content blocks
  // Cache as many blocks as possible to maximise savings.
  const userContent: Anthropic.ContentBlockParam[] = []

  if (cachedContext.trim()) {
    userContent.push({
      type: 'text',
      text: cachedContext,
      // Mark for caching — Claude caches up to 4 blocks per request
      // Cache TTL: 5 minutes (sufficient for a single task run)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cache_control: { type: 'ephemeral' } as any,
    })
  }

  userContent.push({
    type: 'text',
    text: uncachedPrompt,
    // No cache_control — this changes per file
  })

  // Build request params
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: options.maxTokens ?? 8192,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        // Cache the system prompt too (same for the whole task)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cache_control: { type: 'ephemeral' } as any,
      },
    ],
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
  }

  // Extended thinking for complex tasks
  if (options.thinking) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(params as any).thinking = {
      type: 'enabled',
      budget_tokens: options.thinking.budgetTokens,
    }
    // Thinking requires temperature = 1
    ;(params as any).temperature = 1
  } else if (options.temperature !== undefined) {
    params.temperature = options.temperature
  }

  const response = await client.messages.create(params)

  // Log cache performance
  const usage = response.usage as Anthropic.Usage & {
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
    console.log(
      `[Claude cache] created=${usage.cache_creation_input_tokens ?? 0} ` +
      `read=${usage.cache_read_input_tokens ?? 0} ` +
      `uncached=${usage.input_tokens} output=${usage.output_tokens}`
    )
  }

  // Extract text content (skip thinking blocks)
  const textBlocks = response.content.filter((b) => b.type === 'text')
  return textBlocks.map((b) => (b as Anthropic.TextBlock).text).join('')
}

// ── Cost estimator ────────────────────────────────────────────────

export interface CostEstimate {
  inputCost: number
  outputCost: number
  cacheSavings: number
  total: number
  formatted: string
}

// Claude Sonnet 4.5 pricing (per million tokens, USD)
const SONNET_PRICING = {
  input:          3.00,
  cacheWrite:     3.75,   // 1.25x input
  cacheRead:      0.30,   // 0.10x input
  output:        15.00,
}

export function estimateClaudeCost(usage: {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}): CostEstimate {
  const MTok = 1_000_000
  const inputCost  = (usage.inputTokens / MTok) * SONNET_PRICING.input
  const outputCost = (usage.outputTokens / MTok) * SONNET_PRICING.output
  const cacheWriteCost = ((usage.cacheCreationTokens ?? 0) / MTok) * SONNET_PRICING.cacheWrite
  const cacheReadCost  = ((usage.cacheReadTokens ?? 0) / MTok) * SONNET_PRICING.cacheRead

  // What it would have cost without caching
  const withoutCache = ((usage.cacheCreationTokens ?? 0) + (usage.cacheReadTokens ?? 0)) / MTok * SONNET_PRICING.input
  const withCache = cacheWriteCost + cacheReadCost
  const cacheSavings = Math.max(0, withoutCache - withCache)

  const total = inputCost + outputCost + cacheWriteCost + cacheReadCost
  return {
    inputCost,
    outputCost,
    cacheSavings,
    total,
    formatted: `$${total.toFixed(4)}${cacheSavings > 0.001 ? ` (saved $${cacheSavings.toFixed(4)} via cache)` : ''}`,
  }
}
