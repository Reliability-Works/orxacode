import { useQuery } from '@tanstack/react-query'
import { GitBranchIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { GitDiffResult } from '@orxa-code/contracts'
import {
  gitPanelIssuesQueryOptions,
  gitPanelLogQueryOptions,
  gitPanelPullRequestsQueryOptions,
} from '../../lib/gitReactQuery'
import { Button } from '../ui/button'
import { cn } from '~/lib/utils'
import { GitDiffTab } from './GitDiffTab'
import { GitLogTab } from './GitLogTab'
import { GitTextTab } from './GitTextTab'

type GitSidebarTab = 'diff' | 'log' | 'issues' | 'prs'

const TABS: Array<{ id: GitSidebarTab; label: string }> = [
  { id: 'diff', label: 'Diff' },
  { id: 'log', label: 'Log' },
  { id: 'issues', label: 'Issues' },
  { id: 'prs', label: 'PRs' },
]

function TabBar({
  active,
  onChange,
}: {
  active: GitSidebarTab
  onChange: (tab: GitSidebarTab) => void
}) {
  return (
    <div className="flex gap-0.5">
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            active === tab.id
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function useGitSidebarQueries(cwd: string, activeTab: GitSidebarTab) {
  const logQuery = useQuery(gitPanelLogQueryOptions(activeTab === 'log' ? cwd : null))
  const issuesQuery = useQuery(gitPanelIssuesQueryOptions(activeTab === 'issues' ? cwd : null))
  const prsQuery = useQuery(gitPanelPullRequestsQueryOptions(activeTab === 'prs' ? cwd : null))
  return { logQuery, issuesQuery, prsQuery }
}

function GitSidebarHeader({
  activeTab,
  onTabChange,
  isRefreshing,
  onRefresh,
  onClose,
}: {
  activeTab: GitSidebarTab
  onTabChange: (t: GitSidebarTab) => void
  isRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <TabBar active={activeTab} onChange={onTabChange} />
      <div className="ms-auto flex items-center gap-0.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh"
          className="h-6 w-6 p-0"
        >
          <RefreshCwIcon className={cn('size-3', isRefreshing && 'animate-spin')} />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={onClose}
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
  diffQueryResult: {
    data: GitDiffResult | undefined
    isPending: boolean
    isFetching: boolean
    refetch: () => unknown
  }
  onClose: () => void
}

export function GitSidebar({ cwd, diffQueryResult, onClose }: GitSidebarProps): ReactNode {
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
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background">
      <GitSidebarHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'diff' && (
          <GitDiffTab
            cwd={cwd}
            data={diffQueryResult.data}
            isPending={diffQueryResult.isPending}
            onRefresh={() => void diffQueryResult.refetch()}
          />
        )}
        {activeTab === 'log' && <GitLogTab data={logQuery.data} isPending={logQuery.isPending} />}
        {activeTab === 'issues' && (
          <GitTextTab
            data={issuesQuery.data}
            isPending={issuesQuery.isPending}
            isError={issuesQuery.isError}
            emptyMessage="No open issues found."
          />
        )}
        {activeTab === 'prs' && (
          <GitTextTab
            data={prsQuery.data}
            isPending={prsQuery.isPending}
            isError={prsQuery.isError}
            emptyMessage="No open pull requests found."
          />
        )}
      </div>
    </div>
  )
}
