import { ListFilterIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'

import type { Project, Thread } from '../types'
import { isChatProject } from '../lib/chatProject'
import { formatRelativeTime } from '../timestampFormat'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/tooltip'
import { SidebarGroup } from './ui/sidebar'
import { SidebarNewChatMenu } from './SidebarNewChatMenu'
import { cn } from '~/lib/utils'

type ChatThreadEntry = {
  threadId: ThreadId
  projectId: ProjectId
  title: string
  sortKey: string
}

function chatThreadSortKey(thread: Thread): string {
  return thread.updatedAt ?? thread.createdAt
}

function chatThreadTitle(thread: Thread): string {
  const trimmed = thread.title.trim()
  if (trimmed) return trimmed
  return 'Untitled chat'
}

function buildChatEntries(
  projects: Project[],
  threads: Thread[],
  baseDir: string | null
): ChatThreadEntry[] {
  if (!baseDir) return []
  const chatProjectIds = new Set<ProjectId>()
  for (const project of projects) {
    if (isChatProject(project, baseDir)) chatProjectIds.add(project.id)
  }
  if (chatProjectIds.size === 0) return []
  const entries: ChatThreadEntry[] = []
  for (const thread of threads) {
    if (!chatProjectIds.has(thread.projectId)) continue
    if (thread.archivedAt !== null) continue
    entries.push({
      threadId: thread.id,
      projectId: thread.projectId,
      title: chatThreadTitle(thread),
      sortKey: chatThreadSortKey(thread),
    })
  }
  entries.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))
  return entries
}

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

interface SidebarChatRowProps {
  entry: ChatThreadEntry
  isActive: boolean
  onClick: () => void
}

function SidebarChatRow({ entry, isActive, onClick }: SidebarChatRowProps) {
  const relative = formatRelativeTime(entry.sortKey)
  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        isActive
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground/80 hover:bg-accent hover:text-foreground'
      )}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate text-xs">{entry.title}</span>
      <span className="shrink-0 text-mini text-muted-foreground/60">{relative.value}</span>
    </button>
  )
}

export interface SidebarChatGroupProps {
  projects: Project[]
  threads: Thread[]
  baseDir: string | null
  routeThreadId: ThreadId | null
}

export function SidebarChatGroup({
  projects,
  threads,
  baseDir,
  routeThreadId,
}: SidebarChatGroupProps) {
  const navigate = useNavigate()
  const entries = useMemo(
    () => buildChatEntries(projects, threads, baseDir),
    [projects, threads, baseDir]
  )

  return (
    <SidebarGroup className="px-2 py-2">
      <SidebarChatGroupHeader />
      {entries.length === 0 ? (
        <div className="px-2 pt-2 text-center text-xs text-muted-foreground/60">No chats yet</div>
      ) : (
        <div className="flex flex-col">
          {entries.map(entry => (
            <SidebarChatRow
              key={entry.threadId}
              entry={entry}
              isActive={routeThreadId === entry.threadId}
              onClick={() =>
                void navigate({ to: '/$threadId', params: { threadId: entry.threadId } })
              }
            />
          ))}
        </div>
      )}
    </SidebarGroup>
  )
}
