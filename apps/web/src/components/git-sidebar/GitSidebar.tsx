import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronDownIcon, GitBranchIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { GitDiffResult, GitDiffScopeKind } from '@orxa-code/contracts'
import {
  gitPanelIssuesQueryOptions,
  gitPanelLogQueryOptions,
  gitPanelPullRequestsQueryOptions,
} from '../../lib/gitReactQuery'
import { Button } from '../ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'
import { cn } from '~/lib/utils'
import { GitDiffTab } from './GitDiffTab'
import { GitLogTab } from './GitLogTab'
import { GitTextTab } from './GitTextTab'

export type GitSidebarTab = 'diff' | 'log' | 'issues' | 'prs'

const TABS: Array<{ id: GitSidebarTab; label: string }> = [
  { id: 'diff', label: 'Diff' },
  { id: 'log', label: 'Log' },
  { id: 'issues', label: 'Issues' },
  { id: 'prs', label: 'PRs' },
]

const FALLBACK_SCOPE_OPTIONS: Array<{ scope: GitDiffScopeKind; label: string }> = [
  { scope: 'unstaged', label: 'Unstaged' },
  { scope: 'staged', label: 'Staged' },
  { scope: 'branch', label: 'Branch' },
]

function GitSidebarViewPicker(props: {
  activeTab: GitSidebarTab
  onTabChange: (tab: GitSidebarTab) => void
}) {
  const activeLabel = TABS.find(tab => tab.id === props.activeTab)?.label ?? 'Diff'

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="h-7 rounded-full px-2.5 text-xs font-medium"
          />
        }
      >
        <span>{activeLabel}</span>
        <ChevronDownIcon className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-32">
        {TABS.map(tab => (
          <MenuItem key={tab.id} onClick={() => props.onTabChange(tab.id)}>
            {tab.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

function useGitSidebarQueries(cwd: string, activeTab: GitSidebarTab) {
  const logQuery = useQuery(gitPanelLogQueryOptions(activeTab === 'log' ? cwd : null))
  const issuesQuery = useQuery(gitPanelIssuesQueryOptions(activeTab === 'issues' ? cwd : null))
  const prsQuery = useQuery(gitPanelPullRequestsQueryOptions(activeTab === 'prs' ? cwd : null))
  return { logQuery, issuesQuery, prsQuery }
}

function GitSidebarScopePicker(props: {
  diffData: GitDiffResult | undefined
  scope: GitDiffScopeKind
  onScopeChange: (scope: GitDiffScopeKind) => void
}) {
  const activeSummary =
    props.diffData?.scopeSummaries.find(summary => summary.scope === props.scope) ?? null
  const activeLabel =
    activeSummary?.label ??
    FALLBACK_SCOPE_OPTIONS.find(option => option.scope === props.scope)?.label ??
    'Unstaged'
  const scopeOptions =
    props.diffData?.scopeSummaries.length && props.diffData.scopeSummaries.length > 0
      ? props.diffData.scopeSummaries
      : FALLBACK_SCOPE_OPTIONS.map(option => ({
          scope: option.scope,
          label: option.label,
          available: option.scope !== 'branch',
          additions: 0,
          deletions: 0,
          fileCount: 0,
          baseRef: null,
          compareLabel: null,
        }))
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="h-7 rounded-full px-2.5 text-xs font-medium"
          />
        }
      >
        <span>{activeLabel}</span>
        {activeSummary ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-mini leading-none text-muted-foreground">
            {activeSummary.fileCount}
          </span>
        ) : null}
        <ChevronDownIcon className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="min-w-44">
        {scopeOptions.map(summary => (
          <MenuItem key={summary.scope} onClick={() => props.onScopeChange(summary.scope)}>
            <CheckIcon
              className={cn('size-4', props.scope === summary.scope ? 'opacity-100' : 'opacity-0')}
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span>{summary.label}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-mini leading-none text-muted-foreground">
                {summary.fileCount}
              </span>
              {summary.compareLabel ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {summary.compareLabel}
                </span>
              ) : null}
            </div>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

function GitSidebarHeader(props: {
  activeTab: GitSidebarTab
  onTabChange: (tab: GitSidebarTab) => void
  diffData: GitDiffResult | undefined
  diffScope: GitDiffScopeKind
  onDiffScopeChange: (scope: GitDiffScopeKind) => void
  isRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <GitSidebarViewPicker activeTab={props.activeTab} onTabChange={props.onTabChange} />
      {props.activeTab === 'diff' ? (
        <GitSidebarScopePicker
          diffData={props.diffData}
          scope={props.diffScope}
          onScopeChange={props.onDiffScopeChange}
        />
      ) : null}
      <div className="ms-auto flex items-center gap-0.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label="Refresh"
          className="h-6 w-6 p-0"
        >
          <RefreshCwIcon className={cn('size-3', props.isRefreshing && 'animate-spin')} />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close git sidebar"
          className="h-6 w-6 p-0"
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export interface GitSidebarProps {
  cwd: string
  diffScope: GitDiffScopeKind
  diffQueryResult: {
    data: GitDiffResult | undefined
    isPending: boolean
    isFetching: boolean
    isError: boolean
    error: unknown
    refetch: () => unknown
  }
  onDiffScopeChange: (scope: GitDiffScopeKind) => void
  onClose: () => void
}

function GitSidebarContent(props: {
  activeTab: GitSidebarTab
  cwd: string
  diffScope: GitDiffScopeKind
  diffQueryResult: GitSidebarProps['diffQueryResult']
  logQuery: ReturnType<typeof useGitSidebarQueries>['logQuery']
  issuesQuery: ReturnType<typeof useGitSidebarQueries>['issuesQuery']
  prsQuery: ReturnType<typeof useGitSidebarQueries>['prsQuery']
}) {
  if (props.activeTab === 'diff') {
    return (
      <GitDiffTab
        cwd={props.cwd}
        data={props.diffQueryResult.data}
        scope={props.diffScope}
        isPending={props.diffQueryResult.isPending}
        isError={props.diffQueryResult.isError}
        {...(props.diffQueryResult.error instanceof Error
          ? { errorMessage: props.diffQueryResult.error.message }
          : {})}
        onRefresh={() => void props.diffQueryResult.refetch()}
      />
    )
  }
  if (props.activeTab === 'log') {
    return (
      <GitLogTab
        data={props.logQuery.data}
        isPending={props.logQuery.isPending}
        isError={props.logQuery.isError}
        errorMessage={
          props.logQuery.error instanceof Error ? props.logQuery.error.message : undefined
        }
      />
    )
  }
  if (props.activeTab === 'issues') {
    return (
      <GitTextTab
        data={props.issuesQuery.data}
        isPending={props.issuesQuery.isPending}
        isError={props.issuesQuery.isError}
        errorMessage={
          props.issuesQuery.error instanceof Error ? props.issuesQuery.error.message : undefined
        }
        emptyMessage="No open issues found."
        variant="issues"
      />
    )
  }
  return (
    <GitTextTab
      data={props.prsQuery.data}
      isPending={props.prsQuery.isPending}
      isError={props.prsQuery.isError}
      errorMessage={
        props.prsQuery.error instanceof Error ? props.prsQuery.error.message : undefined
      }
      emptyMessage="No open pull requests found."
      variant="prs"
    />
  )
}

export function GitSidebar({
  cwd,
  diffScope,
  diffQueryResult,
  onDiffScopeChange,
  onClose,
}: GitSidebarProps): ReactNode {
  const [activeTab, setActiveTab] = useState<GitSidebarTab>('diff')
  const { logQuery, issuesQuery, prsQuery } = useGitSidebarQueries(cwd, activeTab)

  const isRefreshing =
    activeTab === 'diff'
      ? diffQueryResult.isFetching
      : activeTab === 'log'
        ? logQuery.isFetching
        : activeTab === 'issues'
          ? issuesQuery.isFetching
          : prsQuery.isFetching

  const handleRefresh = () => {
    if (activeTab === 'diff') void diffQueryResult.refetch()
    else if (activeTab === 'log') void logQuery.refetch()
    else if (activeTab === 'issues') void issuesQuery.refetch()
    else void prsQuery.refetch()
  }

  return (
    <div className="flex h-full w-full min-w-0 shrink-0 flex-col border-l border-border bg-background">
      <GitSidebarHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        diffData={diffQueryResult.data}
        diffScope={diffScope}
        onDiffScopeChange={onDiffScopeChange}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <GitSidebarContent
          activeTab={activeTab}
          cwd={cwd}
          diffScope={diffScope}
          diffQueryResult={diffQueryResult}
          logQuery={logQuery}
          issuesQuery={issuesQuery}
          prsQuery={prsQuery}
        />
      </div>
    </div>
  )
}
