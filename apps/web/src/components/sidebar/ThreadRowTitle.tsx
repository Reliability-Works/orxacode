import { ChevronRightIcon, GitPullRequestIcon } from 'lucide-react'
import { type ProviderKind, ThreadId } from '@orxa-code/contracts'
import { cn } from '~/lib/utils'
import { ProviderLogo } from '../session'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import type { ThreadStatusPill } from '../Sidebar.logic'
import type { SidebarThreadSnapshot, ThreadRowRenameState } from './ThreadRow'
import type { PrStatusIndicator } from './threadRowUtils'
import { useIsMobile } from '~/hooks/useMediaQuery'

function resolveThreadProvider(thread: SidebarThreadSnapshot): ProviderKind | null {
  return thread.session?.provider ?? thread.modelSelection.provider ?? null
}

export function ThreadStatusLabel({
  status,
  compact = false,
}: {
  status: NonNullable<ReturnType<typeof import('../Sidebar.logic').resolveThreadStatusPill>>
  compact?: boolean
}) {
  if (compact) {
    return (
      <span
        title={status.label}
        className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
      >
        <span
          className={`size-[9px] rounded-full ${status.dotClass} ${status.pulse ? 'animate-pulse' : ''}`}
        />
        <span className="sr-only">{status.label}</span>
      </span>
    )
  }
  return (
    <span
      title={status.label}
      className={`inline-flex items-center gap-1 text-[10px] ${status.colorClass}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.dotClass} ${status.pulse ? 'animate-pulse' : ''}`}
      />
      <span className="hidden md:inline">{status.label}</span>
    </span>
  )
}

function ThreadRowRenameInput({
  thread,
  rename,
}: {
  thread: SidebarThreadSnapshot
  rename: ThreadRowRenameState
}) {
  const isMobile = useIsMobile()
  const {
    inputRef: renameInputRef,
    committedRef: renamingCommittedRef,
    title: renamingTitle,
    onTitleChange,
    onCommit,
    onCancel,
  } = rename
  return (
    <input
      ref={el => {
        if (el && renameInputRef.current !== el) {
          renameInputRef.current = el
          el.focus()
          el.select()
        }
      }}
      className={cn(
        'min-w-0 flex-1 truncate bg-transparent outline-none border border-ring rounded px-1',
        isMobile ? 'text-sm' : 'text-xs'
      )}
      value={renamingTitle}
      onChange={e => onTitleChange(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          renamingCommittedRef.current = true
          void onCommit(thread.id, renamingTitle, thread.title)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          renamingCommittedRef.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!renamingCommittedRef.current) void onCommit(thread.id, renamingTitle, thread.title)
      }}
      onClick={e => e.stopPropagation()}
    />
  )
}

export function ThreadRowTitleContent({
  thread,
  hasChildren = false,
  childrenExpanded = false,
  prStatus,
  threadStatus,
  rename,
  onOpenPrLink,
  onToggleChildren,
}: {
  thread: SidebarThreadSnapshot
  hasChildren?: boolean
  childrenExpanded?: boolean
  prStatus: PrStatusIndicator | null
  threadStatus: ThreadStatusPill | null
  rename: ThreadRowRenameState
  onOpenPrLink: (event: React.MouseEvent<HTMLElement>, prUrl: string) => void
  onToggleChildren?: (threadId: ThreadId, expanded: boolean) => void
}) {
  const isMobile = useIsMobile()
  const provider = resolveThreadProvider(thread)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-left md:gap-1.5">
      {hasChildren ? (
        <button
          type="button"
          data-thread-selection-safe
          aria-label={childrenExpanded ? 'Collapse child threads' : 'Expand child threads'}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground md:size-4"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onToggleChildren?.(thread.id, !childrenExpanded)
          }}
        >
          <ChevronRightIcon
            className={cn(
              isMobile ? 'size-3.5 transition-transform' : 'size-3 transition-transform',
              childrenExpanded ? 'rotate-90' : ''
            )}
          />
        </button>
      ) : null}
      {provider ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/70 md:size-3.5">
          <ProviderLogo provider={provider} size={isMobile ? 16 : 14} />
        </span>
      ) : null}
      {prStatus && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={prStatus.tooltip}
                className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                onClick={event => onOpenPrLink(event, prStatus.url)}
              >
                <GitPullRequestIcon className="size-3.5 md:size-3" />
              </button>
            }
          />
          <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
        </Tooltip>
      )}
      {threadStatus && <ThreadStatusLabel status={threadStatus} />}
      {rename.isRenaming ? (
        <ThreadRowRenameInput thread={thread} rename={rename} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm md:text-xs">{thread.title}</span>
      )}
    </div>
  )
}
