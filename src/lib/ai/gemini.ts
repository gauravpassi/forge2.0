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

// ── Embedding ─────────────────────────────────────────────────────

/** Embed a single text string → 768-dim vector (text-embedding-004) */
export async function embedText(text: string): Promise<number[]> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
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

const FLASH = 'gemini-2.0-flash'
const FLASH_THINKING = 'gemini-2.5-flash-preview-04-17'

export interface GenerateOptions {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  systemInstruction?: string
}

/** Single-turn text generation with Gemini Flash */
export async function generate(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({
    model: options.model ?? FLASH,
    ...(options.systemInstruction
      ? { systemInstruction: options.systemInstruction }
      : {}),
    generationConfig: {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
    },
  })
  const result = await model.generateContent(prompt)
  return result.response.text()
}

/** Generate with complex reasoning (Gemini 2.5 Flash Thinking) */
export async function generateWithThinking(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  return generate(prompt, { ...options, model: FLASH_THINKING })
}

/** Parse JSON from Gemini response (strips markdown fences) */
export function parseJsonResponse<T>(text: string): T {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

export { FLASH, FLASH_THINKING }
