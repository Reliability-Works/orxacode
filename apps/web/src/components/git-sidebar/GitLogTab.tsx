import type { GitGetLogResult, GitLogEntry } from '@orxa-code/contracts'
import type { ReactNode } from 'react'

import { GitSidebarCenteredMessage, GitSidebarSkeletonList } from './GitSidebar.shared'
import { relativeDate } from './GitSidebar.logic'

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
    return <GitSidebarSkeletonList rows={8} itemClassName="h-10 rounded" />
  }

  if (isError) {
    return (
      <GitSidebarCenteredMessage>
        <p className="max-w-60 text-center text-xs text-muted-foreground">
          {errorMessage ?? 'Git log unavailable for this repository.'}
        </p>
      </GitSidebarCenteredMessage>
    )
  }

  if (!data || data.entries.length === 0) {
    return (
      <GitSidebarCenteredMessage>
        <p className="text-xs text-muted-foreground">No commits found.</p>
      </GitSidebarCenteredMessage>
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
