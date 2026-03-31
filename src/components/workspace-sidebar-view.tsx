import { type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction, useMemo } from 'react'
import {
  Archive,
  Brain,
  LayoutDashboard,
  Pin,
  Rows3,
  Search,
  Zap,
} from 'lucide-react'
import type { ProjectListItem } from '@shared/ipc'
import type { SessionType } from '../types/canvas'
import type { AppShellUpdateStatusMessage } from '../hooks/useAppShellUpdateFlow'
import { IconButton } from './IconButton'
import { AnthropicLogo, CanvasLogo, OpenAILogo, OpenCodeLogo } from './ProviderLogos'
import { WorkspaceProjectItem } from './workspace-sidebar-project-item'
import { WorkspaceSidebarUpdateCard } from './workspace-sidebar-update-card'

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

type PinnedSessionRow = {
  directory: string
  session: SessionListItem
}

export type WorkspaceSidebarViewProps = {
  now: number
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
  pickerOpenForProject: string | null
  setPickerOpenForProject: Dispatch<SetStateAction<string | null>>
  pickerAnchorRef: React.MutableRefObject<HTMLButtonElement | null>
  pinnedSessionRows: PinnedSessionRow[]
}

function formatSessionAge(now: number, createdAt: number) {
  const elapsedMs = Math.max(60_000, now - createdAt)
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

function renderSessionTypeIcon(sessionType: SessionType | undefined) {
  switch (sessionType) {
    case 'canvas':
      return (
        <span className="session-type-icon session-type-icon--canvas" aria-hidden="true">
          <CanvasLogo size={10} />
        </span>
      )
    case 'codex':
      return (
        <span className="session-type-icon session-type-icon--codex" aria-hidden="true">
          <OpenAILogo size={10} />
        </span>
      )
    case 'claude':
    case 'claude-chat':
      return (
        <span className="session-type-icon session-type-icon--claude" aria-hidden="true">
          <AnthropicLogo size={10} />
        </span>
      )
    case 'opencode':
    default:
      return (
        <span className="session-type-icon session-type-icon--opencode" aria-hidden="true">
          <OpenCodeLogo size={10} />
        </span>
      )
  }
}

function WorkspaceSessionRow({
  now,
  projectDirectory,
  session,
  sessionTitle,
  activeSessionID,
  pinnedSessionsByProject,
  getSessionIndicator,
  getSessionType,
  openSession,
  archiveSession,
  togglePinSession,
  openSessionContextMenu,
}: {
  now: number
  projectDirectory: string
  session: SessionListItem
  sessionTitle: string
  activeSessionID?: string
  pinnedSessionsByProject?: Record<string, string[]>
  getSessionIndicator: WorkspaceSidebarViewProps['getSessionIndicator']
  getSessionType: WorkspaceSidebarViewProps['getSessionType']
  openSession: WorkspaceSidebarViewProps['openSession']
  archiveSession: WorkspaceSidebarViewProps['archiveSession']
  togglePinSession: WorkspaceSidebarViewProps['togglePinSession']
  openSessionContextMenu: WorkspaceSidebarViewProps['openSessionContextMenu']
}) {
  const sessionDirectory = session.directory ?? projectDirectory
  const indicator = getSessionIndicator(session.id, sessionDirectory, session.time.updated)
  const sessionType = getSessionType(session.id, sessionDirectory)
  const isPinned = (pinnedSessionsByProject?.[projectDirectory] ?? []).includes(session.id)
  const sessionAge = formatSessionAge(now, session.time.created)

  return (
    <div
      className={`workspace-session-row ${session.id === activeSessionID ? 'active' : ''}`.trim()}
      onContextMenu={event => openSessionContextMenu(event, sessionDirectory, session.id, sessionTitle)}
    >
      <span className="workspace-session-row-pin-slot">
        <button
          type="button"
          className={`workspace-session-row-action${isPinned ? ' is-active' : ''}`.trim()}
          aria-label={isPinned ? `Unpin ${sessionTitle}` : `Pin ${sessionTitle}`}
          title={isPinned ? 'Unpin session' : 'Pin session'}
          onClick={event => {
            event.stopPropagation()
            togglePinSession(projectDirectory, session.id)
          }}
        >
          <Pin size={11} aria-hidden="true" />
        </button>
      </span>
      <button
        type="button"
        className={
          session.id === activeSessionID
            ? 'active workspace-session-row-main-button'
            : 'workspace-session-row-main-button'
        }
        onClick={() => void openSession(sessionDirectory, session.id)}
        title={sessionTitle}
      >
        <span className="workspace-session-row-leading" aria-hidden="true">
          {indicator === 'none' ? (
            renderSessionTypeIcon(sessionType)
          ) : (
            <span className={`session-status-indicator ${indicator}`} aria-hidden="true">
              {indicator === 'awaiting' ? '!' : null}
            </span>
          )}
        </span>
        <span className="workspace-session-row-title-text">{sessionTitle}</span>
      </button>
      <span className="workspace-session-row-trailing">
        <span className="workspace-session-row-age" aria-label={`${sessionAge} old`}>
          {sessionAge}
        </span>
        <span className="workspace-session-row-actions">
          <button
            type="button"
            className="workspace-session-row-action workspace-session-row-action--archive"
            aria-label={`Archive ${sessionTitle}`}
            title="Archive session"
            onClick={event => {
              event.stopPropagation()
              void archiveSession(sessionDirectory, session.id)
            }}
          >
            <Archive size={11} aria-hidden="true" />
          </button>
        </span>
      </span>
    </div>
  )
}

function SidebarModes({
  sidebarMode,
  unreadJobRunsCount,
  openWorkspaceDashboard,
  setSidebarMode,
  onOpenSearchModal,
  onOpenMemoryModal,
  activeProjectDir,
}: Pick<
  WorkspaceSidebarViewProps,
  | 'sidebarMode'
  | 'unreadJobRunsCount'
  | 'openWorkspaceDashboard'
  | 'setSidebarMode'
  | 'onOpenSearchModal'
  | 'onOpenMemoryModal'
  | 'activeProjectDir'
>) {
  return (
    <nav className="sidebar-mode-links" aria-label="Sidebar mode">
      <button
        type="button"
        className={sidebarMode === 'projects' && !activeProjectDir ? 'active' : ''}
        onClick={openWorkspaceDashboard}
      >
        <LayoutDashboard size={16} aria-hidden="true" />
        Dashboard
      </button>
      <button
        type="button"
        className={sidebarMode === 'kanban' ? 'active' : ''}
        onClick={() => setSidebarMode('kanban')}
      >
        <Rows3 size={16} aria-hidden="true" />
        Orxa KanBan
        <span className="sidebar-mode-warning">Experimental</span>
        {unreadJobRunsCount > 0 ? <span className="sidebar-mode-badge">{unreadJobRunsCount}</span> : null}
      </button>
      <button
        type="button"
        className={sidebarMode === 'skills' ? 'active' : ''}
        onClick={() => setSidebarMode('skills')}
      >
        <Zap size={16} aria-hidden="true" />
        Skills
      </button>
      <button type="button" onClick={onOpenSearchModal}>
        <Search size={16} aria-hidden="true" />
        Search
      </button>
      <button type="button" onClick={onOpenMemoryModal}>
        <Brain size={16} aria-hidden="true" />
        Memory
      </button>
    </nav>
  )
}

function WorkspaceSortPopover({
  projectSortOpen,
  projectSortMode,
  setProjectSortMode,
  setProjectSortOpen,
}: Pick<
  WorkspaceSidebarViewProps,
  'projectSortOpen' | 'projectSortMode' | 'setProjectSortMode' | 'setProjectSortOpen'
>) {
  if (!projectSortOpen) {
    return null
  }
  return (
    <div className="project-sort-popover">
      <button type="button" className={projectSortMode === 'updated' ? 'active' : ''} onClick={() => { setProjectSortMode('updated'); setProjectSortOpen(false) }}>
        Last updated
      </button>
      <button type="button" className={projectSortMode === 'recent' ? 'active' : ''} onClick={() => { setProjectSortMode('recent'); setProjectSortOpen(false) }}>
        Most recent
      </button>
      <button type="button" className={projectSortMode === 'alpha-asc' ? 'active' : ''} onClick={() => { setProjectSortMode('alpha-asc'); setProjectSortOpen(false) }}>
        Alphabetical (A-Z)
      </button>
      <button type="button" className={projectSortMode === 'alpha-desc' ? 'active' : ''} onClick={() => { setProjectSortMode('alpha-desc'); setProjectSortOpen(false) }}>
        Alphabetical (Z-A)
      </button>
    </div>
  )
}

function PinnedSessionsSection(props: WorkspaceSidebarViewProps) {
  const {
    now,
    pinnedSessionRows,
    getSessionTitle,
    getSessionIndicator,
    getSessionType,
    openSession,
    archiveSession,
    togglePinSession,
    openSessionContextMenu,
  } = props
  if (pinnedSessionRows.length === 0) {
    return null
  }
  return (
    <div className="sidebar-pinned-sessions-section">
      <div className="sidebar-subsection-label">Pinned</div>
      <div className="project-session-list project-session-list--pinned">
        {pinnedSessionRows.map(({ directory, session }) => {
          const sessionTitle =
            getSessionTitle(session.id, directory, session.title ?? session.slug) ??
            session.title ??
            session.slug
          return (
            <WorkspaceSessionRow
              key={`${directory}:${session.id}`}
              now={now}
              projectDirectory={directory}
              session={session}
              sessionTitle={sessionTitle}
              activeSessionID={props.activeSessionID}
              pinnedSessionsByProject={props.pinnedSessionsByProject}
              getSessionIndicator={getSessionIndicator}
              getSessionType={getSessionType}
              openSession={openSession}
              archiveSession={archiveSession}
              togglePinSession={togglePinSession}
              openSessionContextMenu={openSessionContextMenu}
            />
          )
        })}
      </div>
    </div>
  )
}

function WorkspaceProjectsSection(props: WorkspaceSidebarViewProps) {
  const {
    now,
    filteredProjects,
    activeProjectDir,
    collapsedProjects,
    setCollapsedProjects,
    sessions,
    cachedSessionsByProject,
    hiddenSessionIDsByProject,
    pinnedSessionsByProject,
    activeSessionID,
    setAllSessionsModalOpen,
    getSessionTitle,
    getSessionType,
  getSessionIndicator,
  selectProject,
  createSession,
  openClaudeSessionBrowser,
  openSession,
    togglePinSession,
    archiveSession,
    openProjectContextMenu,
    openSessionContextMenu,
    pickerOpenForProject,
    setPickerOpenForProject,
    pickerAnchorRef,
  } = props

  return (
    <div className="project-list">
      {filteredProjects.map(project => (
        <WorkspaceProjectItem
          key={project.id}
          now={now}
          project={project}
          activeProjectDir={activeProjectDir}
          collapsedProjects={collapsedProjects}
          setCollapsedProjects={setCollapsedProjects}
          sessions={sessions}
          cachedSessionsByProject={cachedSessionsByProject}
          hiddenSessionIDsByProject={hiddenSessionIDsByProject}
          pinnedSessionsByProject={pinnedSessionsByProject}
          activeSessionID={activeSessionID}
          setAllSessionsModalOpen={setAllSessionsModalOpen}
          getSessionTitle={getSessionTitle}
          getSessionType={getSessionType}
          getSessionIndicator={getSessionIndicator}
          selectProject={selectProject}
          createSession={createSession}
          openClaudeSessionBrowser={openClaudeSessionBrowser}
          openSession={openSession}
          togglePinSession={togglePinSession}
          archiveSession={archiveSession}
          openProjectContextMenu={openProjectContextMenu}
          openSessionContextMenu={openSessionContextMenu}
          pickerOpenForProject={pickerOpenForProject}
          setPickerOpenForProject={setPickerOpenForProject}
          pickerAnchorRef={pickerAnchorRef}
        />
      ))}
    </div>
  )
}

export function WorkspaceSidebarView(props: WorkspaceSidebarViewProps) {
  const pinnedSessionRows = useMemo(() => {
    return props.filteredProjects.flatMap(project => {
      const projectSessions =
        project.worktree === props.activeProjectDir
          ? props.sessions
          : (props.cachedSessionsByProject?.[project.worktree] ?? [])
      const hiddenSessionIDs = new Set(props.hiddenSessionIDsByProject?.[project.worktree] ?? [])
      const pinnedSessionIDs = props.pinnedSessionsByProject?.[project.worktree] ?? []

      return pinnedSessionIDs
        .map(sessionID => projectSessions.find(session => session.id === sessionID))
        .filter((session): session is SessionListItem => session !== undefined)
        .filter(session => !hiddenSessionIDs.has(session.id))
        .map(session => ({
          directory: project.worktree,
          session,
        }))
    })
  }, [props.activeProjectDir, props.cachedSessionsByProject, props.filteredProjects, props.hiddenSessionIDsByProject, props.pinnedSessionsByProject, props.sessions])

  return (
    <aside className="sidebar projects-pane">
      <div className="sidebar-inner">
        <SidebarModes
          sidebarMode={props.sidebarMode}
          unreadJobRunsCount={props.unreadJobRunsCount}
          openWorkspaceDashboard={props.openWorkspaceDashboard}
          setSidebarMode={props.setSidebarMode}
          onOpenSearchModal={props.onOpenSearchModal}
          onOpenMemoryModal={props.onOpenMemoryModal}
          activeProjectDir={props.activeProjectDir}
        />

        <div className="sidebar-workspaces-section">
          <div className="pane-header">
            <h2>Workspaces</h2>
            <div className="pane-header-actions">
              <IconButton
                icon="sort"
                className="pane-action-icon"
                label={props.projectSortOpen ? 'Close sort options' : 'Sort workspaces'}
                onClick={() => {
                  props.setProjectSortOpen(value => !value)
                }}
              />
              <IconButton
                icon="folderPlus"
                className="pane-action-icon"
                label="Add workspace folder"
                onClick={() => void props.addProjectDirectory()}
              />
            </div>
          </div>

          <WorkspaceSortPopover
            projectSortOpen={props.projectSortOpen}
            projectSortMode={props.projectSortMode}
            setProjectSortMode={props.setProjectSortMode}
            setProjectSortOpen={props.setProjectSortOpen}
          />

          <PinnedSessionsSection
            {...props}
            pinnedSessionRows={pinnedSessionRows}
          />

          <WorkspaceProjectsSection {...props} />
        </div>

        <WorkspaceSidebarUpdateCard
          updateAvailableVersion={props.updateAvailableVersion}
          isCheckingForUpdates={props.isCheckingForUpdates}
          updateInstallPending={props.updateInstallPending}
          updateStatusMessage={props.updateStatusMessage}
          onCheckForUpdates={props.onCheckForUpdates}
          onDownloadAndInstallUpdate={props.onDownloadAndInstallUpdate}
        />
      </div>
    </aside>
  )
}
