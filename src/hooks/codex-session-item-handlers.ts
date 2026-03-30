import type { ExploreEntry } from '../lib/explore-utils'
import type { NotificationDispatchContext } from './codex-session-notification-dispatch'
import { asString, normalizeCommandText } from './codex-session-notification-dispatch'
import { nextMessageID } from './codex-session-streaming'
import {
  commandToExploreEntry,
  fileReadToExploreEntry,
  isReadOnlyCommand,
  mcpToolCallToExploreEntry,
  webSearchToExploreEntry,
} from '../lib/explore-utils'

// ---------------------------------------------------------------------------
// item/started
// ---------------------------------------------------------------------------

type ItemStartedPayload = {
  type: string
  id: string
  content?: Array<{ type: string; text?: string }>
  path?: string
  query?: string
  toolName?: string
  name?: string
  command?: string
  changeType?: string
}

export function handleItemStarted(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const item = params.item as ItemStartedPayload
  if (ctx.interruptRequestedRef.current) return

  if (
    item.type === 'agentMessage' ||
    item.type === 'commandExecution' ||
    item.type === 'fileChange' ||
    item.type === 'plan' ||
    item.type === 'reasoning'
  ) {
    ctx.setStreamingState(true)
  }

  switch (item.type) {
    case 'agentMessage':
      handleItemStartedAgentMessage(item, ctx)
      break
    case 'reasoning':
      handleItemStartedReasoning(item, ctx)
      break
    case 'commandExecution':
      handleItemStartedCommand(item, ctx)
      break
    case 'fileChange':
      handleItemStartedFileChange(item, ctx)
      break
    case 'fileRead':
      handleItemStartedFileRead(item, ctx)
      break
    case 'webSearch':
      handleItemStartedWebSearch(item, ctx)
      break
    case 'mcpToolCall':
      handleItemStartedMcpToolCall(item, ctx)
      break
    case 'plan':
      handleItemStartedPlan(item, ctx)
      break
    case 'contextCompaction':
      handleItemStartedCompaction(item, ctx)
      break
    default:
      break
  }

  handleItemStartedCollabHints(item, ctx)
  handleItemStartedCollabTracking(item, ctx)
}

function handleItemStartedAgentMessage(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  ctx.streamingItemIdRef.current = item.id
  const msgId = nextMessageID('codex-assistant', ctx.messageIdCounter)
  ctx.codexItemToMsgId.current.set(item.id, msgId)
  ctx.activeExploreGroupIdRef.current = null
  ctx.setMessagesState(prev => {
    const result = prev.map(m =>
      m.kind === 'explore' && m.status === 'exploring'
        ? { ...m, status: 'explored' as const }
        : m
    )
    result.push({
      id: msgId,
      kind: 'message',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    })
    return result
  })
}

function handleItemStartedReasoning(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  if (ctx.currentReasoningIdRef.current) {
    ctx.codexItemToMsgId.current.set(item.id, ctx.currentReasoningIdRef.current)
  } else {
    const msgId = nextMessageID('codex-reasoning', ctx.messageIdCounter)
    ctx.codexItemToMsgId.current.set(item.id, msgId)
    ctx.currentReasoningIdRef.current = msgId
    ctx.setMessagesState(prev => [
      ...prev,
      { id: msgId, kind: 'reasoning', content: '', summary: '', timestamp: Date.now() },
    ])
  }
}

function handleItemStartedCommand(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const rawCommand = normalizeCommandText(item.command)
  if (rawCommand && !isReadOnlyCommand(rawCommand)) {
    ctx.commandDiffSnapshotsRef.current.set(item.id, ctx.captureCommandDiffSnapshot())
    ctx.startCommandDiffPolling(item.id)
  }
  const exploreEntry = rawCommand ? commandToExploreEntry(item.id, rawCommand, 'running') : null
  if (exploreEntry) {
    appendToExploreGroup(item.id, exploreEntry, ctx)
  } else {
    const msgId = nextMessageID('codex-cmd', ctx.messageIdCounter)
    ctx.codexItemToMsgId.current.set(item.id, msgId)
    ctx.updateMessages(prev => [
      ...prev,
      {
        id: msgId,
        kind: 'tool',
        toolType: 'commandExecution',
        title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : 'Running command...',
        command: rawCommand || undefined,
        output: '',
        status: 'running',
        timestamp: Date.now(),
      },
    ])
  }
}

function handleItemStartedFileChange(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const msgId = nextMessageID('codex-diff', ctx.messageIdCounter)
  ctx.codexItemToMsgId.current.set(item.id, msgId)
  ctx.updateMessages(prev => [
    ...prev,
    {
      id: msgId,
      kind: 'diff',
      path: item.path ?? '',
      type: item.changeType ?? 'modified',
      status: 'running',
      diff: '',
      timestamp: Date.now(),
    },
  ])
}

function handleItemStartedFileRead(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const entry = fileReadToExploreEntry(item.id, item.path ?? 'file', 'running')
  appendToExploreGroup(item.id, entry, ctx)
}

function handleItemStartedWebSearch(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const entry = webSearchToExploreEntry(
    item.id,
    (item.query as string) ?? 'search',
    'running'
  )
  appendToExploreGroup(item.id, entry, ctx)
}

function handleItemStartedMcpToolCall(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const entry = mcpToolCallToExploreEntry(
    item.id,
    item.toolName ?? item.name ?? 'mcp tool',
    'running'
  )
  appendToExploreGroup(item.id, entry, ctx)
}

function handleItemStartedPlan(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const msgId = nextMessageID('codex-plan', ctx.messageIdCounter)
  ctx.codexItemToMsgId.current.set(item.id, msgId)
  ctx.updateMessages(prev => [
    ...prev,
    {
      id: msgId,
      kind: 'tool',
      toolType: 'plan',
      title: 'Plan',
      output: '',
      status: 'running',
      timestamp: Date.now(),
    },
  ])
}

function handleItemStartedCompaction(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  const msgId = nextMessageID('codex-compaction', ctx.messageIdCounter)
  ctx.codexItemToMsgId.current.set(item.id, msgId)
  ctx.updateMessages(prev => [
    ...prev,
    { id: msgId, kind: 'compaction', timestamp: Date.now() },
  ])
}

function handleItemStartedCollabHints(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  if (
    item.type === 'collabToolCall' ||
    item.type === 'collabAgentToolCall' ||
    (item.type === 'mcpToolCall' &&
      asString((item as Record<string, unknown>).tool).trim() === 'spawn_agent')
  ) {
    ctx.mergeSubagentsFromCollabHints(item)
  }
}

function handleItemStartedCollabTracking(
  item: ItemStartedPayload,
  ctx: NotificationDispatchContext
): void {
  if (item.type !== 'collabToolCall' && item.type !== 'collabAgentToolCall') return

  const collabItem = item as {
    type: string
    id: string
    name?: string
    toolName?: string
    title?: string
    collabSender?: { threadId: string; nickname?: string; role?: string }
    collabReceiver?: { threadId: string; nickname?: string; role?: string }
    collabReceivers?: Array<{ threadId: string; nickname?: string; role?: string }>
    collabStatuses?: Array<{
      threadId: string
      nickname?: string
      role?: string
      status: string
    }>
  }
  const receivers =
    collabItem.collabReceivers ??
    (collabItem.collabReceiver ? [collabItem.collabReceiver] : undefined)

  if (collabItem.collabStatuses) {
    ctx.setSubagentsState(prev => {
      let next = prev
      for (const cs of collabItem.collabStatuses!) {
        const idx = next.findIndex(a => a.threadId === cs.threadId)
        if (idx >= 0) {
          if (next === prev) next = [...prev]
          const statusText = cs.status || 'is thinking'
          next[idx] = {
            ...next[idx],
            nickname: cs.nickname ?? next[idx].nickname,
            role: cs.role ?? next[idx].role,
            status: statusText.includes('await') ? 'awaiting_instruction' : 'thinking',
            statusText,
          }
        } else if (cs.threadId && cs.nickname) {
          if (next === prev) next = [...prev]
          ctx.subagentThreadIds.current.add(cs.threadId)
          next.push({
            threadId: cs.threadId,
            nickname: cs.nickname,
            role: cs.role ?? 'worker',
            status: 'thinking',
            statusText: cs.status || 'is thinking',
            spawnedAt: Date.now(),
          })
        }
      }
      return next
    })
  }

  if (receivers) {
    for (const r of receivers) {
      if (r.threadId && !ctx.subagentThreadIds.current.has(r.threadId)) {
        ctx.subagentThreadIds.current.add(r.threadId)
        ctx.setSubagentsState(prev => {
          if (prev.some(a => a.threadId === r.threadId)) return prev
          return [
            ...prev,
            {
              threadId: r.threadId,
              nickname: r.nickname ?? `Agent-${prev.length + 1}`,
              role: r.role ?? 'worker',
              status: 'thinking',
              statusText: 'is thinking',
              spawnedAt: Date.now(),
            },
          ]
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function appendToExploreGroup(
  itemId: string,
  entry: ExploreEntry,
  ctx: NotificationDispatchContext
): void {
  ctx.updateMessages(prev => {
    const activeGroupId = ctx.activeExploreGroupIdRef.current
    if (activeGroupId) {
      const gIdx = prev.findIndex(m => m.id === activeGroupId)
      if (gIdx >= 0 && prev[gIdx].kind === 'explore') {
        ctx.codexItemToExploreGroupId.current.set(itemId, activeGroupId)
        const next = [...prev]
        next[gIdx] = {
          ...(prev[gIdx] as (typeof prev)[number] & { kind: 'explore' }),
          entries: [
            ...(prev[gIdx] as (typeof prev)[number] & { kind: 'explore' }).entries,
            entry,
          ],
        }
        return next
      }
    }
    const groupId = nextMessageID('codex-explore', ctx.messageIdCounter)
    ctx.activeExploreGroupIdRef.current = groupId
    ctx.codexItemToExploreGroupId.current.set(itemId, groupId)
    return [
      ...prev,
      {
        id: groupId,
        kind: 'explore' as const,
        status: 'exploring' as const,
        entries: [entry],
        timestamp: Date.now(),
      },
    ]
  })
}
