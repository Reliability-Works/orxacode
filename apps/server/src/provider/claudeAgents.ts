import os from 'node:os'
import path from 'node:path'
import { formatSubagentLabel } from '@orxa-code/shared/subagent'
import {
  describeAgentFileError,
  extractAgentFrontmatter,
  isAgentFileNotFoundError,
  listFrontmatterEntries,
} from './agentFileHelpers.ts'

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
    if (isAgentFileNotFoundError(error)) {
      return null
    }
    logWarning(`claude agent dir read failed at ${dirPath}: ${describeAgentFileError(error)}`)
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
      name: formatSubagentLabel(parsed.id ?? path.basename(entry, '.md')) ?? 'Claude Subagent',
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
    logWarning(`claude agent read failed at ${fullPath}: ${describeAgentFileError(error)}`)
    return null
  }
  const frontmatter = extractAgentFrontmatter(content)
  if (frontmatter === null) {
    logWarning(`claude agent missing frontmatter at ${fullPath}`)
    return null
  }
  return parseFrontmatterFields(frontmatter)
}

function parseFrontmatterFields(block: string): ParsedClaudeAgentFields {
  let id: string | undefined
  let description: string | undefined
  let model: string | undefined
  for (const [key, value] of listFrontmatterEntries(block)) {
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

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

async function readDirFs(dirPath: string): Promise<ReadonlyArray<string>> {
  const entries = await import('node:fs/promises').then(fs => fs.readdir(dirPath))
  return entries
}

async function readFileTextFs(filePath: string): Promise<string> {
  return import('node:fs/promises').then(fs => fs.readFile(filePath, 'utf8'))
}
