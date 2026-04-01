import type { ExploreEntry } from '../lib/explore-utils'
import type { FileChangeDescriptor } from './codex-diff-helpers'
import type { NotificationDispatchContext } from './codex-session-notification-dispatch'
import { asString, normalizeCommandText, normalizeWorkspaceRelativePath } from './codex-session-notification-dispatch'
import { nextMessageID } from './codex-session-streaming'
import { extractFileChangeDescriptors } from './codex-diff-helpers'
import {
  cleanCommandText,
  commandToExploreEntry,
  isReadOnlyCommand,
} from '../lib/explore-utils'

// ---------------------------------------------------------------------------
// item/completed
// ---------------------------------------------------------------------------

type ItemCompletedPayload = {
  type: string
  id: string
  command?: string
  aggregatedOutput?: string
  exitCode?: number
  path?: string
  insertions?: number
  deletions?: number
  changeType?: string
  durationMs?: number
  changes?: unknown
}

export function handleItemCompleted(
  params: Record<string, unknown>,
  ctx: NotificationDispatchContext
): void {
  const item = params.item as ItemCompletedPayload
  const existingMsgId = ctx.codexItemToMsgId.current.get(item.id)

  if (item.type === 'commandExecution') {
    handleItemCompletedCommand(item, existingMsgId, ctx)
  }

  if (item.type === 'fileChange') {
    handleItemCompletedFileChange(item, existingMsgId, ctx)
  }

  if (item.type === 'fileRead' || item.type === 'webSearch' || item.type === 'mcpToolCall') {
    handleItemCompletedExploreItem(item, ctx)
  }

  if (
    item.type === 'collabToolCall' ||
    item.type === 'collabAgentToolCall' ||
    (item.type === 'mcpToolCall' &&
      asString((item as Record<string, unknown>).tool).trim() === 'spawn_agent')
  ) {
    ctx.mergeSubagentsFromCollabHints(item)
  }

  if (
    item.type === 'plan' ||
    item.type === 'collabToolCall' ||
    item.type === 'collabAgentToolCall'
  ) {
    if (existingMsgId) {
      ctx.setMessagesState(prev => {
        const idx = prev.findIndex(m => m.id === existingMsgId)
        if (idx < 0) return prev
        const existing = prev[idx]
        if (existing.kind !== 'tool') return prev
        const next = [...prev]
        next[idx] = { ...existing, status: 'completed' }
        return next
      })
    }
  }

  if (item.id === ctx.streamingItemIdRef.current) {
    ctx.streamingItemIdRef.current = null
  }

  ctx.codexItemToMsgId.current.delete(item.id)
}

// ---------------------------------------------------------------------------
// item/completed sub-handlers
// ---------------------------------------------------------------------------

function handleItemCompletedCommand(
  item: ItemCompletedPayload,
  existingMsgId: string | undefined,
  ctx: NotificationDispatchContext
): void {
  const exploreGroupId = ctx.codexItemToExploreGroupId.current.get(item.id)
  const rawCommand = normalizeCommandText(item.command)
  const anchorMessageId = existingMsgId
  const readOnly =
    rawCommand.length > 0
      ? commandToExploreEntry('_check', rawCommand, 'completed') !== null
      : false

  if (exploreGroupId) {
    handleCompletedCommandExploreGroup(item, rawCommand, exploreGroupId, readOnly, ctx)
  } else if (existingMsgId) {
    handleCompletedCommandExistingCard(item, rawCommand, existingMsgId, ctx)
  } else {
    handleCompletedCommandFallback(item, rawCommand, ctx)
  }

  if (rawCommand && !isReadOnlyCommand(rawCommand)) {
    ctx.stopCommandDiffPolling(item.id)
    window.setTimeout(() => {
      void ctx.attributeCommandFileChanges(item.id, anchorMessageId, {
        status: 'completed',
        clearBaseline: true,
      })
    }, 40)
  }
}

function handleCompletedCommandExploreGroup(
  item: ItemCompletedPayload,
  rawCommand: string,
  exploreGroupId: string,
  readOnly: boolean,
  ctx: NotificationDispatchContext
): void {
  ctx.codexItemToExploreGroupId.current.delete(item.id)
  if (readOnly) {
    const finalStatus: ExploreEntry['status'] =
      item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error'
    const cleaned = rawCommand.length > 0 ? cleanCommandText(rawCommand) : 'Command'
    const cleanedLabel = cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned
    ctx.setMessagesState(prev => {
      const gIdx = prev.findIndex(m => m.id === exploreGroupId)
      if (gIdx < 0) return prev
      const group = prev[gIdx]
      if (group.kind !== 'explore') return prev
      const updatedEntries = group.entries.map(e =>
        e.id === item.id ? { ...e, label: cleanedLabel, status: finalStatus } : e
      )
      const allDone = updatedEntries.every(
        e => e.status === 'completed' || e.status === 'error'
      )
      const next = [...prev]
      next[gIdx] = {
        ...group,
        entries: updatedEntries,
        status: allDone ? 'explored' : 'exploring',
      }
      return next
    })
  } else {
    ctx.setMessagesState(prev => {
      const gIdx = prev.findIndex(m => m.id === exploreGroupId)
      let base = prev
      if (gIdx >= 0) {
        const group = prev[gIdx]
        if (group.kind === 'explore') {
          const filteredEntries = group.entries.filter(e => e.id !== item.id)
          if (filteredEntries.length === 0) {
            base = prev.filter(m => m.id !== exploreGroupId)
          } else {
            base = [...prev]
            base[gIdx] = { ...group, entries: filteredEntries }
          }
        }
      }
      const msgId = nextMessageID('codex-cmd', ctx.messageIdCounter)
      return [
        ...base,
        {
          id: msgId,
          kind: 'tool' as const,
          toolType: 'commandExecution',
          title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : 'Command',
          command: rawCommand || undefined,
          output: item.aggregatedOutput,
          status:
            item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error',
          exitCode: item.exitCode,
          durationMs: item.durationMs,
          timestamp: Date.now(),
        },
      ]
    })
  }
}

function handleCompletedCommandExistingCard(
  item: ItemCompletedPayload,
  rawCommand: string,
  existingMsgId: string,
  ctx: NotificationDispatchContext
): void {
  ctx.setMessagesState(prev => {
    const idx = prev.findIndex(m => m.id === existingMsgId)
    if (idx < 0) return prev
    const existing = prev[idx]
    if (existing.kind !== 'tool') return prev
    const next = [...prev]
    next[idx] = {
      ...existing,
      title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : existing.title,
      command: rawCommand || existing.command,
      output: item.aggregatedOutput ?? existing.output,
      status: item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error',
      exitCode: item.exitCode,
      durationMs: item.durationMs,
    }
    return next
  })
}

function handleCompletedCommandFallback(
  item: ItemCompletedPayload,
  rawCommand: string,
  ctx: NotificationDispatchContext
): void {
  const fallbackEntry = rawCommand
    ? commandToExploreEntry(
        `fallback-${Date.now()}`,
        rawCommand,
        item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error'
      )
    : null
  if (fallbackEntry) {
    ctx.setMessagesState(prev => {
      const last = prev[prev.length - 1]
      if (last && last.kind === 'explore') {
        const next = [...prev]
        next[next.length - 1] = { ...last, entries: [...last.entries, fallbackEntry] }
        return next
      }
      const groupId = nextMessageID('codex-explore', ctx.messageIdCounter)
      return [
        ...prev,
        {
          id: groupId,
          kind: 'explore' as const,
          status: 'explored' as const,
          entries: [fallbackEntry],
          timestamp: Date.now(),
        },
      ]
    })
  } else {
    const msgId = nextMessageID('codex-cmd', ctx.messageIdCounter)
    ctx.setMessagesState(prev => [
      ...prev,
      {
        id: msgId,
        kind: 'tool',
        toolType: 'commandExecution',
        title: rawCommand ? `$ ${rawCommand.slice(0, 60)}` : 'Command',
        command: rawCommand || undefined,
        output: item.aggregatedOutput,
        status: item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error',
        exitCode: item.exitCode,
        timestamp: Date.now(),
      },
    ])
  }
}

function handleItemCompletedFileChange(
  item: ItemCompletedPayload,
  existingMsgId: string | undefined,
  ctx: NotificationDispatchContext
): void {
  const existingDiffItem = existingMsgId
    ? (ctx.getCurrentCodexRuntime()?.messages ?? []).find(
        message => message.id === existingMsgId && message.kind === 'diff'
      )
    : undefined
  const rawDescriptors = extractFileChangeDescriptors(
    item,
    existingDiffItem?.kind === 'diff' ? existingDiffItem.diff : undefined
  )
  const fallbackDescriptors =
    rawDescriptors.length > 0
      ? rawDescriptors
      : [
          {
            path: item.path!,
            type: item.changeType ?? 'modified',
            diff: undefined,
            insertions: item.insertions,
            deletions: item.deletions,
          } satisfies FileChangeDescriptor,
        ]

  void ctx.enrichFileChangeDescriptors(fallbackDescriptors).then(descriptors => {
    if (existingMsgId && descriptors.length <= 1) {
      const descriptor = descriptors[0]
      ctx.setMessagesState(prev => {
        const idx = prev.findIndex(m => m.id === existingMsgId)
        if (idx < 0) return prev
        const existing = prev[idx]
        if (existing.kind !== 'diff') return prev
        const next = [...prev]
        next[idx] = {
          ...existing,
          path: normalizeWorkspaceRelativePath(
            descriptor?.path ?? item.path!,
            ctx.directory
          ),
          type: descriptor?.type ?? item.changeType ?? existing.type,
          status: item.exitCode === 0 || item.exitCode === undefined ? 'completed' : 'error',
          diff: descriptor?.diff ?? existing.diff,
          insertions: descriptor?.insertions ?? item.insertions ?? existing.insertions,
          deletions: descriptor?.deletions ?? item.deletions ?? existing.deletions,
        }
        return next
      })
      return
    }

    if (existingMsgId && descriptors.length > 1) {
      ctx.setMessagesState(prev => {
        const idx = prev.findIndex(m => m.id === existingMsgId)
        if (idx < 0) return prev
        const next = [...prev]
        next.splice(
          idx,
          1,
          ...descriptors.map((descriptor, descriptorIndex) => ({
            id: `${item.id}:change:${descriptor.path}:${descriptorIndex}`,
            kind: 'diff' as const,
            path: normalizeWorkspaceRelativePath(descriptor.path, ctx.directory),
            type: descriptor.type,
            status:
              item.exitCode === 0 || item.exitCode === undefined
                ? ('completed' as const)
                : ('error' as const),
            diff: descriptor.diff,
            insertions: descriptor.insertions,
            deletions: descriptor.deletions,
            timestamp: Date.now(),
          }))
        )
        return next
      })
      return
    }

    ctx.setMessagesState(prev => [
      ...prev,
      ...descriptors.map((descriptor, descriptorIndex) => ({
        id: `${item.id}:change:${descriptor.path}:${descriptorIndex}`,
        kind: 'diff' as const,
        path: normalizeWorkspaceRelativePath(descriptor.path, ctx.directory),
        type: descriptor.type,
        status:
          item.exitCode === 0 || item.exitCode === undefined
            ? ('completed' as const)
            : ('error' as const),
        diff: descriptor.diff,
        insertions: descriptor.insertions,
        deletions: descriptor.deletions,
        timestamp: Date.now(),
      })),
    ])
  })
}

function handleItemCompletedExploreItem(
  item: ItemCompletedPayload,
  ctx: NotificationDispatchContext
): void {
  const exploreGroupId = ctx.codexItemToExploreGroupId.current.get(item.id)
  if (exploreGroupId) {
    ctx.setMessagesState(prev => {
      const gIdx = prev.findIndex(m => m.id === exploreGroupId)
      if (gIdx < 0) return prev
      const group = prev[gIdx]
      if (group.kind !== 'explore') return prev
      const updatedEntries = group.entries.map(e =>
        e.id === item.id ? { ...e, status: 'completed' as const } : e
      )
      const allDone = updatedEntries.every(
        e => e.status === 'completed' || e.status === 'error'
      )
      const next = [...prev]
      next[gIdx] = {
        ...group,
        entries: updatedEntries,
        status: allDone ? 'explored' : 'exploring',
      }
      return next
    })
    ctx.codexItemToExploreGroupId.current.delete(item.id)
  }
}
