import type { CanonicalItemType, ToolLifecycleAction } from '@orxa-code/contracts'

import { asObject, asString } from './CodexRuntimeEventUtils.ts'

const BASH_READ = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'zcat', 'nl'])
const BASH_SEARCH = new Set(['grep', 'rg', 'ripgrep', 'ag', 'ack', 'find', 'fd'])
const BASH_LIST = new Set(['ls', 'tree', 'stat', 'file', 'du', 'df'])
const BASH_WEB = new Set(['curl', 'wget', 'http', 'httpie'])
const BASH_CREATE = new Set(['touch', 'mkdir'])
const BASH_EDIT = new Set(['mv', 'cp'])
const BASH_DELETE = new Set(['rm', 'rmdir', 'unlink'])
const SHELL_WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

const APPLY_PATCH_ADD = /^\*\*\*\s+Add File:/m
const APPLY_PATCH_DELETE = /^\*\*\*\s+Delete File:/m
const APPLY_PATCH_UPDATE = /^\*\*\*\s+Update File:/m

const FILE_CHANGE_ADD_KINDS = new Set(['add', 'added', 'create', 'created', 'new'])
const FILE_CHANGE_DELETE_KINDS = new Set(['delete', 'deleted', 'remove', 'removed'])
const FILE_CHANGE_UPDATE_KINDS = new Set([
  'update',
  'updated',
  'modify',
  'modified',
  'edit',
  'edited',
  'change',
  'changed',
])

const MCP_TOOL_ACTION_HINTS: ReadonlyArray<{
  readonly match: ReadonlyArray<string>
  readonly action: ToolLifecycleAction
}> = [
  { match: ['read', 'view'], action: 'read' },
  { match: ['grep', 'search'], action: 'search' },
  { match: ['glob', 'list', 'ls'], action: 'list' },
  { match: ['edit', 'multiedit', 'patch'], action: 'edit' },
  { match: ['write', 'create'], action: 'create' },
  { match: ['delete', 'remove'], action: 'delete' },
  { match: ['fetch', 'http', 'web'], action: 'web' },
  { match: ['todo'], action: 'todo' },
]

function stripEnvPrefix(command: string): string {
  return command.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/u, '')
}

function unwrapShellC(command: string): string {
  const stripped = stripEnvPrefix(command.trim())
  const match = /^(\S+)\s+(-\S*c\S*)\s+(['"])([\s\S]+)\3\s*$/u.exec(stripped)
  if (!match) return stripped
  const shellBase = (match[1]?.split(/[\\/]/).pop() ?? match[1] ?? '').toLowerCase()
  if (!SHELL_WRAPPERS.has(shellBase)) return stripped
  return match[4] ?? stripped
}

function firstToken(segment: string): string | undefined {
  const trimmed = stripEnvPrefix(segment.trim())
  const first = trimmed.split(/\s+/u, 1)[0]
  if (!first) return undefined
  return (first.split(/[\\/]/).pop() ?? first).toLowerCase()
}

function sedAction(segment: string): ToolLifecycleAction | undefined {
  return /\s-\S*i\S*(\s|$)/u.test(segment) ? 'edit' : 'read'
}

function classifyCommandToken(token: string, segment: string): ToolLifecycleAction | undefined {
  if (token === 'sed') return sedAction(segment)
  if (BASH_READ.has(token)) return 'read'
  if (BASH_SEARCH.has(token)) return 'search'
  if (BASH_LIST.has(token)) return 'list'
  if (BASH_WEB.has(token)) return 'web'
  if (BASH_CREATE.has(token)) return 'create'
  if (BASH_EDIT.has(token)) return 'edit'
  if (BASH_DELETE.has(token)) return 'delete'
  return undefined
}

function classifySegment(segment: string): ToolLifecycleAction | undefined {
  const token = firstToken(segment)
  if (!token) return undefined
  return classifyCommandToken(token, segment)
}

export function classifyCodexCommandAction(
  command: string | undefined
): ToolLifecycleAction | undefined {
  if (!command) return undefined
  const trimmed = command.trim()
  if (trimmed.length === 0) return undefined
  const unwrapped = unwrapShellC(trimmed)
  const segments = unwrapped.split(/\|\|?|&&|;/u)
  for (const segment of segments) {
    const action = classifySegment(segment)
    if (action) return action
  }
  return undefined
}

function classifyApplyPatchAction(patch: string | undefined): ToolLifecycleAction | undefined {
  if (!patch || patch.length === 0) return undefined
  const hasAdd = APPLY_PATCH_ADD.test(patch)
  const hasDelete = APPLY_PATCH_DELETE.test(patch)
  const hasUpdate = APPLY_PATCH_UPDATE.test(patch)
  if (hasAdd && !hasDelete && !hasUpdate) return 'create'
  if (hasDelete && !hasAdd && !hasUpdate) return 'delete'
  if (hasAdd || hasDelete || hasUpdate) return 'edit'
  return undefined
}

function readChangeKind(entry: unknown): string | undefined {
  const record = asObject(entry)
  return (
    asString(record?.kind) ??
    asString(record?.type) ??
    asString(record?.status) ??
    asString(record?.operation) ??
    asString(record?.changeType)
  )?.toLowerCase()
}

function classifyFileChangesAction(changes: unknown): ToolLifecycleAction | undefined {
  if (!Array.isArray(changes) || changes.length === 0) return undefined
  const kinds = changes.map(readChangeKind).filter((value): value is string => value !== undefined)
  if (kinds.length === 0) return undefined
  const hasAdd = kinds.some(value => FILE_CHANGE_ADD_KINDS.has(value))
  const hasDelete = kinds.some(value => FILE_CHANGE_DELETE_KINDS.has(value))
  const hasUpdate = kinds.some(value => FILE_CHANGE_UPDATE_KINDS.has(value))
  if (hasAdd && !hasDelete && !hasUpdate) return 'create'
  if (hasDelete && !hasAdd && !hasUpdate) return 'delete'
  if (hasAdd || hasDelete || hasUpdate) return 'edit'
  return undefined
}

function mcpToolNameForItem(item: Record<string, unknown> | undefined): string | undefined {
  return (
    asString(item?.tool) ?? asString(item?.toolName) ?? asString(item?.name) ?? asString(item?.type)
  )
}

export function classifyMcpToolAction(
  item: Record<string, unknown> | undefined
): ToolLifecycleAction | undefined {
  const raw = mcpToolNameForItem(item)
  if (!raw) return undefined
  const normalized = raw.toLowerCase()
  for (const hint of MCP_TOOL_ACTION_HINTS) {
    if (hint.match.some(marker => normalized.includes(marker))) return hint.action
  }
  return undefined
}

function classifyFileChangeItemAction(
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): ToolLifecycleAction {
  const patchText =
    asString(item.patch) ??
    asString(item.applyPatch) ??
    asString(item.content) ??
    asString(payload?.patch) ??
    asString(payload?.applyPatch)
  return (
    classifyApplyPatchAction(patchText) ??
    classifyFileChangesAction(item.changes ?? payload?.changes) ??
    'edit'
  )
}

function classifyCommandItemAction(
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): ToolLifecycleAction {
  const command =
    asString(item.command) ?? asString(payload?.command) ?? asString(asObject(item.result)?.command)
  return classifyCodexCommandAction(command) ?? 'command'
}

export function classifyCodexAction(
  itemType: CanonicalItemType,
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): ToolLifecycleAction | undefined {
  switch (itemType) {
    case 'command_execution':
      return classifyCommandItemAction(item, payload)
    case 'file_change':
      return classifyFileChangeItemAction(item, payload)
    case 'web_search':
      return 'web'
    case 'mcp_tool_call':
    case 'dynamic_tool_call':
      return classifyMcpToolAction(item) ?? 'tool'
    case 'collab_agent_tool_call':
      return 'tool'
    case 'image_view':
      return 'read'
    default:
      return undefined
  }
}
