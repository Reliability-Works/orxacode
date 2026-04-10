import { ArchiveIcon, TerminalIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { ThreadId } from '@orxa-code/contracts'
import type { Thread } from '../../types'
import { formatRelativeTimeLabel } from '../../timestampFormat'
import { useIsMobile } from '~/hooks/useMediaQuery'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { SidebarMenuSubButton, SidebarMenuSubItem } from '../ui/sidebar'
import type { ThreadStatusPill } from '../Sidebar.logic'
import type { TerminalStatusIndicator, PrStatusIndicator, ThreadPr } from './threadRowUtils'
import { ThreadRowTitleContent } from './ThreadRowTitle'

export type { TerminalStatusIndicator, PrStatusIndicator, ThreadPr }

export type SidebarThreadSnapshot = Pick<
  Thread,
  | 'activities'
  | 'archivedAt'
  | 'branch'
  | 'createdAt'
  | 'id'
  | 'interactionMode'
  | 'latestTurn'
  | 'modelSelection'
  | 'parentLink'
  | 'projectId'
  | 'proposedPlans'
  | 'session'
  | 'title'
  | 'updatedAt'
  | 'worktreePath'
> & {
  lastVisitedAt?: string | undefined
  latestUserMessageAt: string | null
}

export type SidebarProjectSnapshot = Pick<Thread, 'id' | 'projectId'> & { expanded: boolean }

export { ThreadStatusLabel } from './ThreadRowTitle'

export interface ThreadRowRenameState {
  isRenaming: boolean
  title: string
  onTitleChange: (title: string) => void
  onCommit: (threadId: ThreadId, newTitle: string, originalTitle: string) => void
  onCancel: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  committedRef: React.MutableRefObject<boolean>
}

export interface ThreadRowArchiveState {
  isConfirming: boolean
  onConfirmingChange: React.Dispatch<React.SetStateAction<ThreadId | null>>
  buttonRefs: React.MutableRefObject<Map<ThreadId, HTMLButtonElement>>
  onAttempt: (threadId: ThreadId) => void
  confirmThreadArchive: boolean
}

export interface ThreadRowProps {
  thread: SidebarThreadSnapshot
  nestingLevel?: number
  hasChildren?: boolean
  childrenExpanded?: boolean
  isActive: boolean
  isSelected: boolean
  jumpLabel: string | null
  isThreadRunning: boolean
  threadStatus: ThreadStatusPill | null
  prStatus: PrStatusIndicator | null
  terminalStatus: TerminalStatusIndicator | null
  isConfirmingArchive: boolean
  orderedProjectThreadIds: readonly ThreadId[]
  rowClassName: string
  onThreadClick: (
    event: MouseEvent,
    threadId: ThreadId,
    orderedProjectThreadIds: readonly ThreadId[]
  ) => void
  onToggleChildren?: (threadId: ThreadId, expanded: boolean) => void
  onThreadNavigate: (threadId: ThreadId) => void
  onThreadContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void
  onMultiSelectContextMenu: (position: { x: number; y: number }) => void
  onOpenPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void
  rename: ThreadRowRenameState
  archive: ThreadRowArchiveState
  showThreadJumpHints: boolean
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
}

function ThreadRowActionArea({
  thread,
  isActive,
  isSelected,
  isThreadRunning,
  isConfirmingArchive,
  terminalStatus,
  jumpLabel,
  showThreadJumpHints,
  archive,
}: {
  thread: SidebarThreadSnapshot
  isActive: boolean
  isSelected: boolean
  isThreadRunning: boolean
  isConfirmingArchive: boolean
  terminalStatus: TerminalStatusIndicator | null
  jumpLabel: string | null
  showThreadJumpHints: boolean
  archive: ThreadRowArchiveState
}) {
  const isMobile = useIsMobile()
  const isHighlighted = isActive || isSelected
  const threadMetaClassName = isConfirmingArchive
    ? 'pointer-events-none opacity-0'
    : !isThreadRunning
      ? 'pointer-events-none transition-opacity duration-150 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0'
      : 'pointer-events-none'

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-1.5">
      {terminalStatus && (
        <span
          role="img"
          aria-label={terminalStatus.label}
          title={terminalStatus.label}
          className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
        >
          <TerminalIcon
            className={`${isMobile ? 'size-3.5' : 'size-3'} ${terminalStatus.pulse ? 'animate-pulse' : ''}`}
          />
        </span>
      )}
      <div className="flex min-w-14 justify-end md:min-w-12">
        <ThreadRowArchiveArea
          thread={thread}
          isThreadRunning={isThreadRunning}
          isConfirmingArchive={isConfirmingArchive}
          archive={archive}
        />
        <span className={threadMetaClassName}>
          {showThreadJumpHints && jumpLabel ? (
            <span
              className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
              title={jumpLabel}
            >
              {jumpLabel}
            </span>
          ) : (
            <span
              className={`text-xs md:text-[10px] ${isHighlighted ? 'text-foreground/72 dark:text-foreground/82' : 'text-muted-foreground/40'}`}
            >
              {formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function ThreadRowArchiveConfirmButton({
  thread,
  archive,
}: {
  thread: SidebarThreadSnapshot
  archive: ThreadRowArchiveState
}) {
  return (
    <button
      ref={el => {
        if (el) archive.buttonRefs.current.set(thread.id, el)
        else archive.buttonRefs.current.delete(thread.id)
      }}
      type="button"
      data-thread-selection-safe
      data-testid={`thread-archive-confirm-${thread.id}`}
      aria-label={`Confirm archive ${thread.title}`}
      className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        archive.onConfirmingChange(c => (c === thread.id ? null : c))
        void archive.onAttempt(thread.id)
      }}
    >
      Confirm
    </button>
  )
}

function ThreadRowArchiveArea({
  thread,
  isThreadRunning,
  isConfirmingArchive,
  archive,
}: {
  thread: SidebarThreadSnapshot
  isThreadRunning: boolean
  isConfirmingArchive: boolean
  archive: ThreadRowArchiveState
}) {
  if (isConfirmingArchive) {
    return <ThreadRowArchiveConfirmButton thread={thread} archive={archive} />
  }
  if (isThreadRunning) return null

  const archiveButtonEl = (
    <button
      type="button"
      data-thread-selection-safe
      data-testid={`thread-archive-${thread.id}`}
      aria-label={`Archive ${thread.title}`}
      className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (archive.confirmThreadArchive) {
          archive.onConfirmingChange(thread.id)
          requestAnimationFrame(() => {
            archive.buttonRefs.current.get(thread.id)?.focus()
          })
        } else {
          void archive.onAttempt(thread.id)
        }
      }}
    >
      <ArchiveIcon className="size-3.5" />
    </button>
  )

  const wrapperClass =
    'pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100'

  if (archive.confirmThreadArchive) {
    return <div className={wrapperClass}>{archiveButtonEl}</div>
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<div className={wrapperClass}>{archiveButtonEl}</div>} />
      <TooltipPopup side="top">Archive</TooltipPopup>
    </Tooltip>
  )
}

function createContextMenuHandler(opts: {
  threadId: ThreadId
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  onMultiSelectContextMenu: ThreadRowProps['onMultiSelectContextMenu']
  onThreadContextMenu: ThreadRowProps['onThreadContextMenu']
}) {
  return (event: React.MouseEvent) => {
    event.preventDefault()
    const pos = { x: event.clientX, y: event.clientY }
    if (opts.selectedThreadIds.size > 0 && opts.selectedThreadIds.has(opts.threadId)) {
      void opts.onMultiSelectContextMenu(pos)
      return
    }
    if (opts.selectedThreadIds.size > 0) opts.clearSelection()
    void opts.onThreadContextMenu(opts.threadId, pos)
  }
}

function ThreadRowButton(
  props: ThreadRowProps & { handleContextMenu: (e: React.MouseEvent) => void }
) {
  const isMobile = useIsMobile()
  const {
    thread,
    isActive,
    isSelected,
    jumpLabel,
    isThreadRunning,
    threadStatus,
    prStatus,
    terminalStatus,
    isConfirmingArchive,
    orderedProjectThreadIds,
    nestingLevel = 0,
    hasChildren = false,
    childrenExpanded = false,
    rowClassName,
    onThreadClick,
    onToggleChildren,
    onThreadNavigate,
    onOpenPrLink,
    rename,
    archive,
    showThreadJumpHints,
    handleContextMenu,
  } = props
  return (
    <SidebarMenuSubButton
      render={<div role="button" tabIndex={0} />}
      size={isMobile ? 'md' : 'sm'}
      isActive={isActive}
      data-testid={`thread-row-${thread.id}`}
      className={`${rowClassName} relative isolate`}
      style={
        nestingLevel > 0
          ? { paddingLeft: `${(isMobile ? 10 : 8) + nestingLevel * (isMobile ? 16 : 14)}px` }
          : undefined
      }
      onClick={event => {
        onThreadClick(event, thread.id, orderedProjectThreadIds)
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onThreadNavigate(thread.id)
      }}
      onContextMenu={handleContextMenu}
    >
      <ThreadRowTitleContent
        thread={thread}
        hasChildren={hasChildren}
        childrenExpanded={childrenExpanded}
        prStatus={prStatus}
        threadStatus={threadStatus}
        rename={rename}
        onOpenPrLink={onOpenPrLink}
        {...(onToggleChildren ? { onToggleChildren } : {})}
      />
      <ThreadRowActionArea
        thread={thread}
        isActive={isActive}
        isSelected={isSelected}
        isThreadRunning={isThreadRunning}
        isConfirmingArchive={isConfirmingArchive}
        terminalStatus={terminalStatus}
        jumpLabel={jumpLabel}
        showThreadJumpHints={showThreadJumpHints}
        archive={archive}
      />
    </SidebarMenuSubButton>
  )
}

export function ThreadRow(props: ThreadRowProps) {
  const {
    thread,
    archive,
    selectedThreadIds,
    clearSelection,
    onMultiSelectContextMenu,
    onThreadContextMenu,
  } = props
  const dismissArchiveConfirm = () => {
    archive.onConfirmingChange(c => (c === thread.id ? null : c))
  }
  const handleContextMenu = createContextMenuHandler({
    threadId: thread.id,
    selectedThreadIds,
    clearSelection,
    onMultiSelectContextMenu,
    onThreadContextMenu,
  })
  return (
    <SidebarMenuSubItem
      key={thread.id}
      className="w-full"
      data-thread-item
      onMouseLeave={dismissArchiveConfirm}
      onBlurCapture={event => {
        const currentTarget = event.currentTarget
        requestAnimationFrame(() => {
          if (!currentTarget.contains(document.activeElement)) dismissArchiveConfirm()
        })
      }}
    >
      <ThreadRowButton {...props} handleContextMenu={handleContextMenu} />
    </SidebarMenuSubItem>
  )
}
