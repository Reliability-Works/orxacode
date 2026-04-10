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
import {
  describeAgentFileError,
  extractAgentFrontmatter,
  isAgentFileNotFoundError,
  listFrontmatterEntries,
} from './agentFileHelpers.ts'

type OpencodeAgentMode = 'primary' | 'subagent'

export interface DiscoveredOpencodeAgent {
  readonly id: string
  readonly name: string
  readonly mode: OpencodeAgentMode
  readonly source: OpencodeAgent['source']
  readonly description?: string | undefined
  readonly model?: string | undefined
}

export interface ListOpencodePrimaryAgentsInput {
  readonly configDir?: string | undefined
  readonly dataDir?: string | undefined
  readonly configFilePath?: string | undefined
  readonly projectRoot?: string | undefined
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

export function defaultOpencodeConfigFilePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  const base = xdg && xdg.length > 0 ? xdg : joinPath(homedir(), '.config')
  return joinPath(base, 'opencode', 'opencode.json')
}

export function defaultOpencodeAgentDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : joinPath(homedir(), '.local', 'share')
  return joinPath(base, 'opencode', 'agents')
}

export function defaultProjectOpencodeConfigFilePath(projectRoot: string): string {
  return joinPath(projectRoot, 'opencode.json')
}

export function defaultProjectOpencodeAgentDir(projectRoot: string): string {
  return joinPath(projectRoot, '.opencode', 'agents')
}

interface ParsedAgentFields {
  readonly mode?: string | undefined
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly model?: string | undefined
}

export async function listOpencodePrimaryAgents(
  input?: ListOpencodePrimaryAgentsInput
): Promise<ReadonlyArray<OpencodeAgent>> {
  const discovered = await listDiscoveredOpencodeAgents(input)
  return discovered
    .filter((agent): agent is OpencodeAgent => agent.mode === 'primary')
    .sort((left, right) => left.id.localeCompare(right.id))
}

export async function findDiscoveredOpencodeAgentById(
  agentId: string,
  input?: ListOpencodePrimaryAgentsInput
): Promise<DiscoveredOpencodeAgent | null> {
  const discovered = await listDiscoveredOpencodeAgents(input)
  return discovered.find(agent => agent.id === agentId) ?? null
}

async function listDiscoveredOpencodeAgents(
  input?: ListOpencodePrimaryAgentsInput
): Promise<ReadonlyArray<DiscoveredOpencodeAgent>> {
  const readDir = input?.readDir ?? defaultReadDir
  const readFileText = input?.readFileText ?? defaultReadFileText
  const logWarning = input?.logWarning ?? noopLogWarning
  const configDir = input?.configDir ?? defaultOpencodeAgentConfigDir()
  const dataDir = input?.dataDir ?? defaultOpencodeAgentDataDir()
  const configFilePath = input?.configFilePath ?? defaultOpencodeConfigFilePath()
  const projectConfigFilePath = input?.projectRoot
    ? defaultProjectOpencodeConfigFilePath(input.projectRoot)
    : null
  const projectAgentDir = input?.projectRoot
    ? defaultProjectOpencodeAgentDir(input.projectRoot)
    : null

  const collected = new Map<string, DiscoveredOpencodeAgent>()

  applyDiscoveredAgents(
    collected,
    await scanAgentDir({
      dir: dataDir,
      source: 'data',
      readDir,
      readFileText,
      logWarning,
    })
  )
  applyDiscoveredAgents(
    collected,
    await scanConfigFile({
      filePath: configFilePath,
      source: 'config',
      readFileText,
      logWarning,
    })
  )
  applyDiscoveredAgents(
    collected,
    await scanAgentDir({
      dir: configDir,
      source: 'config',
      readDir,
      readFileText,
      logWarning,
    })
  )
  if (projectConfigFilePath) {
    applyDiscoveredAgents(
      collected,
      await scanConfigFile({
        filePath: projectConfigFilePath,
        source: 'config',
        readFileText,
        logWarning,
      })
    )
  }
  if (projectAgentDir) {
    applyDiscoveredAgents(
      collected,
      await scanAgentDir({
        dir: projectAgentDir,
        source: 'config',
        readDir,
        readFileText,
        logWarning,
      })
    )
  }

  return Array.from(collected.values()).sort((left, right) => left.id.localeCompare(right.id))
}

function applyDiscoveredAgents(
  collected: Map<string, DiscoveredOpencodeAgent>,
  agents: ReadonlyArray<DiscoveredOpencodeAgent>
): void {
  for (const agent of agents) {
    collected.set(agent.id, agent)
  }
}

interface ScanAgentDirInput {
  readonly dir: string
  readonly source: OpencodeAgent['source']
  readonly readDir: (path: string) => Promise<ReadonlyArray<string>>
  readonly readFileText: (path: string) => Promise<string>
  readonly logWarning: (message: string) => void
}

async function scanAgentDir(
  input: ScanAgentDirInput
): Promise<ReadonlyArray<DiscoveredOpencodeAgent>> {
  let entries: ReadonlyArray<string>
  try {
    entries = await input.readDir(input.dir)
  } catch (error) {
    if (isAgentFileNotFoundError(error)) {
      return []
    }
    input.logWarning(
      `opencode agents read failed at ${input.dir}: ${describeAgentFileError(error)}`
    )
    return []
  }
  const result: Array<DiscoveredOpencodeAgent> = []
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

interface ScanConfigFileInput {
  readonly filePath: string
  readonly source: OpencodeAgent['source']
  readonly readFileText: (path: string) => Promise<string>
  readonly logWarning: (message: string) => void
}

async function parseAgentFile(input: ParseAgentFileInput): Promise<DiscoveredOpencodeAgent | null> {
  let content: string
  try {
    content = await input.readFileText(input.fullPath)
  } catch (error) {
    input.logWarning(
      `opencode agent read failed at ${input.fullPath}: ${describeAgentFileError(error)}`
    )
    return null
  }
  let fields: ParsedAgentFields
  if (input.ext === '.md') {
    const frontmatter = extractAgentFrontmatter(content)
    if (frontmatter === null) {
      input.logWarning(`opencode agent missing frontmatter at ${input.fullPath}`)
      return null
    }
    fields = parseFrontmatterFields(frontmatter)
  } else {
    fields = parseJsonAgent(content, input.fullPath, input.logWarning)
  }
  return buildDiscoveredAgent(fields, input.id, input.source)
}

async function scanConfigFile(
  input: ScanConfigFileInput
): Promise<ReadonlyArray<DiscoveredOpencodeAgent>> {
  let content: string
  try {
    content = await input.readFileText(input.filePath)
  } catch (error) {
    if (isAgentFileNotFoundError(error)) {
      return []
    }
    input.logWarning(
      `opencode config read failed at ${input.filePath}: ${describeAgentFileError(error)}`
    )
    return []
  }
  const fieldsById = parseConfigAgents(content, input.filePath, input.logWarning)
  return Object.entries(fieldsById)
    .map(([id, fields]) => buildDiscoveredAgent(fields, id, input.source))
    .filter((agent): agent is DiscoveredOpencodeAgent => agent !== null)
}

function buildDiscoveredAgent(
  fields: ParsedAgentFields,
  id: string,
  source: OpencodeAgent['source']
): DiscoveredOpencodeAgent | null {
  const normalizedMode = normalizeAgentMode(fields.mode)
  if (!normalizedMode) return null
  const name = fields.name && fields.name.length > 0 ? fields.name : id
  const description = fields.description
  return {
    id,
    name,
    mode: normalizedMode,
    source,
    ...(description ? { description } : {}),
    ...(fields.model ? { model: fields.model } : {}),
  }
}

function normalizeAgentMode(value: string | undefined): OpencodeAgentMode | null {
  return value === 'primary' || value === 'subagent' ? value : null
}

function parseConfigAgents(
  content: string,
  fullPath: string,
  logWarning: (message: string) => void
): Record<string, ParsedAgentFields> {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    const agents =
      record.agent && typeof record.agent === 'object' && !Array.isArray(record.agent)
        ? (record.agent as Record<string, unknown>)
        : null
    if (!agents) return {}
    return Object.fromEntries(
      Object.entries(agents).flatMap(([id, value]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return []
        }
        const fields = parseJsonAgent(JSON.stringify(value), `${fullPath}#agent.${id}`, logWarning)
        return [[id, fields] as const]
      })
    )
  } catch (error) {
    logWarning(`opencode config malformed at ${fullPath}: ${describeAgentFileError(error)}`)
    return {}
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
      model: typeof record.model === 'string' ? record.model.trim() : undefined,
    }
  } catch (error) {
    logWarning(`opencode agent json malformed at ${fullPath}: ${describeAgentFileError(error)}`)
    return {}
  }
}

function parseFrontmatterFields(block: string): ParsedAgentFields {
  let mode: string | undefined
  let name: string | undefined
  let description: string | undefined
  let model: string | undefined
  for (const [key, value] of listFrontmatterEntries(block)) {
    if (key === 'mode') mode = value
    else if (key === 'name') name = value
    else if (key === 'description') description = value
    else if (key === 'model') model = value
  }
  return { mode, name, description, model }
}
