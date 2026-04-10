import os from 'node:os'
import path from 'node:path'

export interface DiscoveredClaudeAgent {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly model?: string
  readonly source: 'builtin' | 'project' | 'user'
}

interface FindClaudeAgentOptions {
  readonly projectRoot?: string
  readonly userAgentsDir?: string
  readonly readDir?: (dirPath: string) => Promise<ReadonlyArray<string>>
  readonly readFileText?: (filePath: string) => Promise<string>
  readonly logWarning?: (message: string) => void
}

interface ParsedClaudeAgentFields {
  readonly id?: string
  readonly description?: string
  readonly model?: string
}

const BUILT_IN_AGENTS: Readonly<Record<string, DiscoveredClaudeAgent>> = {
  explore: {
    id: 'Explore',
    name: 'Explore',
    description: 'A fast, read-only agent optimized for searching and analyzing codebases.',
    model: 'haiku',
    source: 'builtin',
  },
  plan: {
    id: 'Plan',
    name: 'Plan',
    description:
      'A research agent used during plan mode to gather context before presenting a plan.',
    model: 'inherit',
    source: 'builtin',
  },
  'general-purpose': {
    id: 'general-purpose',
    name: 'General-purpose',
    description:
      'A capable agent for complex, multi-step tasks that require both exploration and action.',
    model: 'inherit',
    source: 'builtin',
  },
} as const

export async function findDiscoveredClaudeAgentById(
  id: string,
  options: FindClaudeAgentOptions = {}
): Promise<DiscoveredClaudeAgent | null> {
  const normalizedLookup = normalizeId(id)
  if (!normalizedLookup) {
    return null
  }

  for (const { dirPath, source } of discoverAgentDirs(options)) {
    const match = await scanDirForAgent(normalizedLookup, dirPath, source, options)
    if (match) {
      return match
    }
  }

  return BUILT_IN_AGENTS[normalizedLookup] ?? null
}

function discoverAgentDirs(options: FindClaudeAgentOptions) {
  const projectDirs =
    options.projectRoot && options.projectRoot.trim().length > 0
      ? walkProjectAgentDirs(options.projectRoot)
      : []
  const userAgentsDir =
    options.userAgentsDir && options.userAgentsDir.trim().length > 0
      ? options.userAgentsDir
      : path.join(os.homedir(), '.claude', 'agents')
  return [
    ...projectDirs.map(dirPath => ({ dirPath, source: 'project' as const })),
    { dirPath: userAgentsDir, source: 'user' as const },
  ]
}

function walkProjectAgentDirs(projectRoot: string): ReadonlyArray<string> {
  const dirs: string[] = []
  const seen = new Set<string>()
  let current = path.resolve(projectRoot)
  while (true) {
    const dirPath = path.join(current, '.claude', 'agents')
    if (!seen.has(dirPath)) {
      seen.add(dirPath)
      dirs.push(dirPath)
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return dirs
}

async function scanDirForAgent(
  lookupId: string,
  dirPath: string,
  source: DiscoveredClaudeAgent['source'],
  options: FindClaudeAgentOptions
): Promise<DiscoveredClaudeAgent | null> {
  const readDir = options.readDir ?? readDirFs
  const readFileText = options.readFileText ?? readFileTextFs
  const logWarning = options.logWarning ?? (() => undefined)

  let entries: ReadonlyArray<string>
  try {
    entries = await readDir(dirPath)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null
    }
    logWarning(`claude agent dir read failed at ${dirPath}: ${describeError(error)}`)
    return null
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue
    }
    const fullPath = path.join(dirPath, entry)
    const parsed = await parseClaudeAgentFile(fullPath, readFileText, logWarning)
    if (!parsed) {
      continue
    }
    if (normalizeId(parsed.id ?? path.basename(entry, '.md')) !== lookupId) {
      continue
    }
    return {
      id: parsed.id ?? path.basename(entry, '.md'),
      name: formatDisplayName(parsed.id ?? path.basename(entry, '.md')),
      source,
      ...(parsed.description ? { description: parsed.description } : {}),
      ...(parsed.model ? { model: parsed.model } : {}),
    }
  }

  return null
}

async function parseClaudeAgentFile(
  fullPath: string,
  readFileText: (filePath: string) => Promise<string>,
  logWarning: (message: string) => void
): Promise<ParsedClaudeAgentFields | null> {
  let content: string
  try {
    content = await readFileText(fullPath)
  } catch (error) {
    logWarning(`claude agent read failed at ${fullPath}: ${describeError(error)}`)
    return null
  }
  const frontmatter = extractFrontmatter(content)
  if (frontmatter === null) {
    logWarning(`claude agent missing frontmatter at ${fullPath}`)
    return null
  }
  return parseFrontmatterFields(frontmatter)
}

const FRONTMATTER_DELIMITER = '---'

function extractFrontmatter(content: string): string | null {
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content
  if (!stripped.startsWith(FRONTMATTER_DELIMITER)) {
    return null
  }
  const afterFirst = stripped.slice(FRONTMATTER_DELIMITER.length)
  const newlineIndex = afterFirst.indexOf('\n')
  if (newlineIndex === -1) {
    return null
  }
  const body = afterFirst.slice(newlineIndex + 1)
  const closingPattern = /\r?\n---\s*(?:\r?\n|$)/
  const match = closingPattern.exec(body)
  if (!match) {
    return null
  }
  return body.slice(0, match.index)
}

function parseFrontmatterFields(block: string): ParsedClaudeAgentFields {
  let id: string | undefined
  let description: string | undefined
  let model: string | undefined
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) {
      continue
    }
    const key = line.slice(0, colonIndex).trim()
    const value = unquote(line.slice(colonIndex + 1).trim())
    if (!value) {
      continue
    }
    if (key === 'name') {
      id = value
    } else if (key === 'description') {
      description = value
    } else if (key === 'model') {
      model = value
    }
  }
  return {
    ...(id ? { id } : {}),
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
  }
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0)
    const last = value.charAt(value.length - 1)
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

function formatDisplayName(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(part => part.length > 0)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function readDirFs(dirPath: string): Promise<ReadonlyArray<string>> {
  const entries = await import('node:fs/promises').then(fs => fs.readdir(dirPath))
  return entries
}

async function readFileTextFs(filePath: string): Promise<string> {
  return import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf8'))
}
