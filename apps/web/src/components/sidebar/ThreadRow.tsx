import { TerminalIcon, Trash2Icon } from 'lucide-react'
import type { DragEvent, MouseEvent } from 'react'
import { ThreadId } from '@orxa-code/contracts'
import type { Thread } from '../../types'
import { formatRelativeTimeLabel } from '../../timestampFormat'
import { THREAD_DRAG_MIME, useThreadDragStore } from '../../threadDragStore'
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

export interface ThreadRowDeleteState {
  isConfirming: boolean
  onConfirmingChange: React.Dispatch<React.SetStateAction<ThreadId | null>>
  buttonRefs: React.MutableRefObject<Map<ThreadId, HTMLButtonElement>>
  onAttempt: (threadId: ThreadId) => void
  confirmThreadDelete: boolean
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
  isConfirmingDelete: boolean
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
  deleteAction: ThreadRowDeleteState
  showThreadJumpHints: boolean
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
}

function ThreadRowActionArea({
  thread,
  isActive,
  isSelected,
  isThreadRunning,
  isConfirmingDelete,
  terminalStatus,
  jumpLabel,
  showThreadJumpHints,
  deleteAction,
}: {
  thread: SidebarThreadSnapshot
  isActive: boolean
  isSelected: boolean
  isThreadRunning: boolean
  isConfirmingDelete: boolean
  terminalStatus: TerminalStatusIndicator | null
  jumpLabel: string | null
  showThreadJumpHints: boolean
  deleteAction: ThreadRowDeleteState
}) {
  const isMobile = useIsMobile()
  const isHighlighted = isActive || isSelected
  const threadMetaClassName = isConfirmingDelete
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
        <ThreadRowDeleteArea
          thread={thread}
          isThreadRunning={isThreadRunning}
          isConfirmingDelete={isConfirmingDelete}
          deleteAction={deleteAction}
        />
        <span className={threadMetaClassName}>
          {showThreadJumpHints && jumpLabel ? (
            <span
              className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-mini font-medium tracking-tight text-foreground shadow-sm"
              title={jumpLabel}
            >
              {jumpLabel}
            </span>
          ) : (
            <span
              className={`text-xs md:text-mini ${isHighlighted ? 'text-foreground/72 dark:text-foreground/82' : 'text-muted-foreground/40'}`}
            >
              {formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

function ThreadRowDeleteConfirmButton({
  thread,
  deleteAction,
}: {
  thread: SidebarThreadSnapshot
  deleteAction: ThreadRowDeleteState
}) {
  return (
    <button
      ref={el => {
        if (el) deleteAction.buttonRefs.current.set(thread.id, el)
        else deleteAction.buttonRefs.current.delete(thread.id)
      }}
      type="button"
      data-thread-selection-safe
      data-testid={`thread-delete-confirm-${thread.id}`}
      aria-label={`Confirm delete ${thread.title}`}
      className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-mini font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        deleteAction.onConfirmingChange(c => (c === thread.id ? null : c))
        void deleteAction.onAttempt(thread.id)
      }}
    >
      Confirm
    </button>
  )
}

function ThreadRowDeleteArea({
  thread,
  isThreadRunning,
  isConfirmingDelete,
  deleteAction,
}: {
  thread: SidebarThreadSnapshot
  isThreadRunning: boolean
  isConfirmingDelete: boolean
  deleteAction: ThreadRowDeleteState
}) {
  if (isConfirmingDelete) {
    return <ThreadRowDeleteConfirmButton thread={thread} deleteAction={deleteAction} />
  }
  if (isThreadRunning) return null

  const deleteButtonEl = (
    <button
      type="button"
      data-thread-selection-safe
      data-testid={`thread-delete-${thread.id}`}
      aria-label={`Delete ${thread.title}`}
      className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
      onPointerDown={e => {
        e.stopPropagation()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (deleteAction.confirmThreadDelete) {
          deleteAction.onConfirmingChange(thread.id)
          requestAnimationFrame(() => {
            deleteAction.buttonRefs.current.get(thread.id)?.focus()
          })
        } else {
          void deleteAction.onAttempt(thread.id)
        }
      }}
    >
      <Trash2Icon className="size-3.5" />
    </button>
  )

  const wrapperClass =
    'pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100'

  if (deleteAction.confirmThreadDelete) {
    return <div className={wrapperClass}>{deleteButtonEl}</div>
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<div className={wrapperClass}>{deleteButtonEl}</div>} />
      <TooltipPopup side="top">Delete</TooltipPopup>
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

function useThreadRowDragHandlers(thread: SidebarThreadSnapshot) {
  const setDraggingThread = useThreadDragStore(store => store.setDraggingThread)
  const onDragStart = (event: DragEvent<Element>) => {
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'link'
    event.dataTransfer.setData(
      THREAD_DRAG_MIME,
      JSON.stringify({ threadId: thread.id, projectId: thread.projectId })
    )
    event.dataTransfer.setData('text/plain', thread.title)
    setDraggingThread({ threadId: thread.id, projectId: thread.projectId })
  }
  const onDragEnd = () => {
    setDraggingThread(null)
  }
  return { onDragStart, onDragEnd }
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
    isConfirmingDelete,
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
    deleteAction,
    showThreadJumpHints,
    handleContextMenu,
  } = props
  const dragHandlers = useThreadRowDragHandlers(thread)
  const style =
    nestingLevel > 0 ? { paddingLeft: `${(isMobile ? 10 : 8) + nestingLevel * 22}px` } : undefined
  return (
    <SidebarMenuSubButton
      render={<div role="button" tabIndex={0} draggable {...dragHandlers} />}
      size={isMobile ? 'md' : 'sm'}
      isActive={isActive}
      data-testid={`thread-row-${thread.id}`}
      className={`${rowClassName} relative isolate select-none`}
      style={style}
      onClick={event => onThreadClick(event, thread.id, orderedProjectThreadIds)}
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
        isConfirmingDelete={isConfirmingDelete}
        terminalStatus={terminalStatus}
        jumpLabel={jumpLabel}
        showThreadJumpHints={showThreadJumpHints}
        deleteAction={deleteAction}
      />
    </SidebarMenuSubButton>
  )
}

export function ThreadRow(props: ThreadRowProps) {
  const {
    thread,
    deleteAction,
    selectedThreadIds,
    clearSelection,
    onMultiSelectContextMenu,
    onThreadContextMenu,
  } = props
  const dismissDeleteConfirm = () => {
    deleteAction.onConfirmingChange(c => (c === thread.id ? null : c))
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
      onMouseLeave={dismissDeleteConfirm}
      onBlurCapture={event => {
        const currentTarget = event.currentTarget
        requestAnimationFrame(() => {
          if (!currentTarget.contains(document.activeElement)) dismissDeleteConfirm()
        })
      }}
    >
      <ThreadRowButton {...props} handleContextMenu={handleContextMenu} />
    </SidebarMenuSubItem>
  )
}
