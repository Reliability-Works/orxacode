import type { ChangeProvenanceRecord, GitBranchState } from '@shared/ipc'
import { ProjectFilesPanel } from './ProjectFilesPanel'
import { GitSidebarPanel } from './GitSidebarPanel'

import type { GitDiffViewMode } from '../hooks/useGitPanel'

export type BranchState = GitBranchState

type SidebarPanelTab = 'git' | 'files'
type GitPanelTab = 'diff' | 'log' | 'issues' | 'prs'

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
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
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

export function GitSidebar({
  sidebarPanelTab,
  activeProjectDir,
  onAddToChatPath,
  onStatusChange,
  ...props
}: GitSidebarProps) {
  return (
    <aside className="sidebar ops-pane">
      {sidebarPanelTab === 'git' ? (
        <GitSidebarPanel
          sidebarPanelTab={sidebarPanelTab}
          {...props}
          activeProjectDir={activeProjectDir}
          onAddToChatPath={onAddToChatPath}
          onStatusChange={onStatusChange}
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
