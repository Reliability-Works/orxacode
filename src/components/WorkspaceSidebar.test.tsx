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
    getSessionStatusType: vi.fn(() => "idle"),
    sessionTypes: {},
    selectProject: vi.fn(),
    createSession: vi.fn(),
    openSession: vi.fn(),
    openProjectContextMenu: vi.fn(),
    openSessionContextMenu: vi.fn(),
    addProjectDirectory: vi.fn(),
    setProfileModalOpen: vi.fn(),
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
});
