import type { ChangeProvenanceRecord, GitBranchState } from '@shared/ipc'
import { ProjectFilesPanel } from './ProjectFilesPanel'
import { GitSidebarPanelView } from './GitSidebarPanelView'
import { useGitSidebarPanelModel } from './useGitSidebarPanelModel'

export type BranchState = GitBranchState
export type SidebarPanelTab = 'git' | 'files'
export type GitPanelTab = 'diff' | 'log' | 'issues' | 'prs'

export type GitSidebarProps = {
  sidebarPanelTab: SidebarPanelTab
  setSidebarPanelTab: (tab: SidebarPanelTab) => void
  gitPanelTab: GitPanelTab
  setGitPanelTab: (tab: GitPanelTab) => void
  gitPanelOutput: string
  branchState: BranchState | null
  branchQuery: string
  setBranchQuery: (query: string) => void
  activeProjectDir: string | null | undefined
  onLoadGitDiff: () => Promise<void>
  onLoadGitLog: () => Promise<void>
  onLoadGitIssues: () => Promise<void>
  onLoadGitPrs: () => Promise<void>
  gitDiffViewMode: 'split' | 'list' | 'unified'
  setGitDiffViewMode: (mode: 'split' | 'list' | 'unified') => void
  onStageAllChanges?: () => Promise<void>
  onDiscardAllChanges?: () => Promise<void>
  onStageFile?: (filePath: string) => Promise<void>
  onRestoreFile?: (filePath: string) => Promise<void>
  onUnstageFile?: (filePath: string) => Promise<void>
  fileProvenanceByPath?: Record<string, ChangeProvenanceRecord>
  onAddToChatPath: (filePath: string) => void
  onStatusChange: (message: string) => void
  onCollapse?: () => void
}

export function GitSidebarPanel(props: GitSidebarProps) {
  const {
    sidebarPanelTab,
    setSidebarPanelTab,
    gitPanelTab,
    activeProjectDir,
    onAddToChatPath,
    onStatusChange,
    gitDiffViewMode,
    setGitDiffViewMode,
    onCollapse,
  } = props
  const model = useGitSidebarPanelModel(props)

  return (
    <aside className="sidebar ops-pane">
      {sidebarPanelTab === 'git' ? (
        <GitSidebarPanelView
          model={model}
          sidebarPanelTab={sidebarPanelTab}
          setSidebarPanelTab={setSidebarPanelTab}
          gitPanelTab={gitPanelTab}
          gitDiffViewMode={gitDiffViewMode}
          setGitDiffViewMode={setGitDiffViewMode}
          onCollapse={onCollapse}
        />
      ) : null}

      {sidebarPanelTab === 'files' ? (
        <ProjectFilesPanel
          directory={activeProjectDir ?? ''}
          onAddToChatPath={onAddToChatPath}
          onStatus={onStatusChange}
        />
      ) : null}
    </aside>
  )
}
