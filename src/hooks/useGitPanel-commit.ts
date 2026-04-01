import { useCallback, useEffect, useState } from 'react'
import type { GitBranchState } from '@shared/ipc'
import { pickDefaultBaseBranch } from './useGitPanel-utils'

export type CommitNextStep = 'commit' | 'commit_and_push' | 'commit_and_create_pr'

type CommitSummary = {
  branch: string
  filesChanged: number
  insertions: number
  deletions: number
  repoRoot: string
}

export function useGitPanelCommit(
  activeProjectDir: string | null,
  branchState: GitBranchState | null,
  refreshBranchState: () => Promise<void>
) {
  const [commitModalOpen, setCommitModalOpen] = useState(false)
  const [commitIncludeUnstaged, setCommitIncludeUnstaged] = useState(true)
  const [commitMessageDraft, setCommitMessageDraft] = useState('')
  const [commitNextStep, setCommitNextStep] = useState<CommitNextStep>('commit')
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(null)
  const [commitSummaryLoading, setCommitSummaryLoading] = useState(false)
  const [commitSubmitting, setCommitSubmitting] = useState(false)
  const [commitBaseBranch, setCommitBaseBranch] = useState('')

  const commitBaseBranchOptions = (() => {
    if (!branchState) {
      return []
    }
    const current = commitSummary?.branch ?? branchState.current
    return branchState.branches.filter(branch => branch !== current)
  })()

  const loadCommitSummary = useCallback(
    async (includeUnstaged: boolean) => {
      if (!activeProjectDir) {
        return
      }
      try {
        setCommitSummaryLoading(true)
        const summary = await window.orxa.opencode.gitCommitSummary(
          activeProjectDir,
          includeUnstaged
        )
        setCommitSummary(summary)
      } finally {
        setCommitSummaryLoading(false)
      }
    },
    [activeProjectDir]
  )

  useEffect(() => {
    if (!commitModalOpen || !activeProjectDir) {
      return
    }
    void loadCommitSummary(commitIncludeUnstaged)
    void refreshBranchState()
  }, [
    activeProjectDir,
    commitIncludeUnstaged,
    commitModalOpen,
    loadCommitSummary,
    refreshBranchState,
  ])

  useEffect(() => {
    if (!commitModalOpen) {
      return
    }
    setCommitBaseBranch(current => pickDefaultBaseBranch(commitBaseBranchOptions, current))
  }, [commitBaseBranchOptions, commitModalOpen])

  return {
    commitModalOpen,
    setCommitModalOpen,
    commitIncludeUnstaged,
    setCommitIncludeUnstaged,
    commitMessageDraft,
    setCommitMessageDraft,
    commitNextStep,
    setCommitNextStep,
    commitSummary,
    setCommitSummary,
    commitSummaryLoading,
    commitSubmitting,
    setCommitSubmitting,
    commitBaseBranch,
    setCommitBaseBranch,
    commitBaseBranchOptions,
    loadCommitSummary,
  }
}
