import type { ComponentProps, Dispatch, ReactNode, SetStateAction } from 'react'
import type { ProjectBootstrap } from '@shared/ipc'
import { ContentTopBar } from './components/ContentTopBar'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import type { CommitNextStep } from './hooks/useGitPanel'
import type { AppPreferences } from '~/types/app'
import type { SessionType } from '~/types/canvas'
import type { ProjectListItem } from '@shared/ipc'

type BuildContentTopBarPropsArgs = {
  showProjectsPane: boolean
  setProjectsSidebarVisible: Dispatch<SetStateAction<boolean>>
  showGitPane: boolean
  setAppPreferences: Dispatch<SetStateAction<AppPreferences>>
  browserSidebarOpen: boolean
  setBrowserSidebarOpen: Dispatch<SetStateAction<boolean>>
  gitDiffStats: ComponentProps<typeof ContentTopBar>['gitDiffStats']
  contentPaneTitle: string
  activeProjectDir: string | undefined
  projectData: ProjectBootstrap | null
  terminalOpen: boolean
  canShowIntegratedTerminal: boolean
  toggleTerminal: () => Promise<void>
  titleMenuOpen: boolean
  openMenuOpen: boolean
  setOpenMenuOpen: Dispatch<SetStateAction<boolean>>
  commitMenuOpen: boolean
  setCommitMenuOpen: Dispatch<SetStateAction<boolean>>
  setTitleMenuOpen: Dispatch<SetStateAction<boolean>>
  activeSessionID: string | undefined
  activeSessionType: SessionType | undefined
  isActiveSessionPinned: boolean
  togglePinSession: (directory: string, sessionID: string) => void
  setStatusLine: (message: string) => void
  activeSession: ProjectBootstrap['sessions'][number] | null | undefined
  renameSession: (directory: string, sessionID: string, currentTitle: string) => void
  archiveSession: (directory: string, sessionID: string) => Promise<void>
  openWorkspaceDashboard: () => void
  copyProjectPath: (directory: string) => Promise<void>
  copySessionID: (directory: string, sessionID: string) => Promise<void>
  activeOpenTarget: ComponentProps<typeof ContentTopBar>['activeOpenTarget']
  openTargets: ComponentProps<typeof ContentTopBar>['openTargets']
  selectOpenTarget: (target: ComponentProps<typeof ContentTopBar>['activeOpenTarget']['id']) => void
  openDirectoryInTarget: (target: ComponentProps<typeof ContentTopBar>['activeOpenTarget']['id']) => Promise<void>
  openCommitModal: (nextStep?: CommitNextStep) => void
  pendingPrUrl: string | null
  openPendingPullRequest: () => void
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>
  setCommitNextStep: Dispatch<SetStateAction<CommitNextStep>>
  customRunCommands: ComponentProps<typeof ContentTopBar>['customRunCommands']
  upsertCustomRunCommand: ComponentProps<typeof ContentTopBar>['onUpsertCustomRunCommand']
  runCustomRunCommand: ComponentProps<typeof ContentTopBar>['onRunCustomRunCommand']
  deleteCustomRunCommand: ComponentProps<typeof ContentTopBar>['onDeleteCustomRunCommand']
}

type BuildWorkspaceSidebarPropsArgs = {
  sidebarMode: ComponentProps<typeof WorkspaceSidebar>['sidebarMode']
  setSidebarMode: ComponentProps<typeof WorkspaceSidebar>['setSidebarMode']
  unreadJobRunsCount: number
  availableUpdateVersion: string | null
  isCheckingForUpdates: boolean
  updateInstallPending: boolean
  updateStatusMessage: ComponentProps<typeof WorkspaceSidebar>['updateStatusMessage']
  checkForUpdates: () => void
  downloadAndInstallUpdate: () => void
  openWorkspaceDashboard: () => void
  projectSortOpen: boolean
  setProjectSortOpen: Dispatch<SetStateAction<boolean>>
  projectSortMode: ComponentProps<typeof WorkspaceSidebar>['projectSortMode']
  setProjectSortMode: ComponentProps<typeof WorkspaceSidebar>['setProjectSortMode']
  filteredProjects: ProjectListItem[]
  activeProjectDir: string | undefined
  collapsedProjects: Record<string, boolean>
  setCollapsedProjects: ComponentProps<typeof WorkspaceSidebar>['setCollapsedProjects']
  sessions: ComponentProps<typeof WorkspaceSidebar>['sessions']
  cachedSessionsByProject: ComponentProps<typeof WorkspaceSidebar>['cachedSessionsByProject']
  hiddenSessionIDsByProject: ComponentProps<typeof WorkspaceSidebar>['hiddenSessionIDsByProject']
  pinnedSessions: NonNullable<ComponentProps<typeof WorkspaceSidebar>['pinnedSessionsByProject']>
  activeSessionID: string | undefined
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  getSessionTitle: ComponentProps<typeof WorkspaceSidebar>['getSessionTitle']
  getSessionType: ComponentProps<typeof WorkspaceSidebar>['getSessionType']
  getSessionIndicator: ComponentProps<typeof WorkspaceSidebar>['getSessionIndicator']
  selectProject: ComponentProps<typeof WorkspaceSidebar>['selectProject']
  createSession: ComponentProps<typeof WorkspaceSidebar>['createSession']
  openSession: ComponentProps<typeof WorkspaceSidebar>['openSession']
  togglePinSession: (directory: string, sessionID: string) => void
  setStatusLine: (message: string) => void
  archiveSession: ComponentProps<typeof WorkspaceSidebar>['archiveSession']
  openProjectContextMenu: ComponentProps<typeof WorkspaceSidebar>['openProjectContextMenu']
  openSessionContextMenu: ComponentProps<typeof WorkspaceSidebar>['openSessionContextMenu']
  addProjectDirectory: () => void
  setGlobalSearchModalOpen: Dispatch<SetStateAction<boolean>>
  setMemoryComingSoonOpen: Dispatch<SetStateAction<boolean>>
  setDebugModalOpen: Dispatch<SetStateAction<boolean>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
}

export function buildContentTopBarProps(args: BuildContentTopBarPropsArgs): ComponentProps<typeof ContentTopBar> {
  return {
    projectsPaneVisible: args.showProjectsPane,
    toggleProjectsPane: () => args.setProjectsSidebarVisible(!args.showProjectsPane),
    showGitPane: args.showGitPane,
    setGitPaneVisible: visible =>
      args.setAppPreferences(current => ({ ...current, showOperationsPane: visible })),
    browserSidebarOpen: args.browserSidebarOpen,
    toggleBrowserSidebar: () => args.setBrowserSidebarOpen(current => !current),
    gitDiffStats: args.gitDiffStats,
    contentPaneTitle: args.contentPaneTitle,
    activeProjectDir: args.activeProjectDir ?? null,
    projectData: args.projectData,
    terminalOpen: args.terminalOpen,
    showTerminalToggle: args.canShowIntegratedTerminal,
    toggleTerminal: args.toggleTerminal,
    titleMenuOpen: args.titleMenuOpen,
    openMenuOpen: args.openMenuOpen,
    setOpenMenuOpen: args.setOpenMenuOpen,
    commitMenuOpen: args.commitMenuOpen,
    setCommitMenuOpen: args.setCommitMenuOpen,
    setTitleMenuOpen: args.setTitleMenuOpen,
    hasActiveSession: Boolean(args.activeSessionID),
    isActiveSessionCanvasSession: args.activeSessionType === 'canvas',
    activeSessionType: args.activeSessionType,
    isActiveSessionPinned: args.isActiveSessionPinned,
    onTogglePinSession: () => onTogglePinSession(args),
    onRenameSession: () => onRenameSession(args),
    onArchiveSession: () => onArchiveSession(args),
    onViewWorkspace: () => { args.setTitleMenuOpen(false); args.openWorkspaceDashboard() },
    onCopyPath: () => onCopyPath(args),
    onCopySessionId: () => onCopySessionId(args),
    activeOpenTarget: args.activeOpenTarget,
    openTargets: args.openTargets,
    onSelectOpenTarget: args.selectOpenTarget,
    openDirectoryInTarget: args.openDirectoryInTarget,
    openCommitModal: args.openCommitModal,
    pendingPrUrl: args.pendingPrUrl,
    onOpenPendingPullRequest: args.openPendingPullRequest,
    commitNextStepOptions: args.commitNextStepOptions,
    setCommitNextStep: args.setCommitNextStep,
    customRunCommands: args.customRunCommands,
    onUpsertCustomRunCommand: args.upsertCustomRunCommand,
    onRunCustomRunCommand: args.runCustomRunCommand,
    onDeleteCustomRunCommand: args.deleteCustomRunCommand,
  }
}

export function buildWorkspaceSidebarProps(
  args: BuildWorkspaceSidebarPropsArgs
): ComponentProps<typeof WorkspaceSidebar> {
  return {
    sidebarMode: args.sidebarMode,
    setSidebarMode: args.setSidebarMode,
    unreadJobRunsCount: args.unreadJobRunsCount,
    updateAvailableVersion: args.availableUpdateVersion,
    isCheckingForUpdates: args.isCheckingForUpdates,
    updateInstallPending: args.updateInstallPending,
    updateStatusMessage: args.updateStatusMessage,
    onCheckForUpdates: args.checkForUpdates,
    onDownloadAndInstallUpdate: args.downloadAndInstallUpdate,
    openWorkspaceDashboard: args.openWorkspaceDashboard,
    projectSortOpen: args.projectSortOpen,
    setProjectSortOpen: args.setProjectSortOpen,
    projectSortMode: args.projectSortMode,
    setProjectSortMode: args.setProjectSortMode,
    filteredProjects: args.filteredProjects,
    activeProjectDir: args.activeProjectDir,
    collapsedProjects: args.collapsedProjects,
    setCollapsedProjects: args.setCollapsedProjects,
    sessions: args.sessions,
    cachedSessionsByProject: args.cachedSessionsByProject,
    hiddenSessionIDsByProject: args.hiddenSessionIDsByProject,
    pinnedSessionsByProject: args.pinnedSessions,
    activeSessionID: args.activeSessionID,
    setAllSessionsModalOpen: args.setAllSessionsModalOpen,
    getSessionTitle: args.getSessionTitle,
    getSessionType: args.getSessionType,
    getSessionIndicator: args.getSessionIndicator,
    selectProject: args.selectProject,
    createSession: args.createSession,
    openSession: args.openSession,
    togglePinSession: (directory, sessionID) => {
      args.togglePinSession(directory, sessionID)
      const isPinned = (args.pinnedSessions[directory] ?? []).includes(sessionID)
      args.setStatusLine(isPinned ? 'Session unpinned' : 'Session pinned')
    },
    archiveSession: args.archiveSession,
    openProjectContextMenu: args.openProjectContextMenu,
    openSessionContextMenu: args.openSessionContextMenu,
    addProjectDirectory: args.addProjectDirectory,
    onOpenSearchModal: () => args.setGlobalSearchModalOpen(true),
    onOpenMemoryModal: () => args.setMemoryComingSoonOpen(true),
    onOpenDebugLogs: () => args.setDebugModalOpen(true),
    setSettingsOpen: args.setSettingsOpen,
  }
}

function onTogglePinSession(args: BuildContentTopBarPropsArgs) {
  if (!args.activeProjectDir || !args.activeSessionID) {
    return
  }
  const nextPinned = !args.isActiveSessionPinned
  args.togglePinSession(args.activeProjectDir, args.activeSessionID)
  args.setStatusLine(nextPinned ? 'Session pinned' : 'Session unpinned')
  args.setTitleMenuOpen(false)
}

function onRenameSession(args: BuildContentTopBarPropsArgs) {
  if (!args.activeProjectDir || !args.activeSessionID || !args.activeSession) {
    return
  }
  args.setTitleMenuOpen(false)
  args.renameSession(
    args.activeProjectDir,
    args.activeSessionID,
    args.activeSession.title || args.activeSession.slug
  )
}

function onArchiveSession(args: BuildContentTopBarPropsArgs) {
  if (!args.activeProjectDir || !args.activeSessionID) {
    return
  }
  args.setTitleMenuOpen(false)
  void args.archiveSession(args.activeProjectDir, args.activeSessionID)
}

function onCopyPath(args: BuildContentTopBarPropsArgs) {
  if (!args.activeProjectDir) {
    return
  }
  args.setTitleMenuOpen(false)
  void args.copyProjectPath(args.activeProjectDir)
}

function onCopySessionId(args: BuildContentTopBarPropsArgs) {
  if (!args.activeProjectDir || !args.activeSessionID) {
    return
  }
  args.setTitleMenuOpen(false)
  void args.copySessionID(args.activeProjectDir, args.activeSessionID)
}
