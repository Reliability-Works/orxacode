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
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-3">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{entry.shortHash}</p>
          <p className="mt-0.5 text-sm leading-5 text-foreground">{entry.subject}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground/80">
          {relativeDate(entry.date)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {entry.author} · {entry.email || 'unknown author'}
      </p>
      {entry.body.trim() ? (
        <p className="line-clamp-3 text-[11px] leading-5 text-muted-foreground">{entry.body}</p>
      ) : null}
    </div>
  )
}

export interface GitLogTabProps {
  data: GitGetLogResult | undefined
  isPending: boolean
  isError?: boolean | undefined
  errorMessage?: string | undefined
}

export function GitLogTab({ data, isPending, isError, errorMessage }: GitLogTabProps): ReactNode {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-60 text-center text-xs text-muted-foreground">
          {errorMessage ?? 'Git log unavailable for this repository.'}
        </p>
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
    <div className="flex flex-col gap-2 overflow-y-auto p-3">
      {data.entries.map(entry => (
        <LogEntryRow key={entry.hash} entry={entry} />
      ))}
    </div>
  )
}
