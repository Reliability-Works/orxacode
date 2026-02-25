import { type Dispatch, type MouseEvent as ReactMouseEvent, type RefObject, type SetStateAction } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AppMode, ProjectListItem } from "@shared/ipc";
import { IconButton } from "./IconButton";

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
  appMode: AppMode;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  sidebarMode: SidebarMode;
  setSidebarMode: Dispatch<SetStateAction<SidebarMode>>;
  unreadJobRunsCount: number;
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
  selectProject: (directory: string) => Promise<void> | void;
  createSession: (directory?: string) => Promise<void> | void;
  openSession: (sessionID: string) => void;
  openProjectContextMenu: (event: ReactMouseEvent, directory: string, label: string) => void;
  openSessionContextMenu: (event: ReactMouseEvent, directory: string, sessionID: string, title: string) => void;
  addProjectDirectory: () => Promise<unknown> | unknown;
  setProfileModalOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
};

export function WorkspaceSidebar({
  appMode,
  setAppMode,
  sidebarMode,
  setSidebarMode,
  unreadJobRunsCount,
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
  selectProject,
  createSession,
  openSession,
  openProjectContextMenu,
  openSessionContextMenu,
  addProjectDirectory,
  setProfileModalOpen,
  setSettingsOpen,
}: WorkspaceSidebarProps) {
  return (
    <aside className="sidebar projects-pane">
      <div className="sidebar-inner">
        <nav className="sidebar-mode-links" aria-label="Sidebar mode">
          <button
            type="button"
            className={sidebarMode === "projects" && !activeProjectDir ? "active" : ""}
            onClick={openWorkspaceDashboard}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={sidebarMode === "jobs" ? "active" : ""}
            onClick={() => setSidebarMode("jobs")}
          >
            Jobs
            {unreadJobRunsCount > 0 ? <span className="sidebar-mode-badge">{unreadJobRunsCount}</span> : null}
          </button>
          <button
            type="button"
            className={sidebarMode === "memory" ? "active" : ""}
            onClick={() => setSidebarMode("memory")}
          >
            Memory
          </button>
          <button
            type="button"
            className={sidebarMode === "skills" ? "active" : ""}
            onClick={() => setSidebarMode("skills")}
          >
            Skills
          </button>
        </nav>
      <>
          <div className="pane-header">
            <h2>Workspaces</h2>
            <div className="pane-header-actions">
              <IconButton
                icon="search"
                className="pane-action-icon"
                label={projectSearchOpen ? "Close search" : "Search workspaces"}
                onClick={() => {
                  setProjectSearchOpen((value) => !value);
                  setProjectSortOpen(false);
                }}
              />
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
                        if (isActiveProject && activeSessionID) {
                          openWorkspaceDashboard();
                          return;
                        }
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
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="project-label-text">{projectLabel}</span>
                    </button>
                    <button
                      type="button"
                      className="project-add-session"
                      onClick={(event) => {
                        event.stopPropagation();
                        void createSession(project.worktree);
                      }}
                      aria-label={`Create session for ${projectLabel}`}
                      title="New session"
                    >
                      +
                    </button>
                  </div>
                  {isExpanded ? (
                    <div className="project-session-list">
                      {visibleSessions.length === 0 ? <p>No sessions yet</p> : null}
                      {displayedSessions.map((session) => {
                        const status = getSessionStatusType(session.id, project.worktree);
                        const busy = status === "busy" || status === "retry";
                        const awaitingPermission = status === "permission";
                        return (
                          <button
                            type="button"
                            key={session.id}
                            className={session.id === activeSessionID ? "active" : ""}
                            onClick={() => openSession(session.id)}
                            onContextMenu={(event) =>
                              openSessionContextMenu(event, project.worktree, session.id, session.title || session.slug)
                            }
                            title={session.title || session.slug}
                          >
                            <span
                              className={`session-status-indicator ${awaitingPermission ? "attention" : busy ? "busy" : "idle"}`}
                              aria-hidden="true"
                            >
                              {awaitingPermission ? "!" : null}
                            </span>
                            <span>{session.title || session.slug}</span>
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
        </>
      

      <div className="sidebar-footer-actions">
        <IconButton
          icon={appMode === "orxa" ? "orxa" : "standard"}
          label={appMode === "orxa" ? "Orxa Mode (click to switch to Standard)" : "Standard Mode (click to switch to Orxa)"}
          onClick={() => {
            const nextMode = appMode === "orxa" ? "standard" : "orxa";
            void window.orxa.mode.set(nextMode);
            setAppMode(nextMode);
          }}
        />
        <IconButton icon="profiles" label="Profiles" onClick={() => setProfileModalOpen(true)} />
        <IconButton icon="settings" label="Config" onClick={() => setSettingsOpen((value) => !value)} />
      </div>
      </div>
    </aside>
  );
}
