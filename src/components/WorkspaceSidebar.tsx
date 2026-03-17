import { useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { Bot, ChevronDown, ChevronRight, LayoutDashboard, LayoutGrid, CirclePlay, Zap, Brain, Search } from "lucide-react";
import type { ProjectListItem } from "@shared/ipc";
import type { SessionType } from "../types/canvas";
import { IconButton } from "./IconButton";
import { NewSessionPicker } from "./NewSessionPicker";

type SidebarMode = "projects" | "jobs" | "skills" | "memory";
type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";

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
  updateInstallPending: boolean;
  onDownloadAndInstallUpdate: () => Promise<void> | void;
  openWorkspaceDashboard: () => void;
  projectSearchOpen: boolean;
  setProjectSearchOpen: Dispatch<SetStateAction<boolean>>;
  projectSortOpen: boolean;
  setProjectSortOpen: Dispatch<SetStateAction<boolean>>;
  projectSortMode: ProjectSortMode;
  setProjectSortMode: Dispatch<SetStateAction<ProjectSortMode>>;
  projectSearchInputRef: RefObject<HTMLInputElement | null>;
  projectSearchQuery: string;
  setProjectSearchQuery: Dispatch<SetStateAction<string>>;
  filteredProjects: ProjectListItem[];
  activeProjectDir?: string;
  collapsedProjects: Record<string, boolean>;
  setCollapsedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  sessions: SessionListItem[];
  activeSessionID?: string;
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>;
  getSessionStatusType: (sessionID: string, directory?: string) => string;
  sessionTypes: Record<string, SessionType>;
  sessionTitles: Record<string, string>;
  selectProject: (directory: string) => Promise<void> | void;
  createSession: (directory?: string, sessionType?: SessionType) => Promise<void> | void;
  openSession: (sessionID: string) => void;
  openProjectContextMenu: (event: ReactMouseEvent, directory: string, label: string) => void;
  openSessionContextMenu: (event: ReactMouseEvent, directory: string, sessionID: string, title: string) => void;
  addProjectDirectory: () => Promise<unknown> | unknown;
  onOpenDebugLogs: () => void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
};

export function WorkspaceSidebar({
  sidebarMode,
  setSidebarMode,
  unreadJobRunsCount,
  updateAvailableVersion,
  updateInstallPending,
  onDownloadAndInstallUpdate,
  openWorkspaceDashboard,
  projectSearchOpen,
  setProjectSearchOpen,
  projectSortOpen,
  setProjectSortOpen,
  projectSortMode,
  setProjectSortMode,
  projectSearchInputRef,
  projectSearchQuery,
  setProjectSearchQuery,
  filteredProjects,
  activeProjectDir,
  collapsedProjects,
  setCollapsedProjects,
  sessions,
  activeSessionID,
  setAllSessionsModalOpen,
  getSessionStatusType,
  sessionTypes,
  sessionTitles,
  selectProject,
  createSession,
  openSession,
  openProjectContextMenu,
  openSessionContextMenu,
  addProjectDirectory,
  onOpenDebugLogs,
  setSettingsOpen,
}: WorkspaceSidebarProps) {
  const [updateButtonHovered, setUpdateButtonHovered] = useState(false);
  const [pickerOpenForProject, setPickerOpenForProject] = useState<string | null>(null);
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);

  return (
    <aside className="sidebar projects-pane">
      <div className="sidebar-inner">

        {/* Logo */}
        <div className="sidebar-logo">
          <span className="sidebar-logo-symbol">~</span>
          <span className="sidebar-logo-name">orxa</span>
        </div>

        {/* Update CTA (shown above mode tabs when update available) */}
        {updateAvailableVersion ? (
          <button
            type="button"
            className={`sidebar-update-cta ${updateInstallPending ? "active" : ""}`.trim()}
            onMouseEnter={() => setUpdateButtonHovered(true)}
            onMouseLeave={() => setUpdateButtonHovered(false)}
            onClick={() => void onDownloadAndInstallUpdate()}
            disabled={updateInstallPending}
            title={`Version ${updateAvailableVersion}`}
          >
            <span>{updateInstallPending ? "Updating..." : updateButtonHovered ? "Update now" : "Update available"}</span>
            <small>{updateAvailableVersion}</small>
          </button>
        ) : null}

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
            className={sidebarMode === "memory" ? "active" : ""}
            onClick={() => setSidebarMode("memory")}
          >
            <Brain size={16} aria-hidden="true" />
            Memory
          </button>
        </nav>

        {/* Search bar */}
        <div className="sidebar-search" onClick={() => { setProjectSearchOpen((v) => !v); setProjectSortOpen(false); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setProjectSearchOpen((v) => !v); setProjectSortOpen(false); } }}>
          <Search size={14} aria-hidden="true" />
          <span className="sidebar-search-placeholder">search...</span>
        </div>

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
                  setProjectSearchOpen(false);
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

          {projectSearchOpen ? (
            <div className="project-search-popover">
              <input
                ref={projectSearchInputRef}
                placeholder="Search workspaces..."
                value={projectSearchQuery}
                onChange={(event) => setProjectSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setProjectSearchOpen(false);
                    setProjectSearchQuery("");
                  }
                }}
              />
              <div className="project-search-results">
                {filteredProjects.map((project) => (
                  <button
                    key={`search-${project.id}`}
                    type="button"
                    onClick={() => {
                      void selectProject(project.worktree);
                      setProjectSearchOpen(false);
                    }}
                    title={project.name || project.worktree.split("/").at(-1) || project.worktree}
                  >
                    {project.name || project.worktree.split("/").at(-1) || project.worktree}
                  </button>
                ))}
                {filteredProjects.length === 0 ? <p>No matching workspaces</p> : null}
              </div>
            </div>
          ) : null}

          <div className="project-list">
            {filteredProjects.map((project) => {
              const projectLabel = project.name || project.worktree.split("/").at(-1) || project.worktree;
              const isActiveProject = project.worktree === activeProjectDir;
              const isExpanded = isActiveProject && !collapsedProjects[project.worktree];
              const visibleSessions = isExpanded ? sessions : [];
              const displayedSessions = (() => {
                const first = visibleSessions.slice(0, 4);
                if (!activeSessionID || first.some((session) => session.id === activeSessionID)) {
                  return first;
                }
                const active = visibleSessions.find((session) => session.id === activeSessionID);
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
                      className={`project-select ${isActiveProject ? "active" : ""}`.trim()}
                      onClick={() => {
                        if (isActiveProject) {
                          setCollapsedProjects((current) => ({
                            ...current,
                            [project.worktree]: !current[project.worktree],
                          }));
                          return;
                        }
                        void selectProject(project.worktree);
                      }}
                      title={projectLabel}
                    >
                      <span className="project-row-arrow" aria-hidden="true">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </span>
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
                        const status = getSessionStatusType(session.id, project.worktree);
                        const busy = status === "busy" || status === "retry";
                        const awaiting = status === "awaiting" || status === "permission" || status === "question";
                        return (
                          <button
                            type="button"
                            key={session.id}
                            className={session.id === activeSessionID ? "active" : ""}
                            onClick={() => openSession(session.id)}
                            onContextMenu={(event) =>
                              openSessionContextMenu(event, project.worktree, session.id, sessionTitles[session.id] ?? session.title ?? session.slug)
                            }
                            title={sessionTitles[session.id] ?? session.title ?? session.slug}
                          >
                            {awaiting ? (
                              <span className="session-status-indicator awaiting" aria-hidden="true" />
                            ) : sessionTypes[session.id] === "canvas" ? (
                              <span className="session-type-icon session-type-icon--canvas" aria-hidden="true">
                                <LayoutGrid size={10} />
                              </span>
                            ) : sessionTypes[session.id] === "claude" ? (
                              <span className="session-type-icon session-type-icon--claude" aria-hidden="true">
                                <Bot size={10} />
                              </span>
                            ) : sessionTypes[session.id] === "codex" ? (
                              <span className="session-type-icon session-type-icon--codex" aria-hidden="true">
                                <Zap size={10} />
                              </span>
                            ) : (
                              <span
                                className={`session-status-indicator ${busy ? "busy" : "idle"}`}
                                aria-hidden="true"
                              />
                            )}
                            <span>{sessionTitles[session.id] ?? session.title ?? session.slug}</span>
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

        {/* Footer */}
        <div className="sidebar-footer-actions">
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
        <Brain size={18} />
      </div>

    </aside>
  );
}
