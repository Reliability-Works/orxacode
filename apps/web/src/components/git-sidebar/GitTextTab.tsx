import type {
  GitGetIssuesResult,
  GitGetPullRequestsResult,
  GitIssueEntry,
  GitPullRequestListEntry,
} from '@orxa-code/contracts'
import type { ReactNode } from 'react'

import {
  GitSidebarCenteredMessage,
  GitSidebarLinkedCard,
  GitSidebarSkeletonList,
} from './GitSidebar.shared'
import { relativeDate } from './GitSidebar.logic'

function StatePill(props: { label: string; tone: 'neutral' | 'success' | 'accent' }) {
  return (
    <span
      className={
        props.tone === 'success'
          ? 'rounded-full bg-success/10 px-2 py-0.5 text-mini font-medium text-success'
          : props.tone === 'accent'
            ? 'rounded-full bg-accent px-2 py-0.5 text-mini font-medium text-foreground'
            : 'rounded-full bg-muted px-2 py-0.5 text-mini font-medium text-muted-foreground'
      }
    >
      {props.label}
    </span>
  )
}

function TextTabEntryCard(props: {
  href: string
  number: number
  title: string
  stateLabel: string
  stateTone: 'neutral' | 'success' | 'accent'
  meta: ReactNode
  footerLogin: string | null | undefined
  footerUpdatedAt: string
}) {
  return (
    <GitSidebarLinkedCard
      href={props.href}
      header={
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">#{props.number}</p>
            <p className="mt-0.5 text-sm leading-5 text-foreground">{props.title}</p>
          </div>
          <StatePill label={props.stateLabel} tone={props.stateTone} />
        </div>
      }
      meta={props.meta}
      footer={
        <p className="text-caption text-muted-foreground">
          {props.footerLogin ?? 'unknown'} updated {relativeDate(props.footerUpdatedAt)}
        </p>
      }
    />
  )
}

function IssueCard({ entry }: { entry: GitIssueEntry }) {
  return (
    <TextTabEntryCard
      href={entry.url}
      number={entry.number}
      title={entry.title}
      stateLabel={entry.state}
      stateTone={entry.state === 'OPEN' ? 'success' : 'neutral'}
      meta={
        <div className="flex flex-wrap gap-1">
          {(entry.labels ?? []).slice(0, 4).map(label => (
            <span
              key={`${entry.number}:${label.name}`}
              className="rounded-full border border-border/70 px-2 py-0.5 text-mini text-muted-foreground"
            >
              {label.name}
            </span>
          ))}
        </div>
      }
      footerLogin={entry.author?.login}
      footerUpdatedAt={entry.updatedAt}
    />
  )
}

function PullRequestCard({ entry }: { entry: GitPullRequestListEntry }) {
  const stateLabel = entry.isDraft ? 'Draft' : entry.state

  return (
    <TextTabEntryCard
      href={entry.url}
      number={entry.number}
      title={entry.title}
      stateLabel={stateLabel}
      stateTone={entry.isDraft ? 'accent' : entry.state === 'OPEN' ? 'success' : 'neutral'}
      meta={
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-mini text-muted-foreground">
            {entry.headRefName}
          </span>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-mini text-muted-foreground">
            into {entry.baseRefName}
          </span>
        </div>
      }
      footerLogin={entry.author?.login}
      footerUpdatedAt={entry.updatedAt}
    />
  )
}

export function GitSidebarSkeleton() {
  return <GitSidebarSkeletonList rows={5} itemClassName="h-16 rounded-xl" />
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
      <GitSidebarCenteredMessage>
        <p className="max-w-60 text-center text-xs text-muted-foreground">
          {props.errorMessage ??
            'GitHub CLI unavailable. Run `gh auth login` to enable issue and pull request views.'}
        </p>
      </GitSidebarCenteredMessage>
    )
  }

  const entries = props.data?.entries ?? []
  if (entries.length === 0) {
    return (
      <GitSidebarCenteredMessage>
        <p className="text-xs text-muted-foreground">{props.emptyMessage}</p>
      </GitSidebarCenteredMessage>
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
