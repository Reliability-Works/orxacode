/**
 * SharedThreadRow — composes the per-row props that both the pinned-thread
 * list and the chat group derive identically (active/selected, jump label,
 * running flag, PR/terminal status, confirm-delete) and renders a ThreadRow.
 *
 * Centralizes the composition so both call sites stay below jscpd's
 * duplication threshold.
 */
import type { ThreadId } from '@orxa-code/contracts'

import { selectThreadTerminalState } from '../../terminalStateStore'
import type { ThreadTerminalState } from '../../terminalStateStore.logic'
import { resolveThreadRowClassName } from '../Sidebar.logic'
import type { ThreadStatusPill } from '../Sidebar.logic'
import { prStatusIndicator, terminalStatusFromRunningIds, type ThreadPr } from './threadRowUtils'
import { ThreadRow, type SidebarThreadSnapshot, type ThreadRowProps } from './ThreadRow'

type ThreadRowExtras = Omit<
  ThreadRowProps,
  | 'thread'
  | 'isActive'
  | 'isSelected'
  | 'jumpLabel'
  | 'isThreadRunning'
  | 'threadStatus'
  | 'prStatus'
  | 'terminalStatus'
  | 'isConfirmingDelete'
  | 'orderedProjectThreadIds'
  | 'rowClassName'
>

export interface SharedThreadRowContext {
  routeThreadId: ThreadId | null
  selectedThreadIds: ReadonlySet<ThreadId>
  threadJumpLabelById: Map<ThreadId, string>
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
  prByThreadId: Map<ThreadId, ThreadPr | null>
  confirmingDeleteThreadId: ThreadId | null
  getThreadRowProps: (thread: SidebarThreadSnapshot) => ThreadRowExtras
}

export interface SharedThreadRowProps {
  thread: SidebarThreadSnapshot
  threadStatus: ThreadStatusPill | null
  orderedProjectThreadIds: readonly ThreadId[]
  ctx: SharedThreadRowContext
}

export function SharedThreadRow({
  thread,
  threadStatus,
  orderedProjectThreadIds,
  ctx,
}: SharedThreadRowProps) {
  const isActive = ctx.routeThreadId === thread.id
  const isSelected = ctx.selectedThreadIds.has(thread.id)
  const jumpLabel = ctx.threadJumpLabelById.get(thread.id) ?? null
  const isThreadRunning =
    thread.session?.status === 'running' && thread.session.activeTurnId != null
  const prStatus = prStatusIndicator(ctx.prByThreadId.get(thread.id) ?? null)
  const terminalStatus = terminalStatusFromRunningIds(
    selectThreadTerminalState(ctx.terminalStateByThreadId, thread.id).runningTerminalIds
  )
  const isConfirmingDelete = ctx.confirmingDeleteThreadId === thread.id && !isThreadRunning
  return (
    <ThreadRow
      thread={thread}
      isActive={isActive}
      isSelected={isSelected}
      jumpLabel={jumpLabel}
      isThreadRunning={isThreadRunning}
      threadStatus={threadStatus}
      prStatus={prStatus}
      terminalStatus={terminalStatus}
      isConfirmingDelete={isConfirmingDelete}
      orderedProjectThreadIds={orderedProjectThreadIds}
      rowClassName={resolveThreadRowClassName({ isActive, isSelected })}
      {...ctx.getThreadRowProps(thread)}
    />
  )
}
