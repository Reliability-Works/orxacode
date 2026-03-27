import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, LayoutDashboard, Rows3, Zap, Brain, Search, Archive, Pin } from "lucide-react";

import type { ProjectListItem } from "@shared/ipc";
import type { SessionType } from "../types/canvas";
import type { AppShellUpdateStatusMessage } from "../hooks/useAppShellUpdateFlow";
import { IconButton } from "./IconButton";
import { NewSessionPicker } from "./NewSessionPicker";
import { AnthropicLogo, CanvasLogo, OpenAILogo, OpenCodeLogo } from "./ProviderLogos";

type SidebarMode = "projects" | "kanban" | "skills";
type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";
type SessionSidebarIndicator = "busy" | "awaiting" | "unread" | "none";

type SessionListItem = {
  id: string;
  title?: string;
  slug: string;
  time: {
    created: number;
    updated: number;
  };
};

export type WorkspaceSidebarProps = {
  sidebarMode: SidebarMode;
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>;
  unreadJobRunsCount: number;
  updateAvailableVersion: string | null;
  isCheckingForUpdates: boolean;
  updateInstallPending: boolean;
  updateStatusMessage: AppShellUpdateStatusMessage | null;
  onCheckForUpdates: () => Promise<void> | void;
  onDownloadAndInstallUpdate: () => Promise<void> | void;
  openWorkspaceDashboard: () => void;
  projectSortOpen: boolean;
  setProjectSortOpen: Dispatch<SetStateAction<boolean>>;
  projectSortMode: ProjectSortMode;
  setProjectSortMode: Dispatch<SetStateAction<ProjectSortMode>>;
  filteredProjects: ProjectListItem[];
  activeProjectDir?: string;
  collapsedProjects: Record<string, boolean>;
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  sessions: SessionListItem[];
  cachedSessionsByProject?: Record<string, SessionListItem[]>;
  hiddenSessionIDsByProject?: Record<string, string[]>;
  pinnedSessionsByProject?: Record<string, string[]>;
  activeSessionID?: string;
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>;
  getSessionTitle: (sessionID: string, directory?: string, fallbackTitle?: string) => string | undefined;
  getSessionType: (sessionID: string, directory?: string) => SessionType | undefined;
  getSessionIndicator: (sessionID: string, directory: string, updatedAt: number) => SessionSidebarIndicator;
  selectProject: (directory: string) => Promise<void> | void;
  createSession: (directory?: string, sessionType?: SessionType) => Promise<void> | void;
  openSession: (directory: string, sessionID: string) => Promise<void> | void;
  togglePinSession: (directory: string, sessionID: string) => void;
  archiveSession: (directory: string, sessionID: string) => Promise<void> | void;
  openProjectContextMenu: (event: ReactMouseEvent, directory: string, label: string) => void;
  openSessionContextMenu: (event: ReactMouseEvent, directory: string, sessionID: string, title: string) => void;
  addProjectDirectory: () => Promise<unknown> | unknown;
  onOpenMemoryModal: () => void;
  onOpenSearchModal: () => void;
  onOpenDebugLogs: () => void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
};

export function WorkspaceSidebar({
  sidebarMode,
  setSidebarMode,
  unreadJobRunsCount,
  updateAvailableVersion,
  isCheckingForUpdates,
  updateInstallPending,
  updateStatusMessage,
  onCheckForUpdates,
  onDownloadAndInstallUpdate,
  openWorkspaceDashboard,
  projectSortOpen,
  setProjectSortOpen,
  projectSortMode,
  setProjectSortMode,
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
  openSession,
  togglePinSession,
  archiveSession,
  openProjectContextMenu,
  openSessionContextMenu,
  addProjectDirectory,
  onOpenMemoryModal,
  onOpenSearchModal,
  onOpenDebugLogs,
  setSettingsOpen,
}: WorkspaceSidebarProps) {
  const [pickerOpenForProject, setPickerOpenForProject] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const updateButtonLabel = isCheckingForUpdates
    ? "Checking for updates"
    : updateInstallPending
      ? "Downloading update"
      : updateAvailableVersion
        ? `Download ${updateAvailableVersion} now`
        : "Check for updates";

  const pinnedSessionRows = useMemo(() => {
    return filteredProjects.flatMap((project) => {
      const projectSessions = project.worktree === activeProjectDir
        ? sessions
        : (cachedSessionsByProject?.[project.worktree] ?? []);
      const hiddenSessionIDs = new Set(hiddenSessionIDsByProject?.[project.worktree] ?? []);
      const pinnedSessionIDs = pinnedSessionsByProject?.[project.worktree] ?? [];

      return pinnedSessionIDs
        .map((sessionID) => projectSessions.find((session) => session.id === sessionID))
        .filter((session): session is SessionListItem => session !== undefined)
        .filter((session) => !hiddenSessionIDs.has(session.id))
        .map((session) => ({
          directory: project.worktree,
          session,
        }));
    });
  }, [activeProjectDir, cachedSessionsByProject, filteredProjects, hiddenSessionIDsByProject, pinnedSessionsByProject, sessions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const formatSessionAge = (createdAt: number) => {
    const elapsedMs = Math.max(60_000, now - createdAt);
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w`;
  };

  const renderSessionTypeIcon = (sessionType: SessionType | undefined) => {
    switch (sessionType) {
      case "canvas":
        return <span className="session-type-icon session-type-icon--canvas" aria-hidden="true"><CanvasLogo size={10} /></span>;
      case "codex":
        return <span className="session-type-icon session-type-icon--codex" aria-hidden="true"><OpenAILogo size={10} /></span>;
      case "claude":
      case "claude-chat":
        return <span className="session-type-icon session-type-icon--claude" aria-hidden="true"><AnthropicLogo size={10} /></span>;
      case "standalone":
      default:
        return <span className="session-type-icon session-type-icon--opencode" aria-hidden="true"><OpenCodeLogo size={10} /></span>;
    }
  };

  const renderSessionRow = (
    directory: string,
    session: SessionListItem,
    sessionTitle: string,
  ) => {
    const indicator = getSessionIndicator(session.id, directory, session.time.updated);
    const sessionType = getSessionType(session.id, directory);
    const isPinned = (pinnedSessionsByProject?.[directory] ?? []).includes(session.id);
    const sessionAge = formatSessionAge(session.time.created);

    return (
      <div
        key={`${directory}:${session.id}`}
        className={`workspace-session-row ${session.id === activeSessionID ? "active" : ""}`.trim()}
        onContextMenu={(event) => openSessionContextMenu(event, directory, session.id, sessionTitle)}
      >
        <span className="workspace-session-row-pin-slot">
          <button
            type="button"
            className={`workspace-session-row-action${isPinned ? " is-active" : ""}`.trim()}
            aria-label={isPinned ? `Unpin ${sessionTitle}` : `Pin ${sessionTitle}`}
            title={isPinned ? "Unpin session" : "Pin session"}
            onClick={(event) => {
              event.stopPropagation();
              togglePinSession(directory, session.id);
            }}
          >
            <Pin size={11} aria-hidden="true" />
          </button>
        </span>
        <button
          type="button"
          className={session.id === activeSessionID ? "active workspace-session-row-main-button" : "workspace-session-row-main-button"}
          onClick={() => void openSession(directory, session.id)}
          title={sessionTitle}
        >
          <span className="workspace-session-row-leading" aria-hidden="true">
            {indicator === "none" ? renderSessionTypeIcon(sessionType) : (
              <span
                className={`session-status-indicator ${indicator}`}
                aria-hidden="true"
              >
                {indicator === "awaiting" ? "!" : null}
              </span>
            )}
          </span>
          <span className="workspace-session-row-title-text">{sessionTitle}</span>
        </button>
        <span className="workspace-session-row-trailing">
          <span className="workspace-session-row-age" aria-label={`${sessionAge} old`}>{sessionAge}</span>
          <span className="workspace-session-row-actions">
            <button
              type="button"
              className="workspace-session-row-action workspace-session-row-action--archive"
              aria-label={`Archive ${sessionTitle}`}
              title="Archive session"
            onClick={(event) => {
              event.stopPropagation();
              void archiveSession(directory, session.id);
              }}
            >
              <Archive size={11} aria-hidden="true" />
            </button>
          </span>
        </span>
      </div>
    );
  };

  return (
    <aside className="sidebar projects-pane">
      <div className="sidebar-inner">

        {/* Mode nav tabs */}
        <nav className="sidebar-mode-links" aria-label="Sidebar mode">
          <button
            type="button"
            className={sidebarMode === "projects" && !activeProjectDir ? "active" : ""}
            onClick={openWorkspaceDashboard}
          >
            <LayoutDashboard size={16} aria-hidden="true" />
            Dashboard
          </button>
          <button
            type="button"
            className={sidebarMode === "kanban" ? "active" : ""}
            onClick={() => setSidebarMode("kanban")}
          >
            <Rows3 size={16} aria-hidden="true" />
            Orxa KanBan
            <span className="sidebar-mode-warning">Experimental</span>
            {unreadJobRunsCount > 0 ? <span className="sidebar-mode-badge">{unreadJobRunsCount}</span> : null}
          </button>
          <button
            type="button"
            className={sidebarMode === "skills" ? "active" : ""}
            onClick={() => setSidebarMode("skills")}
          >
            <Zap size={16} aria-hidden="true" />
            Skills
          </button>
          <button
            type="button"
            onClick={onOpenSearchModal}
          >
            <Search size={16} aria-hidden="true" />
            Search
          </button>
          <button
            type="button"
            onClick={onOpenMemoryModal}
          >
            <Brain size={16} aria-hidden="true" />
            Memory
          </button>
        </nav>

        {/* Workspaces section */}
        <div className="sidebar-workspaces-section">
          <div className="pane-header">
            <h2>Workspaces</h2>
            <div className="pane-header-actions">
              <IconButton
                icon="sort"
                className="pane-action-icon"
                label={projectSortOpen ? "Close sort options" : "Sort workspaces"}
                onClick={() => {
                  setProjectSortOpen((value) => !value);
                }}
              />
              <IconButton icon="folderPlus" className="pane-action-icon" label="Add workspace folder" onClick={() => void addProjectDirectory()} />
            </div>
          </div>

          {projectSortOpen ? (
            <div className="project-sort-popover">
              <button
                type="button"
                className={projectSortMode === "updated" ? "active" : ""}
                onClick={() => {
                  setProjectSortMode("updated");
                  setProjectSortOpen(false);
                }}
              >
                Last updated
              </button>
              <button
                type="button"
                className={projectSortMode === "recent" ? "active" : ""}
                onClick={() => {
                  setProjectSortMode("recent");
                  setProjectSortOpen(false);
                }}
              >
                Most recent
              </button>
              <button
                type="button"
                className={projectSortMode === "alpha-asc" ? "active" : ""}
                onClick={() => {
                  setProjectSortMode("alpha-asc");
                  setProjectSortOpen(false);
                }}
              >
                Alphabetical (A-Z)
              </button>
              <button
                type="button"
                className={projectSortMode === "alpha-desc" ? "active" : ""}
                onClick={() => {
                  setProjectSortMode("alpha-desc");
                  setProjectSortOpen(false);
                }}
              >
                Alphabetical (Z-A)
              </button>
            </div>
          ) : null}

          {pinnedSessionRows.length > 0 ? (
            <div className="sidebar-pinned-sessions-section">
              <div className="sidebar-subsection-label">Pinned</div>
              <div className="project-session-list project-session-list--pinned">
                {pinnedSessionRows.map(({ directory, session }) => {
                  const sessionTitle = getSessionTitle(
                    session.id,
                    directory,
                    session.title ?? session.slug,
                  ) ?? session.title ?? session.slug;
                  return renderSessionRow(directory, session, sessionTitle);
                })}
              </div>
            </div>
          ) : null}

          <div className="project-list">
            {filteredProjects.map((project) => {
              const projectLabel = project.name || project.worktree.split("/").at(-1) || project.worktree;
              const isActiveProject = project.worktree === activeProjectDir;
              const isExpanded = !collapsedProjects[project.worktree];
              const hiddenSessionIDs = new Set(hiddenSessionIDsByProject?.[project.worktree] ?? []);
              // Use active sessions for active project, cached sessions for others
              const projectSessions = isActiveProject
                ? sessions
                : (cachedSessionsByProject?.[project.worktree] ?? []);
              const visibleProjectSessions = projectSessions.filter((session) => !hiddenSessionIDs.has(session.id));
              const visibleSessions = isExpanded ? visibleProjectSessions : [];
              const displayedSessions = (() => {
                const first = visibleProjectSessions.slice(0, 4);
                if (!activeSessionID || first.some((session) => session.id === activeSessionID)) {
                  return first;
                }
                const active = visibleProjectSessions.find((session) => session.id === activeSessionID);
                if (!active) {
                  return first;
                }
                return [active, ...first.slice(0, 3)];
              })();
              return (
                <article
                  key={project.id}
                  className={`project-item ${isActiveProject ? "active" : ""}`.trim()}
                  onContextMenu={(event) => openProjectContextMenu(event, project.worktree, projectLabel)}
                >
                  <div className="project-item-header">
                    <button
                      type="button"
                      className="project-row-chevron-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCollapsedProjects((current) => ({
                          ...current,
                          [project.worktree]: !current[project.worktree],
                        }));
                      }}
                      aria-label={isExpanded ? `Collapse ${projectLabel}` : `Expand ${projectLabel}`}
                      title={isExpanded ? "Collapse workspace" : "Expand workspace"}
                    >
                      <span className="project-row-arrow" aria-hidden="true">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`project-select ${isActiveProject ? "active" : ""}`.trim()}
                      onClick={() => {
                        if (isActiveProject) {
                          void selectProject(project.worktree);
                          return;
                        }

                        if (!isActiveProject) {
                          void selectProject(project.worktree);
                        }
                      }}
                      title={projectLabel}
                    >
                      <span className="project-status-dot" aria-hidden="true" />
                      <span className="project-label-text">{projectLabel}</span>
                    </button>
                    <div className="project-add-session-wrapper">
                      <button
                        ref={(el) => {
                          if (pickerOpenForProject === project.worktree) {
                            pickerAnchorRef.current = el;
                          }
                        }}
                        type="button"
                        className="project-add-session"
                        onClick={(event) => {
                          event.stopPropagation();
                          setPickerOpenForProject((current) =>
                            current === project.worktree ? null : project.worktree,
                          );
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
                        onPick={(sessionType) => {
                          setPickerOpenForProject(null);
                          void createSession(project.worktree, sessionType);
                        }}
                        onClose={() => setPickerOpenForProject(null)}
                      />
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="project-session-list">
                      {visibleSessions.length === 0 ? <p>No sessions yet</p> : null}
                      {displayedSessions.map((session) => {
                        const sessionTitle = getSessionTitle(
                          session.id,
                          project.worktree,
                          session.title ?? session.slug,
                        ) ?? session.title ?? session.slug;
                        return renderSessionRow(project.worktree, session, sessionTitle);
                      })}
                      {visibleSessions.length > 4 ? (
                        <button type="button" className="project-sessions-more" onClick={() => setAllSessionsModalOpen(true)}>
                          View all
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>

        {/* Update card */}
        {updateAvailableVersion ? (
          <button
            type="button"
            className={`sidebar-update-card ${updateInstallPending ? "is-downloading" : ""}`.trim()}
            onClick={() => void onDownloadAndInstallUpdate()}
            disabled={updateInstallPending}
          >
            <span className="sidebar-update-card-title">
              {updateInstallPending ? "Downloading update..." : "Update available"}
            </span>
            <span className="sidebar-update-card-version">
              {updateInstallPending ? "" : `v${updateAvailableVersion} — tap to install`}
            </span>
          </button>
        ) : null}

        {/* Footer */}
        <div className="sidebar-footer-actions">
          <div className="sidebar-footer-update">
            {updateStatusMessage && !updateAvailableVersion ? (
              <div className={`sidebar-update-status sidebar-update-status--${updateStatusMessage.tone}`.trim()}>
                {updateStatusMessage.text}
              </div>
            ) : (
              <div className="sidebar-update-status sidebar-update-status--placeholder" aria-hidden="true">
                &nbsp;
              </div>
            )}
            <IconButton
              icon="refresh"
              label={updateButtonLabel}
              className={`sidebar-update-button ${isCheckingForUpdates ? "is-spinning" : ""}`.trim()}
              onClick={() => void (updateAvailableVersion ? onDownloadAndInstallUpdate() : onCheckForUpdates())}
              disabled={isCheckingForUpdates || updateInstallPending}
            />
          </div>
          <IconButton icon="log" label="Debug logs" onClick={onOpenDebugLogs} />
          <IconButton icon="settings" label="Config" onClick={() => setSettingsOpen((value) => !value)} />
          <span className="sidebar-footer-spacer" />
        </div>

      </div>

      {/* Collapsed icon rail — shown when sidebar is collapsed to 48px */}
      <div className="sidebar-collapsed-rail" aria-hidden="true">
        <LayoutDashboard size={18} />
        <Rows3 size={18} />
        <Zap size={18} />
        <Search size={18} />
        <Brain size={18} />
      </div>

    </aside>
  );
}
