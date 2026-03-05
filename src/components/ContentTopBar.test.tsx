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
      gitDiffStats: { additions: 0, deletions: 0, filesChanged: 0, hasChanges: false },
      contentPaneTitle: "Workspace",
      showingProjectDashboard: true,
      activeProjectDir: "/tmp/workspace",
      projectData: null,
      terminalOpen: false,
      toggleTerminal: vi.fn(async () => undefined),
      artifactsOpen: false,
      onToggleArtifacts: vi.fn(),
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
      activeOpenTarget: { id: "finder" as const, label: "Finder", logo: "/finder.png" },
      openTargets: [
        { id: "cursor" as const, label: "Cursor", logo: "/cursor.png" },
        { id: "finder" as const, label: "Finder", logo: "/finder.png" },
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

    fireEvent.click(screen.getByRole("button", { name: "Cursor" }));

    expect(onSelectOpenTarget).toHaveBeenCalledWith("cursor");
    expect(openDirectoryInTarget).not.toHaveBeenCalled();
  });

  it("launches active target when main open button is clicked", () => {
    const { props, openDirectoryInTarget } = buildProps();
    render(<ContentTopBar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Finder" }));

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
});
