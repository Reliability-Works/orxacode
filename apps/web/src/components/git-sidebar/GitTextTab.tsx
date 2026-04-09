import type {
  GitGetIssuesResult,
  GitGetPullRequestsResult,
  GitIssueEntry,
  GitPullRequestListEntry,
} from '@orxa-code/contracts'
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

function StatePill(props: { label: string; tone: 'neutral' | 'success' | 'accent' }) {
  return (
    <span
      className={
        props.tone === 'success'
          ? 'rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success'
          : props.tone === 'accent'
            ? 'rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground'
            : 'rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'
      }
    >
      {props.label}
    </span>
  )
}

function IssueCard({ entry }: { entry: GitIssueEntry }) {
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-3 transition-colors hover:bg-accent/30"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">#{entry.number}</p>
          <p className="mt-0.5 text-sm leading-5 text-foreground">{entry.title}</p>
        </div>
        <StatePill label={entry.state} tone={entry.state === 'OPEN' ? 'success' : 'neutral'} />
      </div>
      <div className="flex flex-wrap gap-1">
        {(entry.labels ?? []).slice(0, 4).map(label => (
          <span
            key={`${entry.number}:${label.name}`}
            className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {label.name}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {entry.author?.login ?? 'unknown'} updated {relativeDate(entry.updatedAt)}
      </p>
    </a>
  )
}

function PullRequestCard({ entry }: { entry: GitPullRequestListEntry }) {
  const stateLabel = entry.isDraft ? 'Draft' : entry.state

  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noreferrer"
      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-3 transition-colors hover:bg-accent/30"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">#{entry.number}</p>
          <p className="mt-0.5 text-sm leading-5 text-foreground">{entry.title}</p>
        </div>
        <StatePill
          label={stateLabel}
          tone={entry.isDraft ? 'accent' : entry.state === 'OPEN' ? 'success' : 'neutral'}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
          {entry.headRefName}
        </span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
          into {entry.baseRefName}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {entry.author?.login ?? 'unknown'} updated {relativeDate(entry.updatedAt)}
      </p>
    </a>
  )
}

export function GitSidebarSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  )
}

export interface GitTextTabProps {
  data: GitGetIssuesResult | GitGetPullRequestsResult | undefined
  isPending: boolean
  emptyMessage: string
  isError?: boolean | undefined
  errorMessage?: string | undefined
  variant: 'issues' | 'prs'
}

export function GitTextTab(props: GitTextTabProps): ReactNode {
  if (props.isPending) {
    return <GitSidebarSkeleton />
  }

  if (props.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-60 text-center text-xs text-muted-foreground">
          {props.errorMessage ??
            'GitHub CLI unavailable. Run `gh auth login` to enable issue and pull request views.'}
        </p>
      </div>
    )
  }

  const entries = props.data?.entries ?? []
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">{props.emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-3">
      {props.variant === 'issues'
        ? (entries as GitIssueEntry[]).map(entry => <IssueCard key={entry.url} entry={entry} />)
        : (entries as GitPullRequestListEntry[]).map(entry => (
            <PullRequestCard key={entry.url} entry={entry} />
          ))}
    </div>
  )
}
