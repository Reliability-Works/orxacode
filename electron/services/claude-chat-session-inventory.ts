import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ClaudeBrowserSessionSummary } from '@shared/ipc'
import type { ProviderRuntimeBinding } from './provider-session-directory'

type ImportedClaudeSession = NonNullable<ClaudeBrowserSessionSummary['importedSession']>

type ClaudeInventoryOptions = {
  inventoryRoot?: string
  importedSessionsByProviderThreadId: Map<string, ImportedClaudeSession>
}

type ClaudeProjectSessionFileSummary = {
  providerThreadId: string
  title: string
  lastUpdatedAt: number
  cwd?: string
  preview?: string
}

type ClaudeProjectSessionAccumulator = {
  providerThreadId: string
  cwd: string
  firstUserPrompt: string
  preview: string
  lastUpdatedAt: number
}

const CLAUDE_PROJECTS_ROOT = path.join(homedir(), '.claude', 'projects')

function safeTrim(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .flatMap(item => {
      if (!item || typeof item !== 'object') {
        return []
      }
      const text = safeTrim((item as { text?: unknown }).text)
      return text ? [text] : []
    })
    .join('\n')
    .trim()
}

function deriveSessionTitle(prompt: string) {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, '')
    .trim()
  if (!cleaned) {
    return 'Claude Code (Chat)'
  }
  return cleaned.length > 56 ? `${cleaned.slice(0, 53).trimEnd()}...` : cleaned
}

function updateLastUpdatedAt(current: number, timestamp: unknown) {
  const normalized = safeTrim(timestamp)
  if (!normalized) {
    return current
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? Math.max(current, parsed) : current
}

function applyClaudeProjectRecord(
  parsed: Record<string, unknown>,
  summary: ClaudeProjectSessionAccumulator
) {
  const sessionId = safeTrim(parsed.sessionId)
  if (sessionId) {
    summary.providerThreadId = sessionId
  }

  summary.lastUpdatedAt = updateLastUpdatedAt(summary.lastUpdatedAt, parsed.timestamp)

  const lineCwd = safeTrim(parsed.cwd)
  if (lineCwd) {
    summary.cwd = lineCwd
  }

  if (safeTrim(parsed.type) === 'last-prompt') {
    const lastPrompt = safeTrim(parsed.lastPrompt)
    if (lastPrompt) {
      summary.preview = lastPrompt
    }
    return
  }

  const role = safeTrim((parsed.message as { role?: unknown } | undefined)?.role)
  if (role !== 'user' && role !== 'assistant') {
    return
  }

  const text = extractTextContent((parsed.message as { content?: unknown } | undefined)?.content)
  if (!text) {
    return
  }
  if (role === 'user' && !summary.firstUserPrompt) {
    summary.firstUserPrompt = text
  }
  summary.preview = text
}

function finalizeClaudeProjectSessionSummary(
  filePath: string,
  summary: ClaudeProjectSessionAccumulator
) {
  if (!summary.providerThreadId) {
    const basename = path.basename(filePath, '.jsonl').trim()
    if (!basename || basename === 'skill-injections') {
      return null
    }
    summary.providerThreadId = basename
  }

  const preview = summary.preview || summary.firstUserPrompt
  return {
    providerThreadId: summary.providerThreadId,
    title: deriveSessionTitle(summary.firstUserPrompt || preview),
    lastUpdatedAt: summary.lastUpdatedAt,
    ...(summary.cwd ? { cwd: summary.cwd } : {}),
    ...(preview ? { preview } : {}),
  } satisfies ClaudeProjectSessionFileSummary
}

function extractImportedClaudeSessions(
  bindings: ProviderRuntimeBinding[]
): Map<string, ImportedClaudeSession> {
  const imported = new Map<string, ImportedClaudeSession>()
  for (const binding of bindings) {
    const resumeCursor = binding.resumeCursor
    if (!resumeCursor || typeof resumeCursor !== 'object' || Array.isArray(resumeCursor)) {
      continue
    }
    const providerThreadId = safeTrim((resumeCursor as { resume?: unknown }).resume)
    if (!providerThreadId) {
      continue
    }
    const separatorIndex = binding.sessionKey.lastIndexOf('::')
    if (separatorIndex <= 0) {
      continue
    }
    const directory =
      safeTrim((binding.runtimePayload as { directory?: unknown } | null | undefined)?.directory) ||
      binding.sessionKey.slice(0, separatorIndex)
    const sessionID = binding.sessionKey.slice(separatorIndex + 2).trim()
    if (!directory || !sessionID) {
      continue
    }
    const previous = imported.get(providerThreadId)
    if (previous && previous.sessionKey === binding.sessionKey) {
      continue
    }
    imported.set(providerThreadId, {
      sessionKey: binding.sessionKey,
      sessionID,
      directory,
    })
  }
  return imported
}

async function readClaudeProjectSessionFile(
  filePath: string
): Promise<ClaudeProjectSessionFileSummary | null> {
  const [raw, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
  const lines = raw.split('\n').filter(Boolean)
  if (lines.length === 0) {
    return null
  }

  const summary: ClaudeProjectSessionAccumulator = {
    providerThreadId: '',
    cwd: '',
    firstUserPrompt: '',
    preview: '',
    lastUpdatedAt: stats.mtimeMs,
  }

  for (const line of lines) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    applyClaudeProjectRecord(parsed, summary)
  }

  return finalizeClaudeProjectSessionSummary(filePath, summary)
}

async function listClaudeProjectSessionFiles(inventoryRoot: string) {
  const projectEntries = await readdir(inventoryRoot, { withFileTypes: true }).catch(() => [])
  const sessionFiles: string[] = []

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue
    }
    const projectDirectory = path.join(inventoryRoot, entry.name)
    const childEntries = await readdir(projectDirectory, { withFileTypes: true }).catch(() => [])
    for (const child of childEntries) {
      if (!child.isFile() || !child.name.endsWith('.jsonl')) {
        continue
      }
      sessionFiles.push(path.join(projectDirectory, child.name))
    }
  }

  return sessionFiles
}

export async function listClaudeBrowserSessions({
  inventoryRoot = CLAUDE_PROJECTS_ROOT,
  importedSessionsByProviderThreadId,
}: ClaudeInventoryOptions): Promise<ClaudeBrowserSessionSummary[]> {
  const sessionFiles = await listClaudeProjectSessionFiles(inventoryRoot)
  const summaries = await Promise.all(sessionFiles.map(readClaudeProjectSessionFile))
  return summaries
    .filter((summary): summary is ClaudeProjectSessionFileSummary => Boolean(summary))
    .map(summary => ({
      providerThreadId: summary.providerThreadId,
      title: summary.title,
      lastUpdatedAt: summary.lastUpdatedAt,
      ...(summary.cwd ? { cwd: summary.cwd } : {}),
      ...(summary.preview ? { preview: summary.preview } : {}),
      isArchived: false,
      ...(importedSessionsByProviderThreadId.has(summary.providerThreadId)
        ? { importedSession: importedSessionsByProviderThreadId.get(summary.providerThreadId) }
        : {}),
    }))
    .sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt)
}

export function buildImportedClaudeSessionMap(bindings: ProviderRuntimeBinding[]) {
  return extractImportedClaudeSessions(bindings)
}

export function getClaudeInventoryRootForTests() {
  return CLAUDE_PROJECTS_ROOT
}
