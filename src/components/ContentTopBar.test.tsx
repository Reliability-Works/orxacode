import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContentTopBar } from "./ContentTopBar";

function buildProps() {
  const onSelectOpenTarget = vi.fn();
  const openDirectoryInTarget = vi.fn(async () => undefined);

  return {
    props: {
      projectsPaneVisible: true,
      toggleProjectsPane: vi.fn(),
      showGitPane: true,
      setGitPaneVisible: vi.fn(),
      browserSidebarOpen: false,
      toggleBrowserSidebar: vi.fn(),
      gitDiffStats: { additions: 0, deletions: 0, filesChanged: 0, hasChanges: false },
      contentPaneTitle: "Workspace",
      activeProjectDir: "/tmp/workspace",
      projectData: null,
      terminalOpen: false,
      toggleTerminal: vi.fn(async () => undefined),
      titleMenuOpen: false,
      openMenuOpen: false,
      setOpenMenuOpen: vi.fn(),
      commitMenuOpen: false,
      setCommitMenuOpen: vi.fn(),
      setTitleMenuOpen: vi.fn(),
      hasActiveSession: true,
      isActiveSessionPinned: false,
      onTogglePinSession: vi.fn(),
      onRenameSession: vi.fn(),
      onArchiveSession: vi.fn(),
      onViewWorkspace: vi.fn(),
      onCopyPath: vi.fn(),
      onCopySessionId: vi.fn(),
      activeOpenTarget: { id: "finder" as const, label: "finder", logo: "/finder.png" },
      openTargets: [
        { id: "cursor" as const, label: "cursor", logo: "/cursor.png" },
        { id: "finder" as const, label: "finder", logo: "/finder.png" },
      ],
      onSelectOpenTarget,
      openDirectoryInTarget,
      openCommitModal: vi.fn(),
      pendingPrUrl: null,
      onOpenPendingPullRequest: vi.fn(),
      commitNextStepOptions: [],
      setCommitNextStep: vi.fn(),
      customRunCommands: [],
      onUpsertCustomRunCommand: vi.fn((input) => ({
        id: "custom-run",
        title: input.title,
        commands: input.commands,
        updatedAt: Date.now(),
      })),
      onRunCustomRunCommand: vi.fn(async () => undefined),
      onDeleteCustomRunCommand: vi.fn(),
    },
    onSelectOpenTarget,
    openDirectoryInTarget,
  };
}

describe("ContentTopBar open target control", () => {
  it("selects target from menu without launching app", () => {
    const { props, onSelectOpenTarget, openDirectoryInTarget } = buildProps();
    render(<ContentTopBar {...props} openMenuOpen setOpenMenuOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "cursor" }));

    expect(onSelectOpenTarget).toHaveBeenCalledWith("cursor");
    expect(openDirectoryInTarget).not.toHaveBeenCalled();
  });

  it("launches active target when main open button is clicked", () => {
    const { props, openDirectoryInTarget } = buildProps();
    render(<ContentTopBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "finder" }));

    expect(openDirectoryInTarget).toHaveBeenCalledWith("finder");
  });

  it("opens run editor when no custom command exists", () => {
    const { props } = buildProps();
    render(<ContentTopBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Custom run command" }));

    expect(screen.getByRole("dialog", { name: "Run" })).toBeInTheDocument();
  });

  it("closes run editor with the close button", () => {
    const { props } = buildProps();
    render(<ContentTopBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Custom run command" }));
    fireEvent.click(screen.getByRole("button", { name: "Close custom run command modal" }));

    expect(screen.queryByRole("dialog", { name: "Run" })).not.toBeInTheDocument();
  });

  it("renders saved commands in menu and allows running one", () => {
    const { props } = buildProps();
    const runMock = vi.fn(async () => undefined);
    render(
      <ContentTopBar
        {...props}
        customRunCommands={[
          { id: "install-run", title: "Install + Run", commands: "npm install\nnpm run dev", updatedAt: Date.now() },
        ]}
        onRunCustomRunCommand={runMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom run command" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Install + Run" }));

    expect(runMock).toHaveBeenCalledWith({
      id: "install-run",
      title: "Install + Run",
      commands: "npm install\nnpm run dev",
      updatedAt: expect.any(Number),
    });
  });

  it("deletes a saved command from the run menu", () => {
    const { props } = buildProps();
    const deleteMock = vi.fn();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ContentTopBar
        {...props}
        customRunCommands={[
          { id: "install-run", title: "Install + Run", commands: "npm install\nnpm run dev", updatedAt: Date.now() },
        ]}
        onDeleteCustomRunCommand={deleteMock}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom run command" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Install + Run" }));

    expect(confirmMock).toHaveBeenCalledWith('Delete custom run command "Install + Run"?');
    expect(deleteMock).toHaveBeenCalledWith("install-run");
    confirmMock.mockRestore();
  });

  it("hides the terminal toggle when the integrated terminal is unavailable", () => {
    const { props } = buildProps();
    render(<ContentTopBar {...props} showTerminalToggle={false} />);

    expect(screen.queryByRole("button", { name: "Toggle terminal" })).not.toBeInTheDocument();
  });

  it("toggles the browser sidebar from the top bar", () => {
    const { props } = buildProps();
    render(<ContentTopBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Open browser sidebar" }));

    expect(props.toggleBrowserSidebar).toHaveBeenCalledTimes(1);
  });

  it("shows the claude chat suffix for structured chat sessions", () => {
    const { props } = buildProps();
    render(<ContentTopBar {...props} activeSessionType="claude-chat" />);

    expect(screen.getByText("/ claude chat")).toBeInTheDocument();
  });
});
