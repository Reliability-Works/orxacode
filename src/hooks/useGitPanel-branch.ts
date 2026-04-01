import { useCallback, useEffect, useState } from 'react'
import type { GitBranchState } from '@shared/ipc'
import {
  formatCheckoutBranchError,
  openBranchCreateDialog,
  refreshActiveGitPanel,
  validateBranchCreateCandidate,
} from './useGitPanel-utils'

type GitPanelTab = 'diff' | 'log' | 'issues' | 'prs'

function useGitPanelBranchState() {
  const [branchState, setBranchState] = useState<GitBranchState | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchQuery, setBranchQuery] = useState('')
  const [branchLoading, setBranchLoading] = useState(false)
  const [branchSwitching, setBranchSwitching] = useState(false)
  const [branchCreateModalOpen, setBranchCreateModalOpen] = useState(false)
  const [branchCreateName, setBranchCreateName] = useState('')
  const [branchCreateError, setBranchCreateError] = useState<string | null>(null)
  const [branchActionError, setBranchActionError] = useState<string | null>(null)

  return {
    branchState,
    setBranchState,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    setBranchLoading,
    branchSwitching,
    setBranchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    branchActionError,
    setBranchActionError,
  }
}

function useGitPanelBranchRefresh(
  activeProjectDir: string | null,
  setBranchLoading: (loading: boolean) => void,
  setBranchState: (state: GitBranchState | null) => void
) {
  return useCallback(async () => {
    if (!activeProjectDir) {
      setBranchState(null)
      return
    }
    try {
      setBranchLoading(true)
      setBranchState(await window.orxa.opencode.gitBranches(activeProjectDir))
    } finally {
      setBranchLoading(false)
    }
  }, [activeProjectDir, setBranchLoading, setBranchState])
}

function useGitPanelBranchCreateActions(
  branchQuery: string,
  branchCreateName: string,
  branchBranches: string[] | undefined,
  checkoutBranch: (branch: string) => Promise<void>,
  setBranchCreateName: (value: string) => void,
  setBranchCreateError: (value: string | null) => void,
  setBranchActionError: (value: string | null) => void,
  setBranchCreateModalOpen: (open: boolean) => void,
  setBranchMenuOpen: (open: boolean) => void
) {
  const openBranchCreateModal = useCallback(() => {
    openBranchCreateDialog(
      branchQuery,
      setBranchCreateName,
      setBranchCreateError,
      setBranchActionError,
      setBranchCreateModalOpen,
      setBranchMenuOpen
    )
  }, [
    branchQuery,
    setBranchActionError,
    setBranchCreateError,
    setBranchCreateModalOpen,
    setBranchCreateName,
    setBranchMenuOpen,
  ])

  const submitBranchCreate = useCallback(async () => {
    const candidate = branchCreateName.trim()
    const validationError = validateBranchCreateCandidate(candidate, branchBranches)
    if (validationError) {
      setBranchCreateError(validationError)
      return
    }
    setBranchCreateModalOpen(false)
    setBranchCreateName('')
    setBranchCreateError(null)
    await checkoutBranch(candidate)
  }, [
    branchBranches,
    branchCreateName,
    checkoutBranch,
    setBranchCreateError,
    setBranchCreateModalOpen,
    setBranchCreateName,
  ])

  return { openBranchCreateModal, submitBranchCreate }
}

function useGitPanelCheckoutBranch(
  activeProjectDir: string | null,
  gitPanelTab: GitPanelTab,
  branchState: GitBranchState | null,
  loadGitDiff: () => Promise<void>,
  loadGitLog: () => Promise<void>,
  loadGitIssues: () => Promise<void>,
  loadGitPrs: () => Promise<void>,
  setBranchActionError: (value: string | null) => void,
  setBranchMenuOpen: (open: boolean) => void,
  setBranchQuery: (value: string) => void,
  setBranchState: (state: GitBranchState | null) => void,
  setBranchSwitching: (loading: boolean) => void
) {
  return useCallback(
    async (nextBranchInput: string) => {
      if (!activeProjectDir) {
        return
      }
      const nextBranch = nextBranchInput.trim()
      if (!nextBranch || nextBranch === branchState?.current) {
        setBranchMenuOpen(false)
        return
      }
      setBranchActionError(null)
      try {
        setBranchSwitching(true)
        setBranchState(await window.orxa.opencode.gitCheckoutBranch(activeProjectDir, nextBranch))
        setBranchQuery('')
        setBranchMenuOpen(false)
        await refreshActiveGitPanel(gitPanelTab, loadGitDiff, loadGitLog, loadGitIssues, loadGitPrs)
      } catch (error) {
        setBranchActionError(formatCheckoutBranchError(error, nextBranch))
      } finally {
        setBranchSwitching(false)
      }
    },
    [
      activeProjectDir,
      branchState,
      gitPanelTab,
      loadGitDiff,
      loadGitIssues,
      loadGitLog,
      loadGitPrs,
      setBranchActionError,
      setBranchMenuOpen,
      setBranchQuery,
      setBranchState,
      setBranchSwitching,
    ]
  )
}

function useGitPanelBranchLifecycle(
  activeProjectDir: string | null,
  refreshBranchState: () => Promise<void>,
  setBranchActionError: (value: string | null) => void,
  setBranchState: (state: GitBranchState | null) => void
) {
  useEffect(() => {
    if (!activeProjectDir) {
      setBranchState(null)
      setBranchActionError(null)
      return
    }
    void refreshBranchState()
  }, [activeProjectDir, refreshBranchState, setBranchActionError, setBranchState])
}

export function useGitPanelBranch(
  activeProjectDir: string | null,
  gitPanelTab: GitPanelTab,
  loadGitDiff: () => Promise<void>,
  loadGitLog: () => Promise<void>,
  loadGitIssues: () => Promise<void>,
  loadGitPrs: () => Promise<void>
) {
  const {
    branchState,
    setBranchState,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    setBranchLoading,
    branchSwitching,
    setBranchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    branchActionError,
    setBranchActionError,
  } = useGitPanelBranchState()

  const refreshBranchState = useGitPanelBranchRefresh(
    activeProjectDir,
    setBranchLoading,
    setBranchState
  )

  const checkoutBranch = useGitPanelCheckoutBranch(
    activeProjectDir,
    gitPanelTab,
    branchState,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
    setBranchActionError,
    setBranchMenuOpen,
    setBranchQuery,
    setBranchState,
    setBranchSwitching
  )

  const { openBranchCreateModal, submitBranchCreate } = useGitPanelBranchCreateActions(
    branchQuery,
    branchCreateName,
    branchState?.branches,
    checkoutBranch,
    setBranchCreateName,
    setBranchCreateError,
    setBranchActionError,
    setBranchCreateModalOpen,
    setBranchMenuOpen
  )

  useGitPanelBranchLifecycle(
    activeProjectDir,
    refreshBranchState,
    setBranchActionError,
    setBranchState
  )

  return {
    branchState,
    setBranchState,
    refreshBranchState,
    checkoutBranch,
    openBranchCreateModal,
    submitBranchCreate,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    branchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    branchActionError,
    setBranchActionError,
  }
}
