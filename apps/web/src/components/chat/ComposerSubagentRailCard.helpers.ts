import type { ThreadId } from '@orxa-code/contracts'

import type { Thread } from '../../types'

export type SubagentStatus = 'running' | 'paused' | 'ready' | 'error'

export type RailSubagentItem = {
  threadId: ThreadId
  parentThreadId: ThreadId
  title: string
  prompt: string | null
  modelLabel: string
  status: SubagentStatus
}

function formatAgentLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  return trimmed
    .split(/[\s_-]+/)
    .filter(part => part.length > 0)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function deriveSubagentStatus(thread: Thread): SubagentStatus {
  if (thread.session?.status === 'error' || thread.error) {
    return 'error'
  }
  if (
    thread.session?.status === 'running' ||
    thread.session?.orchestrationStatus === 'running' ||
    thread.latestTurn?.state === 'running'
  ) {
    return 'running'
  }
  if (thread.latestTurn?.state === 'interrupted') {
    return 'paused'
  }
  return 'ready'
}

export function hasLiveSubagent(items: ReadonlyArray<RailSubagentItem>): boolean {
  return items.some(item => item.status === 'running' || item.status === 'paused')
}

export function deriveRailSubagentItems(
  threads: ReadonlyArray<Thread>,
  parentThreadId: ThreadId | null
): RailSubagentItem[] {
  if (!parentThreadId) {
    return []
  }

  return threads
    .filter(
      thread =>
        thread.archivedAt === null &&
        thread.parentLink?.relationKind === 'subagent' &&
        thread.parentLink.parentThreadId === parentThreadId
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
    .map(thread => {
      const agentLabel = formatAgentLabel(
        thread.parentLink?.agentLabel ??
          (thread.modelSelection.provider === 'opencode' ? thread.modelSelection.agentId : null)
      )
      return {
        threadId: thread.id,
        parentThreadId,
        title: thread.title,
        prompt: thread.messages.find(message => message.role === 'user')?.text.trim() || null,
        modelLabel: agentLabel
          ? `${agentLabel} · ${thread.modelSelection.model}`
          : thread.modelSelection.model,
        status: deriveSubagentStatus(thread),
      }
    })
}
