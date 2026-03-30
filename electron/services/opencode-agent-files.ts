import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { AgentsDocument, OpenCodeAgentFile } from '../../shared/ipc'

const OPENCODE_AGENTS_DIR = path.join(homedir(), '.config', 'opencode', 'agents')
const OPENCODE_GLOBAL_AGENTS_PATH = path.join(homedir(), '.config', 'opencode', 'AGENTS.md')

type ParsedFrontmatter = {
  metadata: Record<string, string>
  body: string
  hasFrontmatter: boolean
}

export function parseSimpleYamlFrontmatter(content: string): ParsedFrontmatter {
  const trimmed = content.trim()
  if (!trimmed.startsWith('---')) {
    return {
      metadata: {},
      body: trimmed,
      hasFrontmatter: false,
    }
  }

  const lines = trimmed.split(/\r?\n/)
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      end = index
      break
    }
  }
  if (end < 0) {
    return {
      metadata: {},
      body: trimmed,
      hasFrontmatter: false,
    }
  }

  const metadata: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)\s*$/)
    if (!match) {
      continue
    }
    const key = match[1]!
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    metadata[key] = value
  }

  return {
    metadata,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
    hasFrontmatter: true,
  }
}

function ensureSafeAgentsFilename(filename: string) {
  const filePath = path.join(OPENCODE_AGENTS_DIR, filename)
  const rel = path.relative(OPENCODE_AGENTS_DIR, filePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid filename')
  }
  return filePath
}

export function parseOpenCodeAgentFile(
  filename: string,
  filePath: string,
  raw: string
): OpenCodeAgentFile {
  const parsed = parseSimpleYamlFrontmatter(raw)
  const name = filename.replace(/\.md$/i, '')
  const temperature = parsed.metadata.temperature
    ? Number.parseFloat(parsed.metadata.temperature)
    : undefined
  return {
    name,
    filename,
    path: filePath,
    description: parsed.metadata.description ?? '',
    mode: parsed.metadata.mode ?? '',
    model: parsed.metadata.model ?? '',
    temperature: temperature !== undefined && !Number.isNaN(temperature) ? temperature : undefined,
    content: raw,
  }
}

export async function listOpenCodeAgentFiles(): Promise<OpenCodeAgentFile[]> {
  const dirInfo = await stat(OPENCODE_AGENTS_DIR).catch(() => undefined)
  if (!dirInfo?.isDirectory()) {
    return []
  }

  const entries = await readdir(OPENCODE_AGENTS_DIR, { withFileTypes: true }).catch(() => [])
  const output: OpenCodeAgentFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }
    const filePath = path.join(OPENCODE_AGENTS_DIR, entry.name)
    const raw = await readFile(filePath, 'utf8').catch(() => '')
    if (!raw) {
      continue
    }
    output.push(parseOpenCodeAgentFile(entry.name, filePath, raw))
  }

  return output
}

export async function readOpenCodeAgentFile(filename: string): Promise<OpenCodeAgentFile> {
  const filePath = ensureSafeAgentsFilename(filename)
  const raw = await readFile(filePath, 'utf8')
  return parseOpenCodeAgentFile(filename, filePath, raw)
}

export async function writeOpenCodeAgentFile(
  filename: string,
  content: string
): Promise<OpenCodeAgentFile> {
  await mkdir(OPENCODE_AGENTS_DIR, { recursive: true })
  const filePath = ensureSafeAgentsFilename(filename)
  await writeFile(filePath, content, 'utf8')
  return parseOpenCodeAgentFile(filename, filePath, content)
}

export async function deleteOpenCodeAgentFile(filename: string): Promise<boolean> {
  const filePath = ensureSafeAgentsFilename(filename)
  await rm(filePath, { force: true })
  return true
}

export async function readWorkspaceAgentsMd(directory: string): Promise<AgentsDocument> {
  const root = path.resolve(directory)
  const agentsPath = path.join(root, 'AGENTS.md')
  const info = await stat(agentsPath).catch(() => undefined)
  if (!info?.isFile()) {
    return {
      path: agentsPath,
      content: '',
      exists: false,
    }
  }

  const content = await readFile(agentsPath, 'utf8').catch(() => '')
  return {
    path: agentsPath,
    content,
    exists: true,
  }
}

export async function writeWorkspaceAgentsMd(
  directory: string,
  content: string
): Promise<AgentsDocument> {
  const root = path.resolve(directory)
  const agentsPath = path.join(root, 'AGENTS.md')
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  await mkdir(path.dirname(agentsPath), { recursive: true })
  await writeFile(agentsPath, normalized, 'utf8')
  return {
    path: agentsPath,
    content: normalized,
    exists: true,
  }
}

export async function readGlobalAgentsMd(): Promise<AgentsDocument> {
  const info = await stat(OPENCODE_GLOBAL_AGENTS_PATH).catch(() => undefined)
  if (!info?.isFile()) {
    return {
      path: OPENCODE_GLOBAL_AGENTS_PATH,
      content: '',
      exists: false,
    }
  }

  const content = await readFile(OPENCODE_GLOBAL_AGENTS_PATH, 'utf8').catch(() => '')
  return {
    path: OPENCODE_GLOBAL_AGENTS_PATH,
    content,
    exists: true,
  }
}

export async function writeGlobalAgentsMd(content: string): Promise<AgentsDocument> {
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  await mkdir(path.dirname(OPENCODE_GLOBAL_AGENTS_PATH), { recursive: true })
  await writeFile(OPENCODE_GLOBAL_AGENTS_PATH, normalized, 'utf8')
  return {
    path: OPENCODE_GLOBAL_AGENTS_PATH,
    content: normalized,
    exists: true,
  }
}
