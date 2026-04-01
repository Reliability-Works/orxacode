import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useGitPanelBranch } from './useGitPanel-branch'
import { useGitPanelCommit } from './useGitPanel-commit'
import { usePersistedState } from './usePersistedState'
import {
  EMPTY_GIT_DIFF_STATS,
  formatError,
  parseGitDiffStats,
} from './useGitPanel-utils'

type GitPanelTab = 'diff' | 'log' | 'issues' | 'prs'
export type GitDiffViewMode = 'list' | 'unified' | 'split'
export type GitDiffStats = {
  additions: number
  deletions: number
  filesChanged: number
  hasChanges: boolean
}

const GIT_DIFF_VIEW_MODE_KEY = 'orxa:gitDiffViewMode:v1'

const isValidGitDiffViewMode = (raw: string): raw is GitDiffViewMode =>
  raw === 'list' || raw === 'unified' || raw === 'split'

function useGitPanelContentLoader(
  activeProjectDir: string | null,
  tab: Exclude<GitPanelTab, 'diff'>,
  loadingMessage: string,
  run: (directory: string) => Promise<string>,
  setGitPanelTab: (tab: GitPanelTab) => void,
  setGitPanelOutput: Dispatch<SetStateAction<string>>,
  setLoading: (loading: boolean) => void
) {
  return useCallback(async () => {
    if (!activeProjectDir) {
      return
    }
    setGitPanelTab(tab)
    setGitPanelOutput(loadingMessage)
    try {
      setLoading(true)
      setGitPanelOutput(await run(activeProjectDir))
    } catch (error) {
      setGitPanelOutput(formatError(error))
    } finally {
      setLoading(false)
    }
  }, [activeProjectDir, loadingMessage, run, setGitPanelOutput, setGitPanelTab, setLoading, tab])
}

function useGitPanelDiffLoaders(
  activeProjectDir: string | null,
  setGitPanelTab: (tab: GitPanelTab) => void,
  setGitPanelOutput: Dispatch<SetStateAction<string>>,
  setGitDiffStats: (stats: GitDiffStats) => void,
  setGitDiffLoading: (loading: boolean) => void,
  setGitLogLoading: (loading: boolean) => void,
  setGitIssuesLoading: (loading: boolean) => void,
  setGitPrsLoading: (loading: boolean) => void
) {
  const runGitLog = useCallback(
    (directory: string) => window.orxa.opencode.gitLog(directory),
    []
  )
  const runGitIssues = useCallback(
    (directory: string) => window.orxa.opencode.gitIssues(directory),
    []
  )
  const runGitPrs = useCallback(
    (directory: string) => window.orxa.opencode.gitPrs(directory),
    []
  )

  const silentRefreshDiff = useCallback(async () => {
    if (!activeProjectDir) return
    try {
      const output = await window.orxa.opencode.gitDiff(activeProjectDir)
      setGitPanelOutput(output)
      setGitDiffStats(parseGitDiffStats(output))
    } catch {
      // ignore to avoid overwriting existing content on transient errors
    }
  }, [activeProjectDir, setGitDiffStats, setGitPanelOutput])

  const refreshGitDiffStats = useCallback(async () => {
    if (!activeProjectDir) {
      setGitDiffStats(EMPTY_GIT_DIFF_STATS)
      return
    }
    try {
      const output = await window.orxa.opencode.gitDiff(activeProjectDir)
      setGitDiffStats(parseGitDiffStats(output))
    } catch {
      setGitDiffStats(EMPTY_GIT_DIFF_STATS)
    }
  }, [activeProjectDir, setGitDiffStats])

  const loadGitDiff = useCallback(async () => {
    if (!activeProjectDir) {
      return
    }
    setGitPanelTab('diff')
    setGitPanelOutput('Loading diff...')
    try {
      setGitDiffLoading(true)
      const output = await window.orxa.opencode.gitDiff(activeProjectDir)
      setGitPanelOutput(output)
      setGitDiffStats(parseGitDiffStats(output))
    } catch (error) {
      setGitPanelOutput(formatError(error))
      setGitDiffStats(EMPTY_GIT_DIFF_STATS)
    } finally {
      setGitDiffLoading(false)
    }
  }, [activeProjectDir, setGitDiffLoading, setGitDiffStats, setGitPanelOutput, setGitPanelTab])

  const loadGitLog = useGitPanelContentLoader(
    activeProjectDir,
    'log',
    'Loading log...',
    runGitLog,
    setGitPanelTab,
    setGitPanelOutput,
    setGitLogLoading
  )

  const loadGitIssues = useGitPanelContentLoader(
    activeProjectDir,
    'issues',
    'Loading issues...',
    runGitIssues,
    setGitPanelTab,
    setGitPanelOutput,
    setGitIssuesLoading
  )

  const loadGitPrs = useGitPanelContentLoader(
    activeProjectDir,
    'prs',
    'Loading pull requests...',
    runGitPrs,
    setGitPanelTab,
    setGitPanelOutput,
    setGitPrsLoading
  )

  return {
    silentRefreshDiff,
    refreshGitDiffStats,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
  }
}

function useGitPanelDiffLifecycle(
  activeProjectDir: string | null,
  gitPanelTab: GitPanelTab,
  silentRefreshDiff: () => Promise<void>,
  refreshGitDiffStats: () => Promise<void>,
  setGitPanelTab: (tab: GitPanelTab) => void,
  setGitPanelOutput: (output: string) => void,
  setGitDiffStats: (stats: GitDiffStats) => void
) {
  const gitRefreshTimerRef = useRef<number | undefined>(undefined)

  const scheduleGitRefresh = useCallback(
    (delayMs = 420) => {
      if (!activeProjectDir) {
        return
      }
      if (gitRefreshTimerRef.current) {
        window.clearTimeout(gitRefreshTimerRef.current)
      }
      gitRefreshTimerRef.current = window.setTimeout(
        () => {
          gitRefreshTimerRef.current = undefined
          if (gitPanelTab === 'diff') {
            void silentRefreshDiff()
          } else {
            void refreshGitDiffStats()
          }
        },
        Math.max(120, delayMs)
      )
    },
    [activeProjectDir, gitPanelTab, refreshGitDiffStats, silentRefreshDiff]
  )

  useEffect(() => {
    if (!activeProjectDir) {
      setGitPanelTab('diff')
      setGitPanelOutput('Select DIFF or LOG.')
      setGitDiffStats(EMPTY_GIT_DIFF_STATS)
      return
    }
    void refreshGitDiffStats()
  }, [activeProjectDir, refreshGitDiffStats, setGitDiffStats, setGitPanelOutput, setGitPanelTab])

  useEffect(() => {
    if (!activeProjectDir) return
    const interval = setInterval(() => {
      void silentRefreshDiff()
    }, 8000)
    return () => clearInterval(interval)
  }, [activeProjectDir, silentRefreshDiff])

  useEffect(() => {
    return () => {
      if (gitRefreshTimerRef.current) {
        window.clearTimeout(gitRefreshTimerRef.current)
      }
    }
  }, [])

  return { scheduleGitRefresh }
}

function useGitPanelDiff(activeProjectDir: string | null) {
  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>('diff')
  const [gitDiffViewMode, setGitDiffViewMode] = usePersistedState<GitDiffViewMode>(
    GIT_DIFF_VIEW_MODE_KEY,
    'list',
    {
      deserialize: raw => {
        if (isValidGitDiffViewMode(raw)) {
          return raw
        }
        return 'list'
      },
      serialize: value => value,
    }
  )
  const [gitPanelOutput, setGitPanelOutput] = useState('Select DIFF or LOG.')
  const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats>({
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    hasChanges: false,
  })
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [gitLogLoading, setGitLogLoading] = useState(false)
  const [gitIssuesLoading, setGitIssuesLoading] = useState(false)
  const [gitPrsLoading, setGitPrsLoading] = useState(false)
  const {
    silentRefreshDiff,
    refreshGitDiffStats,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
  } = useGitPanelDiffLoaders(
    activeProjectDir,
    setGitPanelTab,
    setGitPanelOutput,
    setGitDiffStats,
    setGitDiffLoading,
    setGitLogLoading,
    setGitIssuesLoading,
    setGitPrsLoading
  )
  const { scheduleGitRefresh } = useGitPanelDiffLifecycle(
    activeProjectDir,
    gitPanelTab,
    silentRefreshDiff,
    refreshGitDiffStats,
    setGitPanelTab,
    setGitPanelOutput,
    setGitDiffStats
  )

  return {
    gitPanelTab,
    setGitPanelTab,
    gitDiffViewMode,
    setGitDiffViewMode,
    gitPanelOutput,
    setGitPanelOutput,
    gitDiffStats,
    gitDiffLoading,
    gitLogLoading,
    gitIssuesLoading,
    gitPrsLoading,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
    refreshGitDiffStats,
    silentRefreshDiff,
    scheduleGitRefresh,
  }
}

export function useGitPanel(activeProjectDir: string | null) {
  const diff = useGitPanelDiff(activeProjectDir)
  const { loadGitDiff } = diff
  const branch = useGitPanelBranch(
    activeProjectDir,
    diff.gitPanelTab,
    loadGitDiff,
    diff.loadGitLog,
    diff.loadGitIssues,
    diff.loadGitPrs
  )
  const commit = useGitPanelCommit(activeProjectDir, branch.branchState, branch.refreshBranchState)

  const stageAllChanges = useCallback(async () => {
    if (!activeProjectDir) {
      return
    }
    await window.orxa.opencode.gitStageAll(activeProjectDir)
    await loadGitDiff()
  }, [activeProjectDir, loadGitDiff])

  const discardAllChanges = useCallback(async () => {
    if (!activeProjectDir) {
      return
    }
    await window.orxa.opencode.gitRestoreAllUnstaged(activeProjectDir)
    await loadGitDiff()
  }, [activeProjectDir, loadGitDiff])

  const stageFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return
      }
      await window.orxa.opencode.gitStagePath(activeProjectDir, filePath)
      await loadGitDiff()
    },
    [activeProjectDir, loadGitDiff]
  )

  const restoreFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return
      }
      await window.orxa.opencode.gitRestorePath(activeProjectDir, filePath)
      await loadGitDiff()
    },
    [activeProjectDir, loadGitDiff]
  )

  const unstageFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return
      }
      await window.orxa.opencode.gitUnstagePath(activeProjectDir, filePath)
      await loadGitDiff()
    },
    [activeProjectDir, loadGitDiff]
  )

  return {
    ...diff,
    ...branch,
    ...commit,
    stageAllChanges,
    discardAllChanges,
    stageFile,
    restoreFile,
    unstageFile,
  }
}
