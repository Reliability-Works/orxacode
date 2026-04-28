import { ListFilterIcon } from 'lucide-react'

import type { Project } from '../types'
import { derivePendingApprovals, derivePendingUserInputs } from '../session-logic'
import { resolveThreadStatusPill } from './Sidebar.logic'
import { SharedThreadRow, type SharedThreadRowContext } from './sidebar/SharedThreadRow'
import type { SidebarThreadSnapshot } from './sidebar/ThreadRow'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'
import { SidebarGroup, SidebarMenuSub } from './ui/sidebar'
import { SidebarNewChatMenu } from './SidebarNewChatMenu'

function SidebarChatGroupHeader() {
  return (
    <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
      <span className="text-mini font-medium uppercase tracking-wider text-muted-foreground/60">
        Chats
      </span>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Filter chats"
                disabled
                className="inline-flex size-5 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/40"
              />
            }
          >
            <ListFilterIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="right">Filter chats</TooltipPopup>
        </Tooltip>
        <SidebarNewChatMenu />
      </div>
    </div>
  )
}

export interface SidebarChatGroupProps extends SharedThreadRowContext {
  /** Chat projects (kept for future header-level affordances; not directly rendered). */
  projects: Project[]
  /** Already-built sidebar snapshots for chat threads, sorted most-recent first. */
  threadSnapshots: SidebarThreadSnapshot[]
  baseDir: string | null
}

export function SidebarChatGroup(props: SidebarChatGroupProps) {
  const { threadSnapshots, ...ctx } = props
  return (
    <SidebarGroup className="px-2 py-2">
      <SidebarChatGroupHeader />
      {threadSnapshots.length === 0 ? (
        <div className="px-2 pt-2 text-center text-xs text-muted-foreground/60">No chats yet</div>
      ) : (
        <SidebarMenuSub className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0">
          {threadSnapshots.map(thread => {
            const threadStatus = resolveThreadStatusPill({
              thread: thread as Parameters<typeof resolveThreadStatusPill>[0]['thread'],
              hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
              hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
            })
            return (
              <SharedThreadRow
                key={thread.id}
                thread={thread}
                threadStatus={threadStatus}
                orderedProjectThreadIds={[thread.id]}
                ctx={ctx}
              />
            )
          })}
        </SidebarMenuSub>
      )}
    </SidebarGroup>
  )
}
