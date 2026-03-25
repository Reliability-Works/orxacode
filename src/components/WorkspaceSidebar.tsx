import { useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, LayoutDashboard, CirclePlay, Zap, Brain, Search } from "lucide-react";

import type { ProjectListItem } from "@shared/ipc";
import type { SessionType } from "../types/canvas";
import type { AppShellUpdateStatusMessage } from "../hooks/useAppShellUpdateFlow";
import { IconButton } from "./IconButton";
import { NewSessionPicker } from "./NewSessionPicker";

type SidebarMode = "projects" | "jobs" | "skills";
type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";
type SessionSidebarIndicator = "busy" | "awaiting" | "unread" | "none";

type SessionListItem = {
  id: string;
  title?: string;
  slug: string;
  time: {
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
  activeSessionID?: string;
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>;
  getSessionTitle: (sessionID: string, directory?: string, fallbackTitle?: string) => string | undefined;
  getSessionIndicator: (sessionID: string, directory: string, updatedAt: number) => SessionSidebarIndicator;
  selectProject: (directory: string) => Promise<void> | void;
  createSession: (directory?: string, sessionType?: SessionType) => Promise<void> | void;
  openSession: (directory: string, sessionID: string) => Promise<void> | void;
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
  activeSessionID,
  setAllSessionsModalOpen,
  getSessionTitle,
  getSessionIndicator,
  selectProject,
  createSession,
  openSession,
  openProjectContextMenu,
  openSessionContextMenu,
  addProjectDirectory,
  onOpenMemoryModal,
  onOpenSearchModal,
  onOpenDebugLogs,
  setSettingsOpen,
}: WorkspaceSidebarProps) {
  const [pickerOpenForProject, setPickerOpenForProject] = useState<string | null>(null);
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const updateButtonLabel = isCheckingForUpdates
    ? "Checking for updates"
    : updateInstallPending
      ? "Downloading update"
      : updateAvailableVersion
        ? `Download ${updateAvailableVersion} now`
        : "Check for updates";

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
            className={sidebarMode === "jobs" ? "active" : ""}
            onClick={() => setSidebarMode("jobs")}
          >
            <CirclePlay size={16} aria-hidden="true" />
            Jobs
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
                        const indicator = getSessionIndicator(session.id, project.worktree, session.time.updated);
                        return (
                          <button
                            type="button"
                            key={session.id}
                            className={session.id === activeSessionID ? "active" : ""}
                            onClick={() => void openSession(project.worktree, session.id)}
                            onContextMenu={(event) =>
                              openSessionContextMenu(event, project.worktree, session.id, sessionTitle)
                            }
                            title={sessionTitle}
                          >
                            {indicator === "none" ? null : (
                              <span
                                className={`session-status-indicator ${indicator}`}
                                aria-hidden="true"
                              >
                                {indicator === "awaiting" ? "!" : null}
                              </span>
                            )}
                            <span>{sessionTitle}</span>
                          </button>
                        );
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
        <CirclePlay size={18} />
        <Zap size={18} />
        <Search size={18} />
        <Brain size={18} />
      </div>

    </aside>
  );
}
