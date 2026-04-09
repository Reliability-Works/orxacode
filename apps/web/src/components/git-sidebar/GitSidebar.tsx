import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, GitBranchIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { GitDiffResult } from '@orxa-code/contracts'
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

function GitSidebarHeader(props: {
  activeTab: GitSidebarTab
  onTabChange: (tab: GitSidebarTab) => void
  isRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <GitSidebarViewPicker activeTab={props.activeTab} onTabChange={props.onTabChange} />
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
    <div className="flex h-full w-full min-w-0 shrink-0 flex-col border-l border-border bg-background">
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
        {activeTab === 'log' && (
          <GitLogTab
            data={logQuery.data}
            isPending={logQuery.isPending}
            isError={logQuery.isError}
            errorMessage={logQuery.error instanceof Error ? logQuery.error.message : undefined}
          />
        )}
        {activeTab === 'issues' && (
          <GitTextTab
            data={issuesQuery.data}
            isPending={issuesQuery.isPending}
            isError={issuesQuery.isError}
            errorMessage={
              issuesQuery.error instanceof Error ? issuesQuery.error.message : undefined
            }
            emptyMessage="No open issues found."
            variant="issues"
          />
        )}
        {activeTab === 'prs' && (
          <GitTextTab
            data={prsQuery.data}
            isPending={prsQuery.isPending}
            isError={prsQuery.isError}
            errorMessage={prsQuery.error instanceof Error ? prsQuery.error.message : undefined}
            emptyMessage="No open pull requests found."
            variant="prs"
          />
        )}
      </div>
    </div>
  )
}
