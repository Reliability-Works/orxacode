import type { ReactNode } from 'react'
import type { ProjectData } from '../hooks/useDashboards'
import type { CommitNextStep, GitDiffStats } from '../hooks/useGitPanel'
import { IconButton } from './IconButton'
import {
  ContentTopBarActions,
  type OpenTargetOption,
} from './content-top-bar-actions'

export type CustomRunCommandPreset = {
  id: string
  title: string
  commands: string
  updatedAt: number
}

export type CustomRunCommandInput = {
  id?: string
  title: string
  commands: string
}

type ContentTopBarProps = {
  projectsPaneVisible: boolean
  toggleProjectsPane: () => void
  showGitPane: boolean
  setGitPaneVisible: (visible: boolean) => void
  browserSidebarOpen: boolean
  toggleBrowserSidebar: () => void
  gitDiffStats: GitDiffStats
  contentPaneTitle: string
  activeProjectDir: string | null
  projectData: ProjectData | null
  terminalOpen: boolean
  showTerminalToggle?: boolean
  toggleTerminal: () => Promise<void>
  titleMenuOpen: boolean
  openMenuOpen: boolean
  setOpenMenuOpen: (open: boolean) => void
  commitMenuOpen: boolean
  setCommitMenuOpen: (open: boolean) => void
  setTitleMenuOpen: (open: boolean) => void
  hasActiveSession: boolean
  isActiveSessionCanvasSession?: boolean
  activeSessionType?: string
  isActiveSessionPinned: boolean
  onTogglePinSession: () => void
  onRenameSession: () => void
  onArchiveSession: () => void
  onViewWorkspace: () => void
  onCopyPath: () => void
  onCopySessionId: () => void
  activeOpenTarget: OpenTargetOption
  openTargets: OpenTargetOption[]
  onSelectOpenTarget: (targetID: OpenTargetOption['id']) => void
  openDirectoryInTarget: (targetID: OpenTargetOption['id']) => Promise<void>
  openCommitModal: (nextStep?: CommitNextStep) => void
  pendingPrUrl: string | null
  onOpenPendingPullRequest: () => void
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>
  setCommitNextStep: (nextStep: CommitNextStep) => void
  customRunCommands: CustomRunCommandPreset[]
  onUpsertCustomRunCommand: (input: CustomRunCommandInput) => CustomRunCommandPreset
  onRunCustomRunCommand: (command: CustomRunCommandPreset) => Promise<void>
  onDeleteCustomRunCommand: (id: string) => void
}

export function ContentTopBar({
  projectsPaneVisible,
  toggleProjectsPane,
  showGitPane,
  setGitPaneVisible,
  browserSidebarOpen,
  toggleBrowserSidebar,
  gitDiffStats,
  activeProjectDir,
  projectData,
  terminalOpen,
  showTerminalToggle = true,
  toggleTerminal,
  openMenuOpen,
  setOpenMenuOpen,
  commitMenuOpen,
  setCommitMenuOpen,
  setTitleMenuOpen,
  activeOpenTarget,
  openTargets,
  onSelectOpenTarget,
  openDirectoryInTarget,
  openCommitModal,
  pendingPrUrl,
  onOpenPendingPullRequest,
  commitNextStepOptions,
  setCommitNextStep,
  customRunCommands,
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  onDeleteCustomRunCommand,
}: ContentTopBarProps) {
  const hasProjectContext = Boolean(activeProjectDir ?? projectData?.directory)

  return (
    <div className="content-edge-controls">
      <div className={`topbar-brand-group ${projectsPaneVisible ? 'in-sidebar' : ''}`.trim()}>
        <IconButton
          icon="panelLeft"
          label="Toggle left sidebar"
          className={`topbar-sidebar-toggle titlebar-toggle ${projectsPaneVisible ? 'expanded' : 'collapsed'}`.trim()}
          onClick={toggleProjectsPane}
        />
        <span className="topbar-brand">orxa code</span>
      </div>

      <div className="topbar-spacer" />

      <ContentTopBarActions
        hasProjectContext={hasProjectContext}
        browserSidebarOpen={browserSidebarOpen}
        toggleBrowserSidebar={toggleBrowserSidebar}
        terminalOpen={terminalOpen}
        showTerminalToggle={showTerminalToggle}
        toggleTerminal={toggleTerminal}
        activeOpenTarget={activeOpenTarget}
        openTargets={openTargets}
        openMenuOpen={openMenuOpen}
        setOpenMenuOpen={setOpenMenuOpen}
        onSelectOpenTarget={onSelectOpenTarget}
        onOpenDirectoryInTarget={openDirectoryInTarget}
        commitMenuOpen={commitMenuOpen}
        setCommitMenuOpen={setCommitMenuOpen}
        setTitleMenuOpen={setTitleMenuOpen}
        pendingPrUrl={pendingPrUrl}
        onOpenPendingPullRequest={onOpenPendingPullRequest}
        commitNextStepOptions={commitNextStepOptions}
        setCommitNextStep={setCommitNextStep}
        openCommitModal={openCommitModal}
        showGitPane={showGitPane}
        setGitPaneVisible={setGitPaneVisible}
        gitDiffStats={gitDiffStats}
        customRunCommands={customRunCommands}
        onUpsertCustomRunCommand={onUpsertCustomRunCommand}
        onRunCustomRunCommand={onRunCustomRunCommand}
        onDeleteCustomRunCommand={onDeleteCustomRunCommand}
      />
    </div>
  )
}
