import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useStore } from '../../store'
import { useUiStateStore } from '../../uiStateStore'
import { useChatViewCtx } from './ChatViewContext'
import { cn } from '~/lib/utils'
import {
  type RailSubagentItem,
  type SubagentStatus,
  deriveRailSubagentItems,
  hasLiveSubagent,
} from './ComposerSubagentRailCard.helpers'

function statusTone(status: SubagentStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/10 text-blue-300 border-blue-500/30'
    case 'paused':
      return 'bg-sky-500/10 text-sky-300 border-sky-500/30'
    case 'error':
      return 'bg-rose-500/10 text-rose-300 border-rose-500/30'
    default:
      return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
  }
}

function statusLabel(status: SubagentStatus): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'paused':
      return 'Paused'
    case 'error':
      return 'Error'
    default:
      return 'Ready'
  }
}

function SubagentRow({ item }: { item: RailSubagentItem }) {
  const navigate = useNavigate()
  const setParentThreadExpanded = useUiStateStore(store => store.setParentThreadExpanded)
  const summary = item.prompt ?? item.title

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start rounded-lg px-2.5 py-2 text-left"
      onClick={() => {
        setParentThreadExpanded(item.parentThreadId, true)
        void navigate({ to: '/$threadId', params: { threadId: item.threadId } })
      }}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-sm leading-5 text-foreground/85">
          <span className="font-medium text-foreground/90">{item.modelLabel}</span>
          {summary ? (
            <span className="text-muted-foreground/75">
              {' '}
              {' - '} {summary}
            </span>
          ) : null}
        </p>
        <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusTone(item.status))}>
          {statusLabel(item.status)}
        </Badge>
      </div>
    </Button>
  )
}

export function ComposerSubagentRailCard() {
  const c = useChatViewCtx()
  const threads = useStore(store => store.threads)
  const [collapsed, setCollapsed] = useState(false)

  const items = useMemo(
    () => deriveRailSubagentItems(threads, c.td.activeThread?.id ?? null),
    [c.td.activeThread?.id, threads]
  )

  if (items.length === 0 || !hasLiveSubagent(items)) {
    return null
  }

  return (
    <div className="px-3 py-2" data-testid="composer-subagent-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-1 text-left"
        onClick={() => setCollapsed(value => !value)}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
            <span className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 font-medium text-foreground/85">
              Subagents
            </span>
            <span className="truncate">{items.length} active</span>
          </div>
        </div>
        {collapsed ? (
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground/60" />
        )}
      </button>
      {!collapsed ? (
        <div className="mt-2 space-y-1">
          {items.map(item => (
            <SubagentRow key={item.threadId} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
