import { execSync } from 'node:child_process'
import { readdirSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import type {
  CodexAttachment,
  CodexCollaborationMode,
  CodexModelEntry,
  CodexRunMetadata,
} from '@shared/ipc'

export const REQUEST_TIMEOUT_MS = 60_000
const RUN_METADATA_MAX_PROMPT_CHARS = 1200
const ACTIVE_TURN_STATUSES: ReadonlySet<string> = new Set([
  'inprogress',
  'running',
  'processing',
  'pending',
  'started',
  'queued',
  'waiting',
  'blocked',
  'needsinput',
  'requiresaction',
  'awaitinginput',
  'waitingforinput',
])

export function parseModelListResponse(response: unknown): CodexModelEntry[] {
  if (!response || typeof response !== 'object') return []
  const record = response as Record<string, unknown>

  const items = (() => {
    if (Array.isArray(record.data)) return record.data
    if (Array.isArray(record.models)) return record.models
    const result = record.result as Record<string, unknown> | undefined
    if (result && Array.isArray(result.data)) return result.data
    return []
  })()

  return items
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return null
      const m = item as Record<string, unknown>
      const id = String(m.id ?? m.model ?? '')
      const model = String(m.model ?? m.id ?? '')
      const rawName = String(m.displayName ?? m.display_name ?? '')
      const name = rawName.trim() || model
      const isDefault = Boolean(m.isDefault ?? m.is_default ?? false)
      const effortsRaw = (m.supportedReasoningEfforts ?? m.supported_reasoning_efforts) as unknown
      const efforts: string[] = Array.isArray(effortsRaw)
        ? effortsRaw
            .map((entry: unknown) => {
              if (typeof entry === 'string') return entry
              if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>
                return String(record.reasoningEffort ?? record.reasoning_effort ?? '')
              }
              return ''
            })
            .filter((entry: string) => entry.length > 0)
        : []
      const defaultEffortRaw = m.defaultReasoningEffort ?? m.default_reasoning_effort
      const defaultEffort =
        typeof defaultEffortRaw === 'string' && defaultEffortRaw.trim()
          ? defaultEffortRaw.trim()
          : null

      return {
        id,
        model,
        name,
        isDefault,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: defaultEffort,
      }
    })
    .filter((entry): entry is CodexModelEntry => entry !== null && entry.id.length > 0)
}

export function parseModeListResponse(response: unknown): CodexCollaborationMode[] {
  if (!response || typeof response !== 'object') return []
  const record = response as Record<string, unknown>

  const items = (() => {
    if (Array.isArray(record.data)) return record.data
    if (Array.isArray(record.modes)) return record.modes
    const result = record.result as Record<string, unknown> | undefined
    if (result && Array.isArray(result.data)) return result.data
    if (result && Array.isArray(result.modes)) return result.modes
    return []
  })()

  return items
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return null
      const m = item as Record<string, unknown>
      const id = asString(m.id ?? m.mode ?? m.name).trim()
      return {
        id,
        label: asString(m.label ?? m.name ?? m.mode ?? id).trim(),
        mode: asString(m.mode).trim(),
        model: asString(m.model).trim(),
        reasoningEffort: asString(m.reasoningEffort ?? m.reasoning_effort).trim(),
        developerInstructions: asString(m.developerInstructions ?? m.developer_instructions).trim(),
      }
    })
    .filter((entry): entry is CodexCollaborationMode => entry !== null && entry.id.length > 0)
}

export function resolveCodexBinary(): string | null {
  const home = process.env.HOME ?? ''
  const candidates = [
    'codex',
    ...(() => {
      try {
        const nvmDir = path.join(home, '.nvm', 'versions', 'node')
        const versions = readdirSync(nvmDir)
        return versions.map(version => path.join(nvmDir, version, 'bin', 'codex'))
      } catch {
        return []
      }
    })(),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(home, '.volta', 'bin', 'codex'),
    path.join(home, '.local', 'share', 'pnpm', 'codex'),
    '/usr/local/lib/node_modules/.bin/codex',
  ]

  for (const candidate of candidates) {
    try {
      if (candidate === 'codex') {
        execSync('which codex', { stdio: 'ignore' })
        return 'codex'
      }
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

export function cleanRunMetadataPrompt(prompt: string) {
  if (!prompt) {
    return ''
  }
  const withoutImages = prompt.replace(/\[image(?: x\d+)?\]/gi, ' ')
  const withoutSkills = withoutImages.replace(/(^|\s)\$[A-Za-z0-9_-]+(?=\s|$)/g, ' ')
  const normalized = withoutSkills.replace(/\s+/g, ' ').trim()
  return normalized.length > RUN_METADATA_MAX_PROMPT_CHARS
    ? normalized.slice(0, RUN_METADATA_MAX_PROMPT_CHARS)
    : normalized
}

export function isIgnorableCodexStderr(text: string) {
  return /fail to delete session:.*404 Not Found.*https:\/\/mcp\.expo\.dev\/mcp/i.test(text)
}

export function buildRunMetadataPrompt(cleanedPrompt: string) {
  return [
    'You create concise run metadata for a coding task.',
    'Return ONLY a JSON object with keys:',
    '- title: short, clear, 3-7 words, Title Case',
    '- worktreeName: lower-case, kebab-case slug prefixed with one of: feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.',
    '',
    'Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup.',
    'Use the closest match for chores/tests/docs/refactors/perf/build/ci/style.',
    'Otherwise use feat/.',
    '',
    'Examples:',
    '{"title":"Fix Login Redirect Loop","worktreeName":"fix/login-redirect-loop"}',
    '{"title":"Add Workspace Home View","worktreeName":"feat/workspace-home"}',
    '{"title":"Update Lint Config","worktreeName":"chore/update-lint-config"}',
    '{"title":"Add Coverage Tests","worktreeName":"test/add-coverage-tests"}',
    '',
    'Task:',
    cleanedPrompt,
  ].join('\n')
}

function extractJsonValue(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return asRecord(parsed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return null
    }
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
      return asRecord(parsed)
    } catch {
      return null
    }
  }
}

function sanitizeRunWorktreeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

export function parseRunMetadataValue(raw: string): CodexRunMetadata {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('No metadata was generated')
  }
  const jsonValue = extractJsonValue(trimmed)
  if (!jsonValue) {
    throw new Error('Failed to parse metadata JSON')
  }
  const title = asString(jsonValue.title).trim()
  const worktreeName = sanitizeRunWorktreeName(
    asString(jsonValue.worktreeName ?? jsonValue.worktree_name)
  )
  if (!title) {
    throw new Error('Missing title in metadata')
  }
  if (!worktreeName) {
    throw new Error('Missing worktree name in metadata')
  }
  return { title, worktreeName }
}

export function extractThreadIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  if (!record) {
    return null
  }
  const resultRecord = asRecord(record.result)
  const threadRecord = asRecord(resultRecord?.thread ?? record.thread)
  return (
    asString(resultRecord?.threadId).trim() ||
    asString(threadRecord?.id).trim() ||
    asString(record.threadId).trim() ||
    null
  )
}

export function getParentThreadIdFromSource(source: unknown): string | null {
  const sourceRecord = asRecord(source)
  if (!sourceRecord) {
    return null
  }
  const subAgent = asRecord(
    sourceRecord.subAgent ?? sourceRecord.sub_agent ?? sourceRecord.subagent
  )
  if (!subAgent) {
    return null
  }
  const threadSpawn = asRecord(subAgent.thread_spawn ?? subAgent.threadSpawn)
  if (!threadSpawn) {
    return null
  }
  return asString(threadSpawn.parent_thread_id ?? threadSpawn.parentThreadId).trim() || null
}

export function getParentThreadIdFromThread(thread: Record<string, unknown>): string | null {
  return (
    getParentThreadIdFromSource(thread.source) ||
    asString(
      thread.parentThreadId ??
        thread.parent_thread_id ??
        thread.parentId ??
        thread.parent_id ??
        thread.senderThreadId ??
        thread.sender_thread_id
    ).trim() ||
    null
  )
}

function normalizeTurnStatus(value: unknown) {
  return asString(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

export function getActiveTurnIdFromThread(thread: Record<string, unknown>): string | null {
  const explicit =
    asString(thread.activeTurnId ?? thread.active_turn_id).trim() ||
    asString(
      asRecord(thread.activeTurn ?? thread.active_turn ?? thread.currentTurn ?? thread.current_turn)
        ?.id
    ).trim()
  if (explicit) {
    return explicit
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index])
    if (!turn) {
      continue
    }
    const status = normalizeTurnStatus(turn.status ?? turn.turnStatus ?? turn.turn_status)
    if (ACTIVE_TURN_STATUSES.has(status)) {
      return asString(turn.id ?? turn.turnId ?? turn.turn_id).trim() || null
    }
  }
  return null
}

export function collectDescendantThreadIds(
  rootThreadId: string,
  threads: Record<string, unknown>[]
) {
  const childrenByParent = new Map<string, string[]>()
  for (const thread of threads) {
    const childId = asString(thread.id).trim()
    const parentId = getParentThreadIdFromThread(thread)
    if (!childId || !parentId || childId === parentId) {
      continue
    }
    const children = childrenByParent.get(parentId) ?? []
    children.push(childId)
    childrenByParent.set(parentId, children)
  }

  const visited = new Set<string>([rootThreadId])
  const descendants: string[] = []
  const queue = [...(childrenByParent.get(rootThreadId) ?? [])]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current)) {
      continue
    }
    visited.add(current)
    descendants.push(current)
    const children = childrenByParent.get(current) ?? []
    children.forEach(child => queue.push(child))
  }

  return descendants
}

export function buildBindingRuntimePayload(
  cwd: string,
  input?: {
    model?: string
    reasoningEffort?: string | null
    collaborationMode?: string
  }
): Record<string, string> {
  const payload: Record<string, string> = {}
  if (cwd) payload.directory = cwd
  if (input?.model) payload.model = input.model
  if (input?.reasoningEffort) payload.reasoningEffort = input.reasoningEffort
  if (input?.collaborationMode) payload.collaborationMode = input.collaborationMode
  return payload
}

type TurnInputItem =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'image'; url: string }

export function buildTurnInput(prompt: string, attachments?: CodexAttachment[]): TurnInputItem[] {
  const input: TurnInputItem[] = []
  if (prompt.trim()) {
    input.push({ type: 'text', text: prompt, text_elements: [] })
  }
  for (const attachment of attachments ?? []) {
    if (attachment.type !== 'image' || !attachment.url.trim()) {
      continue
    }
    input.push({ type: 'image', url: attachment.url })
  }
  if (input.length === 0) {
    throw new Error('prompt or image attachment is required')
  }
  return input
}

export function resolveDirectThreadId(
  params: Record<string, unknown>,
  threadRecord: Record<string, unknown> | null,
  turnRecord: Record<string, unknown> | null,
  itemRecord: Record<string, unknown> | null
): string {
  return (
    asString(params.threadId ?? params.thread_id).trim() ||
    asString(threadRecord?.id).trim() ||
    asString(turnRecord?.threadId ?? turnRecord?.thread_id).trim() ||
    asString(itemRecord?.threadId ?? itemRecord?.thread_id).trim()
  )
}

export function isMissingCodexThreadArchiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /no rollout found for thread id/i.test(message) ||
    /no thread found for thread id/i.test(message)
  )
}
