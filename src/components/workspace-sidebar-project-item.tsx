import { type Dispatch, type SetStateAction } from 'react'
import { Archive, ChevronDown, ChevronRight, Pin } from 'lucide-react'
import type { SessionType } from '../types/canvas'
import { NewSessionPicker } from './NewSessionPicker'
import type { WorkspaceSidebarViewProps } from './workspace-sidebar-view'
import { AnthropicLogo, CanvasLogo, OpenAILogo, OpenCodeLogo } from './ProviderLogos'

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

export type WorkspaceSidebarProjectItemProps = {
  now: number
  project: {
    id: string
    name?: string
    worktree: string
  }
  activeProjectDir?: string
  collapsedProjects: Record<string, boolean>
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>
  sessions: SessionListItem[]
  cachedSessionsByProject?: Record<string, SessionListItem[]>
  hiddenSessionIDsByProject?: Record<string, string[]>
  pinnedSessionsByProject?: Record<string, string[]>
  activeSessionID?: string
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  getSessionTitle: WorkspaceSidebarViewProps['getSessionTitle']
  getSessionType: WorkspaceSidebarViewProps['getSessionType']
  getSessionIndicator: WorkspaceSidebarViewProps['getSessionIndicator']
  selectProject: WorkspaceSidebarViewProps['selectProject']
  createSession: WorkspaceSidebarViewProps['createSession']
  openClaudeSessionBrowser: WorkspaceSidebarViewProps['openClaudeSessionBrowser']
  openCodexSessionBrowser: WorkspaceSidebarViewProps['openCodexSessionBrowser']
  openSession: WorkspaceSidebarViewProps['openSession']
  togglePinSession: WorkspaceSidebarViewProps['togglePinSession']
  archiveSession: WorkspaceSidebarViewProps['archiveSession']
  openProjectContextMenu: WorkspaceSidebarViewProps['openProjectContextMenu']
  openSessionContextMenu: WorkspaceSidebarViewProps['openSessionContextMenu']
  pickerOpenForProject: string | null
  setPickerOpenForProject: Dispatch<SetStateAction<string | null>>
  pickerAnchorRef: WorkspaceSidebarViewProps['pickerAnchorRef']
}

type WorkspaceProjectIdentity = WorkspaceSidebarProjectItemProps['project']

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

function SessionTypeIcon({ sessionType }: { sessionType: SessionType | undefined }) {
  if (sessionType === 'canvas') {
    return (
      <span className="session-type-icon session-type-icon--canvas" aria-hidden="true">
        <CanvasLogo size={10} />
      </span>
    )
  }
  if (sessionType === 'codex') {
    return (
      <span className="session-type-icon session-type-icon--codex" aria-hidden="true">
        <OpenAILogo size={10} />
      </span>
    )
  }
  if (sessionType === 'claude' || sessionType === 'claude-chat') {
    return (
      <span className="session-type-icon session-type-icon--claude" aria-hidden="true">
        <AnthropicLogo size={10} />
      </span>
    )
  }
  return (
    <span className="session-type-icon session-type-icon--opencode" aria-hidden="true">
      <OpenCodeLogo size={10} />
    </span>
  )
}

function selectDisplayedSessions(
  visibleProjectSessions: SessionListItem[],
  activeSessionID?: string
) {
  const first = visibleProjectSessions.slice(0, 4)
  if (!activeSessionID || first.some(session => session.id === activeSessionID)) {
    return first
  }
  const active = visibleProjectSessions.find(session => session.id === activeSessionID)
  if (!active) {
    return first
  }
  return [active, ...first.slice(0, 3)]
}

function openWorkspaceDetailsFromPicker(
  projectWorktree: string,
  selectProject: WorkspaceSidebarViewProps['selectProject'],
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>,
  setPickerOpenForProject: Dispatch<SetStateAction<string | null>>
) {
  setPickerOpenForProject(null)
  void Promise.resolve(selectProject(projectWorktree)).then(() => {
    setAllSessionsModalOpen(true)
  })
}

function WorkspaceProjectNewSessionPicker({
  pickerAnchorRef,
  pickerOpenForProject,
  project,
  projectLabel,
  selectProject,
  setAllSessionsModalOpen,
  setPickerOpenForProject,
  createSession,
  openClaudeSessionBrowser,
  openCodexSessionBrowser,
}: {
  pickerAnchorRef: WorkspaceSidebarViewProps['pickerAnchorRef']
  pickerOpenForProject: string | null
  project: WorkspaceProjectIdentity
  projectLabel: string
  selectProject: WorkspaceSidebarViewProps['selectProject']
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  setPickerOpenForProject: Dispatch<SetStateAction<string | null>>
  createSession: WorkspaceSidebarViewProps['createSession']
  openClaudeSessionBrowser: WorkspaceSidebarViewProps['openClaudeSessionBrowser']
  openCodexSessionBrowser: WorkspaceSidebarViewProps['openCodexSessionBrowser']
}) {
  return (
    <div className="project-add-session-wrapper">
      <button
        ref={el => {
          if (pickerOpenForProject === project.worktree) {
            pickerAnchorRef.current = el
          }
        }}
        type="button"
        className="project-add-session"
        onClick={event => {
          event.stopPropagation()
          setPickerOpenForProject(current => (current === project.worktree ? null : project.worktree))
        }}
        aria-label={`Create session for ${projectLabel}`}
        aria-haspopup="menu"
        aria-expanded={pickerOpenForProject === project.worktree}
        title="New session"
      >
        +
      </button>
      <NewSessionPicker
        isOpen={pickerOpenForProject === project.worktree}
        onPick={sessionType => {
          setPickerOpenForProject(null)
          void createSession(project.worktree, sessionType)
        }}
        onOpenWorkspaceDetail={() =>
          openWorkspaceDetailsFromPicker(
            project.worktree,
            selectProject,
            setAllSessionsModalOpen,
            setPickerOpenForProject
          )
        }
        onBrowseClaudeSessions={() => {
          setPickerOpenForProject(null)
          openClaudeSessionBrowser(project.worktree)
        }}
        onBrowseCodexSessions={() => {
          setPickerOpenForProject(null)
          openCodexSessionBrowser(project.worktree)
        }}
        onClose={() => setPickerOpenForProject(null)}
      />
    </div>
  )
}

function WorkspaceProjectHeader({
  isActiveProject,
  isExpanded,
  pickerAnchorRef,
  pickerOpenForProject,
  project,
  projectLabel,
  selectProject,
  setCollapsedProjects,
  setPickerOpenForProject,
  setAllSessionsModalOpen,
  createSession,
  openClaudeSessionBrowser,
  openCodexSessionBrowser,
}: {
  isActiveProject: boolean
  isExpanded: boolean
  pickerAnchorRef: WorkspaceSidebarViewProps['pickerAnchorRef']
  pickerOpenForProject: string | null
  project: WorkspaceProjectIdentity
  projectLabel: string
  selectProject: WorkspaceSidebarViewProps['selectProject']
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>
  setPickerOpenForProject: Dispatch<SetStateAction<string | null>>
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  createSession: WorkspaceSidebarViewProps['createSession']
  openClaudeSessionBrowser: WorkspaceSidebarViewProps['openClaudeSessionBrowser']
  openCodexSessionBrowser: WorkspaceSidebarViewProps['openCodexSessionBrowser']
}) {
  return (
    <div className="project-item-header">
      <button
        type="button"
        className="project-row-chevron-btn"
        onClick={event => {
          event.stopPropagation()
          setCollapsedProjects(current => ({
            ...current,
            [project.worktree]: !current[project.worktree],
          }))
        }}
        aria-label={isExpanded ? `Collapse ${projectLabel}` : `Expand ${projectLabel}`}
        title={isExpanded ? 'Collapse workspace' : 'Expand workspace'}
      >
        <span className="project-row-arrow" aria-hidden="true">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      <button
        type="button"
        className={`project-select ${isActiveProject ? 'active' : ''}`.trim()}
        onClick={() => void selectProject(project.worktree)}
        title={projectLabel}
      >
        <span className="project-status-dot" aria-hidden="true" />
        <span className="project-label-text">{projectLabel}</span>
      </button>
      <WorkspaceProjectNewSessionPicker
        pickerAnchorRef={pickerAnchorRef}
        pickerOpenForProject={pickerOpenForProject}
        project={project}
        projectLabel={projectLabel}
        selectProject={selectProject}
        setAllSessionsModalOpen={setAllSessionsModalOpen}
        setPickerOpenForProject={setPickerOpenForProject}
        createSession={createSession}
        openClaudeSessionBrowser={openClaudeSessionBrowser}
        openCodexSessionBrowser={openCodexSessionBrowser}
      />
    </div>
  )
}

function WorkspaceProjectSessionList({
  activeSessionID,
  archiveSession,
  displayedSessions,
  getSessionIndicator,
  getSessionTitle,
  getSessionType,
  now,
  openSession,
  openSessionContextMenu,
  pinnedSessionsByProject,
  projectWorktree,
  setAllSessionsModalOpen,
  togglePinSession,
  visibleSessions,
}: {
  activeSessionID?: string
  archiveSession: WorkspaceSidebarViewProps['archiveSession']
  displayedSessions: SessionListItem[]
  getSessionIndicator: WorkspaceSidebarViewProps['getSessionIndicator']
  getSessionTitle: WorkspaceSidebarViewProps['getSessionTitle']
  getSessionType: WorkspaceSidebarViewProps['getSessionType']
  now: number
  openSession: WorkspaceSidebarViewProps['openSession']
  openSessionContextMenu: WorkspaceSidebarViewProps['openSessionContextMenu']
  pinnedSessionsByProject?: Record<string, string[]>
  projectWorktree: string
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>
  togglePinSession: WorkspaceSidebarViewProps['togglePinSession']
  visibleSessions: SessionListItem[]
}) {
  return (
    <div className="project-session-list">
      {visibleSessions.length === 0 ? <p>No sessions yet</p> : null}
      {displayedSessions.map(session => {
        const sessionDirectory = session.directory ?? projectWorktree
        const sessionTitle =
          getSessionTitle(session.id, sessionDirectory, session.title ?? session.slug) ??
          session.title ??
          session.slug
        return (
          <WorkspaceSessionRow
            key={`${sessionDirectory}:${session.id}`}
            now={now}
            projectDirectory={projectWorktree}
            session={session}
            sessionTitle={sessionTitle}
            activeSessionID={activeSessionID}
            pinnedSessionsByProject={pinnedSessionsByProject}
            getSessionIndicator={getSessionIndicator}
            getSessionType={getSessionType}
            openSession={openSession}
            archiveSession={archiveSession}
            togglePinSession={togglePinSession}
            openSessionContextMenu={openSessionContextMenu}
          />
        )
      })}
      {visibleSessions.length > 4 ? (
        <button type="button" className="project-sessions-more" onClick={() => setAllSessionsModalOpen(true)}>
          View all
        </button>
      ) : null}
    </div>
  )
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
      onContextMenu={event =>
        openSessionContextMenu(event, sessionDirectory, session.id, sessionTitle)
      }
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
            <SessionTypeIcon sessionType={sessionType} />
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

export function WorkspaceProjectItem({
  now,
  project,
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
  openCodexSessionBrowser,
  openSession,
  togglePinSession,
  archiveSession,
  openProjectContextMenu,
  openSessionContextMenu,
  pickerOpenForProject,
  setPickerOpenForProject,
  pickerAnchorRef,
}: WorkspaceSidebarProjectItemProps) {
  const projectLabel = project.name || project.worktree.split('/').at(-1) || project.worktree
  const isActiveProject = project.worktree === activeProjectDir
  const isExpanded = !collapsedProjects[project.worktree]
  const hiddenSessionIDs = new Set(hiddenSessionIDsByProject?.[project.worktree] ?? [])
  const pinnedSessionIDs = new Set(pinnedSessionsByProject?.[project.worktree] ?? [])
  const projectSessions = isActiveProject ? sessions : (cachedSessionsByProject?.[project.worktree] ?? [])
  const visibleProjectSessions = projectSessions.filter(
    session => !hiddenSessionIDs.has(session.id) && !pinnedSessionIDs.has(session.id)
  )
  const visibleSessions = isExpanded ? visibleProjectSessions : []
  const displayedSessions = selectDisplayedSessions(visibleProjectSessions, activeSessionID)

  return (
    <article
      className={`project-item ${isActiveProject ? 'active' : ''}`.trim()}
      onContextMenu={event => openProjectContextMenu(event, project.worktree, projectLabel)}
    >
      <WorkspaceProjectHeader
        isActiveProject={isActiveProject}
        isExpanded={isExpanded}
        pickerAnchorRef={pickerAnchorRef}
        pickerOpenForProject={pickerOpenForProject}
        project={project}
        projectLabel={projectLabel}
        selectProject={selectProject}
        setCollapsedProjects={setCollapsedProjects}
        setPickerOpenForProject={setPickerOpenForProject}
        setAllSessionsModalOpen={setAllSessionsModalOpen}
        createSession={createSession}
        openClaudeSessionBrowser={openClaudeSessionBrowser}
        openCodexSessionBrowser={openCodexSessionBrowser}
      />
      {isExpanded ? (
        <WorkspaceProjectSessionList
          activeSessionID={activeSessionID}
          archiveSession={archiveSession}
          displayedSessions={displayedSessions}
          getSessionIndicator={getSessionIndicator}
          getSessionTitle={getSessionTitle}
          getSessionType={getSessionType}
          now={now}
          openSession={openSession}
          openSessionContextMenu={openSessionContextMenu}
          pinnedSessionsByProject={pinnedSessionsByProject}
          projectWorktree={project.worktree}
          setAllSessionsModalOpen={setAllSessionsModalOpen}
          togglePinSession={togglePinSession}
          visibleSessions={visibleSessions}
        />
      ) : null}
    </article>
  )
}
