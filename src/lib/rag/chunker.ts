// ════════════════════════════════════════════════════════════════
// Smart Code Chunker
// Splits code at semantic boundaries (functions, classes, exports)
// rather than arbitrary character windows.
// ════════════════════════════════════════════════════════════════

export interface RawChunk {
  content: string
  startLine: number
  endLine: number
  language: string
  filePath: string
}

const MAX_CHUNK_CHARS = 3_000   // ~750 tokens — fits well in embedding context
const MIN_CHUNK_CHARS = 50      // skip empty/trivial chunks

// ── Language detection ────────────────────────────────────────────

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', pyi: 'python',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin', kts: 'kotlin',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    swift: 'swift',
    scala: 'scala',
    sql: 'sql',
    sh: 'shell', bash: 'shell',
    md: 'markdown', mdx: 'markdown',
    json: 'json',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    graphql: 'graphql', gql: 'graphql',
    html: 'html',
    css: 'css', scss: 'scss', sass: 'scss',
    vue: 'vue',
    svelte: 'svelte',
    prisma: 'prisma',
  }
  return map[ext] ?? 'text'
}

// ── Main chunker entry point ──────────────────────────────────────

export function chunkFile(filePath: string, content: string): RawChunk[] {
  const language = detectLanguage(filePath)

  // Dispatch to language-aware chunker
  if (['typescript', 'javascript'].includes(language)) {
    return chunkByTopLevelDeclarations(filePath, content, language)
  }
  if (language === 'python') {
    return chunkPython(filePath, content)
  }
  if (language === 'go') {
    return chunkGo(filePath, content)
  }
  if (['markdown', 'json', 'yaml', 'toml', 'prisma'].includes(language)) {
    return chunkFixed(filePath, content, language)
  }
  // Default: line-window chunking
  return chunkByLines(filePath, content, language)
}

// ── TypeScript / JavaScript: top-level declarations ───────────────

const TS_TOP_LEVEL = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+\w/

function chunkByTopLevelDeclarations(
  filePath: string,
  content: string,
  language: string
): RawChunk[] {
  const lines = content.split('\n')
  const chunks: RawChunk[] = []

  // Find line indices of top-level declarations
  const boundaries: number[] = [0]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (TS_TOP_LEVEL.test(line)) {
      if (i > 0) boundaries.push(i)
    }
  }
  boundaries.push(lines.length)

  for (let b = 0; b < boundaries.length - 1; b++) {
    const startLine = boundaries[b]
    const endLine = boundaries[b + 1] - 1
    const text = lines.slice(startLine, endLine + 1).join('\n').trim()

    if (text.length < MIN_CHUNK_CHARS) continue

    // If this chunk is too large, sub-split it
    if (text.length > MAX_CHUNK_CHARS) {
      const subChunks = splitLargeChunk(filePath, text, startLine, language)
      chunks.push(...subChunks)
    } else {
      chunks.push({
        content: `// File: ${filePath}\n\n${text}`,
        startLine: startLine + 1,
        endLine: endLine + 1,
        language,
        filePath,
      })
    }
  }

  return chunks.length > 0 ? chunks : chunkByLines(filePath, content, language)
}

// ── Python: def / class boundaries ───────────────────────────────

const PY_TOP_LEVEL = /^(?:def |class |async def )/

function chunkPython(filePath: string, content: string): RawChunk[] {
  const lines = content.split('\n')
  const chunks: RawChunk[] = []
  const boundaries: number[] = [0]

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    // Top-level def/class = not indented
    if (PY_TOP_LEVEL.test(line) && !/^\s/.test(line)) {
      boundaries.push(i)
    }
  }
  boundaries.push(lines.length)

  for (let b = 0; b < boundaries.length - 1; b++) {
    const startLine = boundaries[b]
    const endLine = boundaries[b + 1] - 1
    const text = lines.slice(startLine, endLine + 1).join('\n').trim()
    if (text.length < MIN_CHUNK_CHARS) continue
    if (text.length > MAX_CHUNK_CHARS) {
      chunks.push(...splitLargeChunk(filePath, text, startLine, 'python'))
    } else {
      chunks.push({
        content: `# File: ${filePath}\n\n${text}`,
        startLine: startLine + 1,
        endLine: endLine + 1,
        language: 'python',
        filePath,
      })
    }
  }

  return chunks.length > 0 ? chunks : chunkByLines(filePath, content, 'python')
}

// ── Go: func boundaries ───────────────────────────────────────────

const GO_FUNC = /^func\s/

function chunkGo(filePath: string, content: string): RawChunk[] {
  const lines = content.split('\n')
  const chunks: RawChunk[] = []
  const boundaries: number[] = [0]

  for (let i = 1; i < lines.length; i++) {
    if (GO_FUNC.test(lines[i])) boundaries.push(i)
  }
  boundaries.push(lines.length)

  for (let b = 0; b < boundaries.length - 1; b++) {
    const startLine = boundaries[b]
    const endLine = boundaries[b + 1] - 1
    const text = lines.slice(startLine, endLine + 1).join('\n').trim()
    if (text.length < MIN_CHUNK_CHARS) continue
    if (text.length > MAX_CHUNK_CHARS) {
      chunks.push(...splitLargeChunk(filePath, text, startLine, 'go'))
    } else {
      chunks.push({
        content: `// File: ${filePath}\n\n${text}`,
        startLine: startLine + 1,
        endLine: endLine + 1,
        language: 'go',
        filePath,
      })
    }
  }
  return chunks.length > 0 ? chunks : chunkByLines(filePath, content, 'go')
}

// ── Fixed-size chunking for configs / docs ────────────────────────

function chunkFixed(filePath: string, content: string, language: string): RawChunk[] {
  if (content.length <= MAX_CHUNK_CHARS) {
    return [
      {
        content: `# File: ${filePath}\n\n${content}`,
        startLine: 1,
        endLine: content.split('\n').length,
        language,
        filePath,
      },
    ]
  }
  return chunkByLines(filePath, content, language)
}

// ── Line-window fallback ──────────────────────────────────────────

const LINES_PER_WINDOW = 60
const LINES_OVERLAP = 10

function chunkByLines(filePath: string, content: string, language: string): RawChunk[] {
  const lines = content.split('\n')
  if (lines.length === 0) return []

  const chunks: RawChunk[] = []
  let start = 0

  while (start < lines.length) {
    const end = Math.min(start + LINES_PER_WINDOW, lines.length)
    const text = lines.slice(start, end).join('\n').trim()
    if (text.length >= MIN_CHUNK_CHARS) {
      chunks.push({
        content: `// File: ${filePath}\n\n${text}`,
        startLine: start + 1,
        endLine: end,
        language,
        filePath,
      })
    }
    if (end >= lines.length) break
    start = end - LINES_OVERLAP
  }
  return chunks
}

// ── Split an oversized chunk ──────────────────────────────────────

function splitLargeChunk(
  filePath: string,
  text: string,
  baseStartLine: number,
  language: string
): RawChunk[] {
  const lines = text.split('\n')
  return chunkByLines(filePath, lines.join('\n'), language).map((c) => ({
    ...c,
    startLine: c.startLine + baseStartLine,
    endLine: c.endLine + baseStartLine,
  }))
}

// ── Token estimator (rough: 1 token ≈ 4 chars) ───────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
