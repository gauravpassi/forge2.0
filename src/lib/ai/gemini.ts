import { GoogleGenerativeAI } from '@google/generative-ai'

let _genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY not set')
    _genAI = new GoogleGenerativeAI(apiKey)
  }
  return _genAI
}

// ── Models ────────────────────────────────────────────────────────

export const MODELS = {
  // Tier 1 — simple tasks, commit messages, PR bodies, embeddings
  FLASH:   'gemini-2.0-flash',
  // Tier 2 — new features, moderate complexity
  FLASH_25: 'gemini-2.5-flash-preview-05-20',
  // Tier 3 — architecture, refactors, multi-file complex tasks
  THINKING: 'gemini-2.5-flash-preview-05-20', // thinking mode via thinkingConfig
} as const

export type TaskComplexity = 'simple' | 'medium' | 'complex'

// ── Complexity classifier ─────────────────────────────────────────

const COMPLEX_KEYWORDS = [
  'refactor', 'migrate', 'migration', 'redesign', 'architecture',
  'integrate', 'integration', 'overhaul', 'restructure', 'rewrite',
  'implement', 'build', 'create', 'module', 'system', 'framework',
  'authentication', 'authorization', 'database', 'schema', 'api',
  'pipeline', 'workflow', 'service', 'provider', 'middleware',
]

const SIMPLE_KEYWORDS = [
  'fix', 'bug', 'typo', 'rename', 'color', 'style', 'css',
  'text', 'label', 'copy', 'wording', 'margin', 'padding',
  'remove', 'delete', 'update', 'change', 'adjust', 'tweak',
  'add prop', 'add field', 'add class', 'add attribute',
  'button', 'icon', 'tooltip', 'placeholder', 'import',
]

/**
 * Classify a task's complexity based on its description and
 * the number of files the agent plans to touch.
 */
export function classifyComplexity(
  description: string,
  plannedFileCount: number
): TaskComplexity {
  const lower = description.toLowerCase()

  const isComplex =
    plannedFileCount >= 5 ||
    COMPLEX_KEYWORDS.some((k) => lower.includes(k))

  const isSimple =
    plannedFileCount <= 2 &&
    SIMPLE_KEYWORDS.some((k) => lower.includes(k)) &&
    !isComplex

  if (isComplex) return 'complex'
  if (isSimple) return 'simple'
  return 'medium'
}

/** Pick the right model for a given complexity tier */
export function modelForComplexity(complexity: TaskComplexity): string {
  switch (complexity) {
    case 'simple':  return MODELS.FLASH
    case 'medium':  return MODELS.FLASH_25
    case 'complex': return MODELS.THINKING
  }
}

// ── Embedding ─────────────────────────────────────────────────────

/** Embed a single text string → 768-dim vector (text-embedding-004) */
export async function embedText(text: string): Promise<number[]> {
  const genAI = getGenAI()
  // text-embedding-004 is only available on the v1 API (not v1beta)
  const model = genAI.getGenerativeModel(
    { model: 'text-embedding-004' },
    { apiVersion: 'v1' }
  )
  const result = await model.embedContent(text)
  return result.embedding.values
}

/** Embed multiple texts in batches of 20 (API limit) */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 20
  const results: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const embeddings = await Promise.all(batch.map(embedText))
    results.push(...embeddings)
  }
  return results
}

// ── Generation ────────────────────────────────────────────────────

export interface GenerateOptions {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  systemInstruction?: string
  /** Enable extended thinking (only effective on 2.5 Flash Thinking) */
  thinking?: boolean
}

/** Single-turn text generation */
export async function generate(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const genAI = getGenAI()

  const modelName = options.model ?? MODELS.FLASH
  const useThinking = options.thinking && modelName === MODELS.THINKING

  const model = genAI.getGenerativeModel({
    model: modelName,
    ...(options.systemInstruction
      ? { systemInstruction: options.systemInstruction }
      : {}),
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
    },
    // Enable thinking budget for complex tasks
    ...(useThinking
      ? {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          thinkingConfig: { thinkingBudget: 8192 } as any,
        }
      : {}),
  })

  const result = await model.generateContent(prompt)
  return result.response.text()
}

/**
 * Generate code/text using the appropriate model for the task's complexity.
 * This is the main entry point used by the agent for all generation calls.
 */
export async function generateForComplexity(
  prompt: string,
  complexity: TaskComplexity,
  options: Omit<GenerateOptions, 'model'> = {}
): Promise<string> {
  const model = modelForComplexity(complexity)
  const useThinking = complexity === 'complex'

  return generate(prompt, {
    ...options,
    model,
    thinking: useThinking,
    // Complex tasks get more output tokens
    maxOutputTokens: options.maxOutputTokens ?? (
      complexity === 'complex' ? 16384 :
      complexity === 'medium'  ? 10240 :
                                  6144
    ),
    // Lower temperature for complex tasks (more deterministic)
    temperature: options.temperature ?? (
      complexity === 'complex' ? 0.1 :
      complexity === 'medium'  ? 0.15 :
                                  0.2
    ),
  })
}

/** Parse JSON from Gemini response (strips markdown fences) */
export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

/** Estimate cost for a task (approximate, in USD) */
export function estimateCost(complexity: TaskComplexity, fileCount: number): string {
  const base = complexity === 'simple' ? 0.003 : complexity === 'medium' ? 0.010 : 0.025
  const perFile = complexity === 'simple' ? 0.001 : complexity === 'medium' ? 0.003 : 0.006
  const total = base + fileCount * perFile
  return `~$${total.toFixed(3)}`
}
