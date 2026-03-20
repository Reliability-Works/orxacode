import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar, type WorkspaceSidebarProps } from "./WorkspaceSidebar";

afterEach(() => {
  cleanup();
});

function buildProps(overrides: Partial<WorkspaceSidebarProps> = {}): WorkspaceSidebarProps {
  return {
    sidebarMode: "projects",
    setSidebarMode: vi.fn(),
    unreadJobRunsCount: 0,
    updateAvailableVersion: null,
    updateInstallPending: false,
    onDownloadAndInstallUpdate: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    projectSearchOpen: false,
    setProjectSearchOpen: vi.fn(),
    projectSortOpen: false,
    setProjectSortOpen: vi.fn(),
    projectSortMode: "updated",
    setProjectSortMode: vi.fn(),
    projectSearchInputRef: { current: null },
    projectSearchQuery: "",
    setProjectSearchQuery: vi.fn(),
    filteredProjects: [],
    activeProjectDir: undefined,
    collapsedProjects: {},
    setCollapsedProjects: vi.fn(),
    sessions: [],
    activeSessionID: undefined,
    setAllSessionsModalOpen: vi.fn(),
    getSessionTitle: vi.fn((_, __, fallbackTitle) => fallbackTitle),
    getSessionIndicator: vi.fn(() => "none" as const),
    selectProject: vi.fn(),
    createSession: vi.fn(),
    openSession: vi.fn(),
    openProjectContextMenu: vi.fn(),
    openSessionContextMenu: vi.fn(),
    addProjectDirectory: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    setSettingsOpen: vi.fn(),
    ...overrides,
  };
}

describe("WorkspaceSidebar update CTA", () => {
  it("renders the update action above Dashboard and toggles label on hover", () => {
    render(<WorkspaceSidebar {...buildProps({ updateAvailableVersion: "0.1.0-beta.6" })} />);

    const updateButton = screen.getByRole("button", { name: /^Update available/ });
    const dashboardButton = screen.getByRole("button", { name: "Dashboard" });
    expect(updateButton.compareDocumentPosition(dashboardButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.mouseEnter(updateButton);
    expect(screen.getByRole("button", { name: /^Update now/ })).toBeInTheDocument();

    fireEvent.mouseLeave(updateButton);
    expect(screen.getByRole("button", { name: /^Update available/ })).toBeInTheDocument();
  });

  it("calls update action when the CTA is clicked", () => {
    const onDownloadAndInstallUpdate = vi.fn();
    render(<WorkspaceSidebar {...buildProps({ updateAvailableVersion: "0.1.0-beta.6", onDownloadAndInstallUpdate })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Update available/ }));
    expect(onDownloadAndInstallUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows pending state while an update install is active", () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: "0.1.0-beta.6",
          updateInstallPending: true,
        })}
      />,
    );

    const updatingButton = screen.getByRole("button", { name: /^Updating\.\.\./ });
    expect(updatingButton).toBeDisabled();
  });

  it("opens debug logs from sidebar footer", () => {
    const onOpenDebugLogs = vi.fn();
    render(<WorkspaceSidebar {...buildProps({ onOpenDebugLogs })} />);

    fireEvent.click(screen.getByRole("button", { name: "Debug logs" }));
    expect(onOpenDebugLogs).toHaveBeenCalledTimes(1);
  });

  it("shows awaiting and unread indicators for session rows", () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [{ id: "project-1", worktree: "/workspace/project", name: "project", source: "local" }],
          activeProjectDir: "/workspace/project",
          sessions: [{
            id: "session-awaiting",
            slug: "session-awaiting",
            title: "Needs input",
            time: { updated: 2 },
          }, {
            id: "session-unread",
            slug: "session-unread",
            title: "Unread output",
            time: { updated: 3 },
          }],
          getSessionIndicator: vi.fn((sessionID) => {
            if (sessionID === "session-awaiting") return "awaiting";
            if (sessionID === "session-unread") return "unread";
            return "none";
          }) as WorkspaceSidebarProps["getSessionIndicator"],
        })}
      />,
    );

    expect(document.querySelector(".session-status-indicator.awaiting")?.textContent).toBe("!");
    expect(document.querySelector(".session-status-indicator.unread")).toBeInTheDocument();
  });

  it("opens the workspace landing view when clicking the active workspace header from a session", () => {
    const selectProject = vi.fn();
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [{ id: "project-1", worktree: "/workspace/project", name: "project", source: "local" }],
          activeProjectDir: "/workspace/project",
          activeSessionID: "session-1",
          selectProject,
          sessions: [{
            id: "session-1",
            slug: "session-1",
            title: "Current session",
            time: { updated: 1 },
          }],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "project" }));
    expect(selectProject).toHaveBeenCalledWith("/workspace/project");
  });

  it("routes session clicks through openSession with the target workspace", () => {
    const openSession = vi.fn();
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [{ id: "project-1", worktree: "/workspace/project", name: "project", source: "local" }],
          activeProjectDir: "/workspace/other",
          cachedSessionsByProject: {
            "/workspace/project": [{
              id: "session-2",
              slug: "session-2",
              title: "Open me",
              time: { updated: 2 },
            }],
          },
          openSession,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open me" }));
    expect(openSession).toHaveBeenCalledWith("/workspace/project", "session-2");
  });
});
