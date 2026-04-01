import type { MutableRefObject } from 'react'
import type { CodexNotification } from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { CodexMessageItem } from './codex-session-types'
import type { SubagentInfo } from './codex-subagent-helpers'
import type { CommandDiffBaseline, FileChangeDescriptor } from './codex-diff-helpers'
import { nextMessageID } from './codex-session-streaming'
import {
  readTurnId,
  readThreadId,
  getParentThreadIdFromSource,
} from './codex-session-notification-helpers'
import {
  appendAssistantDeltaToLastMessage,
  parseMarkdownPlan,
  parseStructuredPlan,
} from './codex-session-message-reducers'
import { extractSubagentMeta } from './codex-subagent-helpers'
import { looksLikeUnifiedDiff } from './codex-diff-helpers'
import { handleItemStarted } from './codex-session-item-handlers'
import { handleItemCompleted } from './codex-session-item-completed-handlers'

// ---------------------------------------------------------------------------
// Utility functions (moved from useCodexSession.ts so both files can share)
// ---------------------------------------------------------------------------

export function asString(value: unknown) {
  return typeof value === 'string' ? value : value ? String(value) : ''
}

export function normalizeCommandText(value: unknown) {
  if (Array.isArray(value)) {
    const first = asString(value[0]).trim()
    const second = asString(value[1]).trim()
    const third = asString(value[2]).trim()
    if (/(?:^|\/)(?:zsh|bash|sh)$/.test(first) && (second === '-lc' || second === '-c') && third) {
      return third
    }
    return value
      .map(entry => asString(entry).trim())
      .filter(Boolean)
      .join(' ')
      .trim()
  }
  return asString(value).trim()
}

function readTokenUsageTotal(params: Record<string, unknown>) {
  const usageRecord = readUsageRecord(params)
  if (!usageRecord) {
    return null
  }
  const total = readUsageNumber(usageRecord, ['total', 'total_tokens'])
  if (typeof total === 'number' && total > 0) {
    return total
  }
  const input = readUsageNumber(usageRecord, ['input', 'input_tokens'])
  const output = readUsageNumber(usageRecord, ['output', 'output_tokens'])
  if (typeof input === 'number' || typeof output === 'number') {
    const nextTotal = (input ?? 0) + (output ?? 0)
    return nextTotal > 0 ? nextTotal : null
  }
  return null
}

function readUsageRecord(params: Record<string, unknown>) {
  const turnRecord =
    params.turn && typeof params.turn === 'object' && !Array.isArray(params.turn)
      ? (params.turn as Record<string, unknown>)
      : null
  const usageRecord =
    params.usage ?? turnRecord?.tokenUsage ?? turnRecord?.token_usage ?? turnRecord?.usage
  if (!usageRecord || typeof usageRecord !== 'object' || Array.isArray(usageRecord)) {
    return null
  }
  return usageRecord as Record<string, unknown>
}

function readUsageNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number') {
      return value
    }
  }
  return null
}

export function normalizeWorkspaceRelativePath(rawPath: string, workspaceDirectory: string) {
  const normalizedPath = rawPath.trim().replace(/\\/g, '/')
  const normalizedWorkspace = workspaceDirectory.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalizedPath || !normalizedWorkspace) {
    return normalizedPath
  }
  if (normalizedPath === normalizedWorkspace) {
    return '.'
  }
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1)
  }
  return normalizedPath
}

// ---------------------------------------------------------------------------
// Context interface — bundles every ref, callback, and value the handler needs
// ---------------------------------------------------------------------------

export interface NotificationDispatchContext {
  // Refs
  pendingInterruptRef: MutableRefObject<boolean>
  interruptRequestedRef: MutableRefObject<boolean>
  activeTurnIdRef: MutableRefObject<string | null>
  streamingItemIdRef: MutableRefObject<string | null>
  currentReasoningIdRef: MutableRefObject<string | null>
  thinkingItemIdRef: MutableRefObject<string | null>
  activeExploreGroupIdRef: MutableRefObject<string | null>
  codexItemToMsgId: MutableRefObject<Map<string, string>>
  codexItemToExploreGroupId: MutableRefObject<Map<string, string>>
  messageIdCounter: MutableRefObject<number>
  commandDiffSnapshotsRef: MutableRefObject<Map<string, Promise<CommandDiffBaseline | null>>>
  latestPlanUpdateIdRef: MutableRefObject<string | null>
  subagentThreadIds: MutableRefObject<Set<string>>
  itemThreadIdsRef: MutableRefObject<Map<string, string>>
  turnThreadIdsRef: MutableRefObject<Map<string, string>>

  // Callbacks
  setStreamingState: (next: boolean) => void
  setObservedTurnUsage?: (turnId: string, total: number, timestamp: number) => void
  setMessagesState: (
    next: CodexMessageItem[] | ((prev: CodexMessageItem[]) => CodexMessageItem[])
  ) => void
  updateMessages: (
    updater: (prev: CodexMessageItem[]) => CodexMessageItem[],
    priority?: 'normal' | 'deferred'
  ) => void
  setPlanItemsState: (next: TodoItem[]) => void
  setSubagentsState: (
    next: SubagentInfo[] | ((prev: SubagentInfo[]) => SubagentInfo[])
  ) => void
  setThreadNameState: (next: string | undefined) => void
  recordLastError: (error: unknown) => void
  getCurrentCodexRuntime: () => {
    thread: { id: string } | null
    messages: CodexMessageItem[]
  } | null
  captureCommandDiffSnapshot: () => Promise<CommandDiffBaseline | null>
  startCommandDiffPolling: (codexItemId: string) => void
  stopCommandDiffPolling: (codexItemId: string) => void
  attributeCommandFileChanges: (
    codexItemId: string,
    anchorMessageId?: string,
    options?: { status?: 'running' | 'completed'; clearBaseline?: boolean }
  ) => Promise<void>
  enrichFileChangeDescriptors: (
    descriptors: FileChangeDescriptor[]
  ) => Promise<FileChangeDescriptor[]>
  mergeSubagentsFromCollabHints: (rawItem: unknown) => void
  appendToItemField: (
    codexItemId: string,
    field: 'content' | 'output' | 'diff' | 'summary',
    delta: string
  ) => void

  // Values
  directory: string
}

// ---------------------------------------------------------------------------
// Main dispatch entry point
// ---------------------------------------------------------------------------

export function dispatchCodexNotification(
  notification: CodexNotification,
  ctx: NotificationDispatchContext
): void {
  const { method, params } = notification

  switch (method) {
    case 'turn/started':
      handleTurnStarted(params, ctx)
      break
    case 'turn/completed':
      handleTurnCompleted(params, ctx)
      break
    case 'turn/plan/updated':
      handlePlanUpdated(params, ctx)
      break
    case 'thread/started':
      handleThreadStarted(params, ctx)
      break
    case 'thread/name/updated':
      handleThreadNameUpdated(params, ctx)
      break
    case 'item/started':
      handleItemStarted(params, ctx)
      break
    case 'item/agentMessage/delta':
    case 'item/commandExecution/outputDelta':
    case 'item/fileChange/outputDelta':
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
    case 'item/plan/delta':
      handleDelta(method, params, ctx)
      break
    case 'item/completed':
      handleItemCompleted(params, ctx)
      break
    case 'thread/status/changed':
      handleThreadStatusChanged(params, ctx)
      break
    default:
      // Unhandled notification — no-op
      break
  }
}

// ---------------------------------------------------------------------------
// turn/started
// ---------------------------------------------------------------------------

function handleTurnStarted(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const turnId = readTurnId(params)
  if (ctx.pendingInterruptRef.current || ctx.interruptRequestedRef.current) {
    ctx.pendingInterruptRef.current = false
    ctx.activeTurnIdRef.current = turnId
    const currentThreadId = ctx.getCurrentCodexRuntime()?.thread?.id
    if (currentThreadId && turnId && window.orxa?.codex) {
      void window.orxa.codex.interruptTurn(currentThreadId, turnId).catch(error => {
        ctx.recordLastError(error)
      })
    }
    return
  }
  ctx.setStreamingState(true)
  ctx.streamingItemIdRef.current = null
  ctx.activeExploreGroupIdRef.current = null
  ctx.activeTurnIdRef.current = turnId
  ctx.currentReasoningIdRef.current = null
  ctx.thinkingItemIdRef.current = null
  const thinkingId = nextMessageID('codex-reasoning', ctx.messageIdCounter)
  ctx.thinkingItemIdRef.current = thinkingId
  ctx.currentReasoningIdRef.current = thinkingId
  ctx.setMessagesState(prev => [
    ...prev,
    { id: thinkingId, kind: 'reasoning', content: '', summary: '', timestamp: Date.now() },
  ])
}

// ---------------------------------------------------------------------------
// turn/completed
// ---------------------------------------------------------------------------

function handleTurnCompleted(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const turnId = readTurnId(params)
  const tokenTotal = readTokenUsageTotal(params)
  if (turnId && typeof tokenTotal === 'number' && tokenTotal > 0) {
    ctx.setObservedTurnUsage?.(turnId, tokenTotal, Date.now())
  }
  ctx.pendingInterruptRef.current = false
  ctx.interruptRequestedRef.current = false
  ctx.setStreamingState(false)
  ctx.streamingItemIdRef.current = null
  ctx.activeTurnIdRef.current = null
  const tId = ctx.currentReasoningIdRef.current
  ctx.currentReasoningIdRef.current = null
  ctx.thinkingItemIdRef.current = null
  ctx.activeExploreGroupIdRef.current = null
  ctx.setMessagesState(prev => {
    let result = prev
    if (tId) {
      const item = prev.find(m => m.id === tId)
      if (item && item.kind === 'reasoning' && !item.content && !item.summary) {
        result = prev.filter(m => m.id !== tId)
      }
    }
    const hasExploring = result.some(m => m.kind === 'explore' && m.status === 'exploring')
    if (hasExploring) {
      result = (result === prev ? [...prev] : result).map(m =>
        m.kind === 'explore' && m.status === 'exploring'
          ? { ...m, status: 'explored' as const }
          : m
      )
    }
    return result
  })
}

// ---------------------------------------------------------------------------
// turn/plan/updated
// ---------------------------------------------------------------------------

function handlePlanUpdated(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const plan = params.plan as unknown
  const explanation = params.explanation as unknown
  let items: TodoItem[] = []

  if (Array.isArray(plan) && plan.length > 0) {
    items = parseStructuredPlan(plan)
  } else if (typeof plan === 'string' && plan.trim()) {
    items = parseMarkdownPlan(plan)
  } else if (typeof explanation === 'string' && explanation.trim()) {
    items = parseMarkdownPlan(explanation)
  }

  if (items.length > 0) {
    ctx.setPlanItemsState(items)
    ctx.setMessagesState(prev => {
      const existingId = ctx.latestPlanUpdateIdRef.current
      const nextId = existingId ?? nextMessageID('codex-plan-update', ctx.messageIdCounter)
      ctx.latestPlanUpdateIdRef.current = nextId
      const withoutExisting = existingId
        ? prev.filter(message => message.id !== existingId)
        : prev
      return [
        ...withoutExisting,
        { id: nextId, kind: 'status', label: 'Updated task list', timestamp: Date.now() },
      ]
    })
  }
}

// ---------------------------------------------------------------------------
// thread/started
// ---------------------------------------------------------------------------

function handleThreadStarted(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const threadMeta = params.thread as
    | { id?: string; source?: unknown; kind?: string }
    | undefined
  const sourceMeta = extractSubagentMeta(threadMeta?.source)
  const parentThreadId = getParentThreadIdFromSource(threadMeta?.source)
  const currentThreadId = ctx.getCurrentCodexRuntime()?.thread?.id ?? null
  const belongsToActiveParent = parentThreadId
    ? currentThreadId === parentThreadId
    : Boolean(currentThreadId && ctx.activeTurnIdRef.current)
  if (threadMeta?.id && sourceMeta && belongsToActiveParent) {
    ctx.subagentThreadIds.current.add(threadMeta.id)
    ctx.setSubagentsState(prev => {
      if (prev.some(a => a.threadId === threadMeta.id)) return prev
      return [
        ...prev,
        {
          threadId: threadMeta.id!,
          nickname: sourceMeta.nickname ?? `Agent-${prev.length + 1}`,
          role: sourceMeta.role ?? 'worker',
          status: 'thinking',
          statusText: 'is thinking',
          spawnedAt: Date.now(),
        },
      ]
    })
  }
}

// ---------------------------------------------------------------------------
// thread/name/updated
// ---------------------------------------------------------------------------

function handleThreadNameUpdated(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const name = params.threadName as string | undefined
  if (name) {
    ctx.setThreadNameState(name)
  }
}

// ---------------------------------------------------------------------------
// Streaming deltas (all small cases combined)
// ---------------------------------------------------------------------------

function handleDelta(
  method: string,
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const delta = params.delta as string
  const codexItemId = params.itemId as string
  if (!delta) return
  if (ctx.interruptRequestedRef.current) return
  ctx.setStreamingState(true)

  switch (method) {
    case 'item/agentMessage/delta': {
      if (codexItemId) {
        ctx.appendToItemField(codexItemId, 'content', delta)
      } else {
        ctx.updateMessages(prev => appendAssistantDeltaToLastMessage(prev, delta), 'deferred')
      }
      break
    }
    case 'item/commandExecution/outputDelta': {
      if (codexItemId) {
        ctx.appendToItemField(codexItemId, 'output', delta)
      }
      break
    }
    case 'item/fileChange/outputDelta': {
      handleFileChangeOutputDelta(codexItemId, delta, ctx)
      break
    }
    case 'item/reasoning/textDelta': {
      if (codexItemId) {
        ctx.appendToItemField(codexItemId, 'content', delta)
      }
      break
    }
    case 'item/reasoning/summaryTextDelta': {
      if (codexItemId) {
        ctx.appendToItemField(codexItemId, 'summary', delta)
      }
      break
    }
    case 'item/plan/delta': {
      if (codexItemId) {
        ctx.appendToItemField(codexItemId, 'output', delta)
      }
      break
    }
    default:
      break
  }
}

function handleFileChangeOutputDelta(
  codexItemId: string,
  delta: string,
  ctx: NotificationDispatchContext
): void {
  if (!codexItemId) return
  const msgId = ctx.codexItemToMsgId.current.get(codexItemId)
  const existingDiff = msgId
    ? (ctx.getCurrentCodexRuntime()?.messages ?? []).find(
        message => message.id === msgId && message.kind === 'diff'
      )
    : undefined
  if (
    looksLikeUnifiedDiff(delta) ||
    (existingDiff?.kind === 'diff' && Boolean(existingDiff.diff))
  ) {
    ctx.appendToItemField(codexItemId, 'diff', delta)
  }
}

// ---------------------------------------------------------------------------
// thread/status/changed
// ---------------------------------------------------------------------------

function handleThreadStatusChanged(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const status = params.status as { type: string } | undefined
  const statusThreadId = readThreadId(params) ?? undefined
  if (
    status?.type === 'idle' &&
    statusThreadId &&
    ctx.getCurrentCodexRuntime()?.thread?.id === statusThreadId &&
    !ctx.activeTurnIdRef.current
  ) {
    ctx.interruptRequestedRef.current = false
    ctx.setStreamingState(false)
  }
}
