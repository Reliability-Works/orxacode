/**
 * Filesystem discovery of opencode primary agents.
 *
 * Scans the user's `~/.config/opencode/agents` and `~/.local/share/opencode/agents`
 * directories (or their `XDG_*` overrides), parses `*.md` files via a small
 * line-based YAML frontmatter reader, parses `*.json` files directly, filters
 * `mode: primary`, dedupes by id (config dir wins over data dir), and returns
 * an alphabetically sorted `OpencodeAgent[]` matching the f01 contract.
 *
 * The YAML parser supports the minimal subset that opencode actually emits in
 * the user's real agent files: `key: value` pairs at the top level, with
 * optional single/double quoting on values. That covers the keys we need
 * (`mode`, `name`, `description`). Anything richer is ignored on purpose —
 * we never crash on unsupported syntax, only on a malformed JSON file.
 *
 * @module opencodeAgents
 */
import { homedir } from 'node:os'
import { join as joinPath, basename, extname } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'

import type { OpencodeAgent } from '@orxa-code/contracts'

export interface ListOpencodePrimaryAgentsInput {
  readonly configDir?: string | undefined
  readonly dataDir?: string | undefined
  readonly readDir?: ((path: string) => Promise<ReadonlyArray<string>>) | undefined
  readonly readFileText?: ((path: string) => Promise<string>) | undefined
  readonly logWarning?: ((message: string) => void) | undefined
}

const noopLogWarning: (message: string) => void = () => {}

const defaultReadDir = async (path: string): Promise<ReadonlyArray<string>> => {
  return readdir(path)
}

const defaultReadFileText = (path: string): Promise<string> => readFile(path, 'utf8')

export function defaultOpencodeAgentConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.length > 0 ? xdg : joinPath(homedir(), '.config')
  return joinPath(base, 'opencode', 'agents')
}

export function defaultOpencodeAgentDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : joinPath(homedir(), '.local', 'share')
  return joinPath(base, 'opencode', 'agents')
}

interface ParsedAgentFields {
  readonly mode?: string | undefined
  readonly name?: string | undefined
  readonly description?: string | undefined
}

export async function listOpencodePrimaryAgents(
  input?: ListOpencodePrimaryAgentsInput
): Promise<ReadonlyArray<OpencodeAgent>> {
  const readDir = input?.readDir ?? defaultReadDir
  const readFileText = input?.readFileText ?? defaultReadFileText
  const logWarning = input?.logWarning ?? noopLogWarning
  const configDir = input?.configDir ?? defaultOpencodeAgentConfigDir()
  const dataDir = input?.dataDir ?? defaultOpencodeAgentDataDir()

  const collected = new Map<string, OpencodeAgent>()

  const dataAgents = await scanAgentDir({
    dir: dataDir,
    source: 'data',
    readDir,
    readFileText,
    logWarning,
  })
  for (const agent of dataAgents) {
    collected.set(agent.id, agent)
  }
  const configAgents = await scanAgentDir({
    dir: configDir,
    source: 'config',
    readDir,
    readFileText,
    logWarning,
  })
  for (const agent of configAgents) {
    collected.set(agent.id, agent)
  }

  return Array.from(collected.values()).sort((left, right) => left.id.localeCompare(right.id))
}

interface ScanAgentDirInput {
  readonly dir: string
  readonly source: OpencodeAgent['source']
  readonly readDir: (path: string) => Promise<ReadonlyArray<string>>
  readonly readFileText: (path: string) => Promise<string>
  readonly logWarning: (message: string) => void
}

async function scanAgentDir(input: ScanAgentDirInput): Promise<ReadonlyArray<OpencodeAgent>> {
  let entries: ReadonlyArray<string>
  try {
    entries = await input.readDir(input.dir)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }
    input.logWarning(`opencode agents read failed at ${input.dir}: ${describeError(error)}`)
    return []
  }
  const result: Array<OpencodeAgent> = []
  for (const entry of entries) {
    const ext = extname(entry).toLowerCase()
    if (ext !== '.md' && ext !== '.json') continue
    const id = basename(entry, ext).trim()
    if (id.length === 0) continue
    const fullPath = joinPath(input.dir, entry)
    const agent = await parseAgentFile({
      id,
      fullPath,
      ext,
      source: input.source,
      readFileText: input.readFileText,
      logWarning: input.logWarning,
    })
    if (agent) result.push(agent)
  }
  return result
}

interface ParseAgentFileInput {
  readonly id: string
  readonly fullPath: string
  readonly ext: '.md' | '.json'
  readonly source: OpencodeAgent['source']
  readonly readFileText: (path: string) => Promise<string>
  readonly logWarning: (message: string) => void
}

async function parseAgentFile(input: ParseAgentFileInput): Promise<OpencodeAgent | null> {
  let content: string
  try {
    content = await input.readFileText(input.fullPath)
  } catch (error) {
    input.logWarning(`opencode agent read failed at ${input.fullPath}: ${describeError(error)}`)
    return null
  }
  let fields: ParsedAgentFields
  if (input.ext === '.md') {
    const frontmatter = extractFrontmatter(content)
    if (frontmatter === null) {
      input.logWarning(`opencode agent missing frontmatter at ${input.fullPath}`)
      return null
    }
    fields = parseFrontmatterFields(frontmatter)
  } else {
    fields = parseJsonAgent(content, input.fullPath, input.logWarning)
  }
  if (fields.mode !== 'primary') return null
  const name = fields.name && fields.name.length > 0 ? fields.name : input.id
  const description = fields.description
  return {
    id: input.id,
    name,
    mode: 'primary',
    source: input.source,
    ...(description ? { description } : {}),
  }
}

function parseJsonAgent(
  content: string,
  fullPath: string,
  logWarning: (message: string) => void
): ParsedAgentFields {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      mode: typeof record.mode === 'string' ? record.mode : undefined,
      name: typeof record.name === 'string' ? record.name.trim() : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
    }
  } catch (error) {
    logWarning(`opencode agent json malformed at ${fullPath}: ${describeError(error)}`)
    return {}
  }
}

const FRONTMATTER_DELIMITER = '---'

function extractFrontmatter(content: string): string | null {
  // Strip a leading BOM if present so the delimiter test still matches.
  const stripped = content.startsWith('\uFEFF') ? content.slice(1) : content
  if (!stripped.startsWith(FRONTMATTER_DELIMITER)) return null
  const afterFirst = stripped.slice(FRONTMATTER_DELIMITER.length)
  const newlineIndex = afterFirst.indexOf('\n')
  if (newlineIndex === -1) return null
  const body = afterFirst.slice(newlineIndex + 1)
  const closingPattern = /\r?\n---\s*(?:\r?\n|$)/
  const match = closingPattern.exec(body)
  if (!match) return null
  return body.slice(0, match.index)
}

function parseFrontmatterFields(block: string): ParsedAgentFields {
  let mode: string | undefined
  let name: string | undefined
  let description: string | undefined
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const value = unquote(line.slice(colonIndex + 1).trim())
    if (value.length === 0) continue
    if (key === 'mode') mode = value
    else if (key === 'name') name = value
    else if (key === 'description') description = value
  }
  return { mode, name, description }
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

function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
