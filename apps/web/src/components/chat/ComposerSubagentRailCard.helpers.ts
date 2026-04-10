import type { ThreadId } from '@orxa-code/contracts'
import { formatSubagentLabel } from '@orxa-code/shared/subagent'

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
      const agentLabel = formatSubagentLabel(
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
