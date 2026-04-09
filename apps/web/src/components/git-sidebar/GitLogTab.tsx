import type { GitGetLogResult, GitLogEntry } from '@orxa-code/contracts'
import type { ReactNode } from 'react'

import { Skeleton } from '../ui/skeleton'

function relativeDate(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function LogEntryRow({ entry }: { entry: GitLogEntry }) {
  return (
    <div className="flex min-w-0 items-start gap-2 border-b border-border/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{entry.subject}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {entry.author} · {entry.shortHash}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground/60">
        {relativeDate(entry.date)}
      </span>
    </div>
  )
}

export interface GitLogTabProps {
  data: GitGetLogResult | undefined
  isPending: boolean
}

export function GitLogTab({ data, isPending }: GitLogTabProps): ReactNode {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded" />
        ))}
      </div>
    )
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">No commits found.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {data.entries.map(entry => (
        <LogEntryRow key={entry.hash} entry={entry} />
      ))}
    </div>
  )
}
