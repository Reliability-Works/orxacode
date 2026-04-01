import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from 'react'
import type { ProjectListItem } from '@shared/ipc'
import type { SessionType } from '../types/canvas'
import type { AppShellUpdateStatusMessage } from '../hooks/useAppShellUpdateFlow'
import { WorkspaceSidebarView } from './workspace-sidebar-view'

type SidebarMode = 'projects' | 'kanban' | 'skills'
type ProjectSortMode = 'updated' | 'recent' | 'alpha-asc' | 'alpha-desc'
type SessionSidebarIndicator = 'busy' | 'awaiting' | 'unread' | 'none'

type SessionListItem = {
  id: string
  directory?: string
  title?: string
  slug: string
  time: {
    created: number
    updated: number
  }
}

export type WorkspaceSidebarProps = {
  sidebarMode: SidebarMode
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>
  unreadJobRunsCount: number
  updateAvailableVersion: string | null
  isCheckingForUpdates: boolean
  updateInstallPending: boolean
  updateStatusMessage: AppShellUpdateStatusMessage | null
  onCheckForUpdates: () => Promise<void> | void
  onDownloadAndInstallUpdate: () => Promise<void> | void
  openWorkspaceDashboard: () => void
  projectSortOpen: boolean
  setProjectSortOpen: Dispatch<SetStateAction<boolean>>
  projectSortMode: ProjectSortMode
  setProjectSortMode: Dispatch<SetStateAction<ProjectSortMode>>
  filteredProjects: ProjectListItem[]
  activeProjectDir?: string
  collapsedProjects: Record<string, boolean>
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>
  sessions: SessionListItem[]
  cachedSessionsByProject?: Record<string, SessionListItem[]>
  hiddenSessionIDsByProject?: Record<string, string[]>
  pinnedSessionsByProject?: Record<string, string[]>
  activeSessionID?: string
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  getSessionTitle: (
    sessionID: string,
    directory?: string,
    fallbackTitle?: string
  ) => string | undefined
  getSessionType: (sessionID: string, directory?: string) => SessionType | undefined
  getSessionIndicator: (
    sessionID: string,
    directory: string,
    updatedAt: number
  ) => SessionSidebarIndicator
  selectProject: (directory: string) => Promise<void> | void
  createSession: (directory?: string, sessionType?: SessionType) => Promise<void> | void
  openClaudeSessionBrowser: (preferredWorkspaceDirectory?: string) => void
  openCodexSessionBrowser: (preferredWorkspaceDirectory?: string) => void
  openSession: (directory: string, sessionID: string) => Promise<void> | void
  togglePinSession: (directory: string, sessionID: string) => void
  archiveSession: (directory: string, sessionID: string) => Promise<void> | void
  openProjectContextMenu: (event: ReactMouseEvent, directory: string, label: string) => void
  openSessionContextMenu: (
    event: ReactMouseEvent,
    directory: string,
    sessionID: string,
    title: string
  ) => void
  addProjectDirectory: () => Promise<unknown> | unknown
  onOpenMemoryModal: () => void
  onOpenSearchModal: () => void
  onOpenDebugLogs: () => void
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  pinnedSessionRows?: PinnedSessionRow[]
}

type PinnedSessionRow = {
  directory: string
  session: SessionListItem
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const [pickerOpenForProject, setPickerOpenForProject] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const pinnedSessionRows = useMemo<PinnedSessionRow[]>(() => {
    return props.filteredProjects.flatMap(project => {
      const projectSessions =
        props.cachedSessionsByProject?.[project.worktree] ??
        (project.worktree === props.activeProjectDir ? props.sessions : [])
      const hiddenSessionIDs = new Set(props.hiddenSessionIDsByProject?.[project.worktree] ?? [])
      const pinnedSessionIDs = props.pinnedSessionsByProject?.[project.worktree] ?? []

      return pinnedSessionIDs
        .map(sessionID => projectSessions.find(session => session.id === sessionID))
        .filter((session): session is SessionListItem => session !== undefined)
        .filter(session => !hiddenSessionIDs.has(session.id))
        .map(session => ({
          directory: session.directory ?? project.worktree,
          session,
        }))
    })
  }, [
    props.activeProjectDir,
    props.cachedSessionsByProject,
    props.filteredProjects,
    props.hiddenSessionIDsByProject,
    props.pinnedSessionsByProject,
    props.sessions,
  ])

  return (
    <WorkspaceSidebarView
      now={now}
      sidebarMode={props.sidebarMode}
      setSidebarMode={props.setSidebarMode}
      unreadJobRunsCount={props.unreadJobRunsCount}
      updateAvailableVersion={props.updateAvailableVersion}
      isCheckingForUpdates={props.isCheckingForUpdates}
      updateInstallPending={props.updateInstallPending}
      updateStatusMessage={props.updateStatusMessage}
      onCheckForUpdates={props.onCheckForUpdates}
      onDownloadAndInstallUpdate={props.onDownloadAndInstallUpdate}
      openWorkspaceDashboard={props.openWorkspaceDashboard}
      projectSortOpen={props.projectSortOpen}
      setProjectSortOpen={props.setProjectSortOpen}
      projectSortMode={props.projectSortMode}
      setProjectSortMode={props.setProjectSortMode}
      filteredProjects={props.filteredProjects}
      activeProjectDir={props.activeProjectDir}
      collapsedProjects={props.collapsedProjects}
      setCollapsedProjects={props.setCollapsedProjects}
      sessions={props.sessions}
      cachedSessionsByProject={props.cachedSessionsByProject}
      hiddenSessionIDsByProject={props.hiddenSessionIDsByProject}
      pinnedSessionsByProject={props.pinnedSessionsByProject}
      activeSessionID={props.activeSessionID}
      setAllSessionsModalOpen={props.setAllSessionsModalOpen}
      getSessionTitle={props.getSessionTitle}
      getSessionType={props.getSessionType}
      getSessionIndicator={props.getSessionIndicator}
      selectProject={props.selectProject}
      createSession={props.createSession}
      openClaudeSessionBrowser={props.openClaudeSessionBrowser}
      openCodexSessionBrowser={props.openCodexSessionBrowser}
      openSession={props.openSession}
      togglePinSession={props.togglePinSession}
      archiveSession={props.archiveSession}
      openProjectContextMenu={props.openProjectContextMenu}
      openSessionContextMenu={props.openSessionContextMenu}
      addProjectDirectory={props.addProjectDirectory}
      onOpenMemoryModal={props.onOpenMemoryModal}
      onOpenSearchModal={props.onOpenSearchModal}
      onOpenDebugLogs={props.onOpenDebugLogs}
      setSettingsOpen={props.setSettingsOpen}
      pickerOpenForProject={pickerOpenForProject}
      setPickerOpenForProject={setPickerOpenForProject}
      pickerAnchorRef={pickerAnchorRef}
      pinnedSessionRows={pinnedSessionRows}
    />
  )
}
