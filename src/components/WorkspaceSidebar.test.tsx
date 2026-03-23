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
    isCheckingForUpdates: false,
    updateInstallPending: false,
    updateStatusMessage: null,
    onCheckForUpdates: vi.fn(),
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
    onOpenMemoryModal: vi.fn(),
    onOpenDebugLogs: vi.fn(),
    setSettingsOpen: vi.fn(),
    ...overrides,
  };
}

describe("WorkspaceSidebar update button", () => {
  it("renders a footer check-for-updates button by default", () => {
    render(<WorkspaceSidebar {...buildProps()} />);

    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument();
    expect(screen.queryByText("Update found")).not.toBeInTheDocument();
  });

  it("calls update check when no update is available", () => {
    const onCheckForUpdates = vi.fn();
    render(<WorkspaceSidebar {...buildProps({ onCheckForUpdates })} />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it("shows update card and downloads when an update is available", () => {
    const onDownloadAndInstallUpdate = vi.fn();
    render(
      <WorkspaceSidebar
        {...buildProps({
          updateAvailableVersion: "0.1.0-beta.6",
          onDownloadAndInstallUpdate,
        })}
      />,
    );

    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0-beta\.6/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Update available").closest("button")!);
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

    const updatingButton = screen.getByRole("button", { name: "Downloading update" });
    expect(updatingButton).toBeDisabled();
  });

  it("shows checking state while a check is in progress", () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          isCheckingForUpdates: true,
        })}
      />,
    );

    const checkingButton = screen.getByRole("button", { name: "Checking for updates" });
    expect(checkingButton).toBeDisabled();
    expect(checkingButton.className).toContain("is-spinning");
  });

  it("opens debug logs from sidebar footer", () => {
    const onOpenDebugLogs = vi.fn();
    render(<WorkspaceSidebar {...buildProps({ onOpenDebugLogs })} />);

    fireEvent.click(screen.getByRole("button", { name: "Debug logs" }));
    expect(onOpenDebugLogs).toHaveBeenCalledTimes(1);
  });

  it("opens the coming soon memory modal from the sidebar", () => {
    const onOpenMemoryModal = vi.fn();
    render(<WorkspaceSidebar {...buildProps({ onOpenMemoryModal })} />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(onOpenMemoryModal).toHaveBeenCalledTimes(1);
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

  it("hides background-agent session ids from the workspace session list", () => {
    render(
      <WorkspaceSidebar
        {...buildProps({
          filteredProjects: [{ id: "project-1", worktree: "/workspace/project", name: "project", source: "local" }],
          activeProjectDir: "/workspace/project",
          sessions: [{
            id: "session-main",
            slug: "session-main",
            title: "Main session",
            time: { updated: 2 },
          }, {
            id: "session-subagent",
            slug: "session-subagent",
            title: "Subagent session",
            time: { updated: 3 },
          }],
          hiddenSessionIDsByProject: {
            "/workspace/project": ["session-subagent"],
          },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Main session" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subagent session" })).toBeNull();
  });
});
