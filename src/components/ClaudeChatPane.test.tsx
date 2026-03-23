import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeChatPane } from "./ClaudeChatPane";
import type { ClaudeChatSubagentState } from "../hooks/useClaudeChatSession";

const startTurnMock = vi.fn();
const archiveProviderSessionMock = vi.fn();
const loadSubagentMessagesMock = vi.fn(async () => []);
const onTitleChangeMock = vi.fn();
let mockSubagents: ClaudeChatSubagentState[] = [];

vi.mock("../hooks/useClaudeChatSession", () => ({
  useClaudeChatSession: () => ({
    messages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    subagents: mockSubagents,
    modelOptions: [
      {
        key: "claude-chat/claude-sonnet-4-6",
        providerID: "claude-chat",
        modelID: "claude-sonnet-4-6",
        providerName: "Claude",
        modelName: "Claude Sonnet 4.6",
        variants: [],
      },
    ],
    startTurn: startTurnMock,
    interruptTurn: vi.fn(),
    approveAction: vi.fn(),
    respondToUserInput: vi.fn(),
    archiveProviderSession: archiveProviderSessionMock,
    loadSubagentMessages: loadSubagentMessagesMock,
  }),
}));

vi.mock("./chat/VirtualizedTimeline", () => ({
  VirtualizedTimeline: ({ emptyState }: { emptyState: React.ReactNode }) => <div>{emptyState}</div>,
}));

vi.mock("./chat/UnifiedTimelineRow", () => ({
  UnifiedTimelineRowView: () => null,
}));

describe("ClaudeChatPane", () => {
  beforeEach(() => {
    startTurnMock.mockReset();
    archiveProviderSessionMock.mockReset();
    loadSubagentMessagesMock.mockReset();
    loadSubagentMessagesMock.mockResolvedValue([]);
    onTitleChangeMock.mockReset();
    mockSubagents = [];
  });

  it("shows the shared plan toggle and sends Claude plan mode when enabled", () => {
    render(
      <ClaudeChatPane
        directory="/tmp/project"
        sessionStorageKey="session-1"
        onTitleChange={onTitleChangeMock}
        permissionMode="ask-write"
        onPermissionModeChange={vi.fn()}
        branchMenuOpen={false}
        setBranchMenuOpen={vi.fn()}
        branchControlWidthCh={14}
        branchLoading={false}
        branchSwitching={false}
        hasActiveProject
        branchCurrent="main"
        branchDisplayValue="main"
        branchSearchInputRef={{ current: null }}
        branchQuery=""
        setBranchQuery={vi.fn()}
        branchActionError={null}
        clearBranchActionError={vi.fn()}
        checkoutBranch={vi.fn()}
        filteredBranches={["main"]}
        openBranchCreateModal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable plan mode" }));
    fireEvent.change(screen.getByPlaceholderText("Send to Claude..."), { target: { value: "Plan the refactor" } });
    fireEvent.click(screen.getByRole("button", { name: "Send prompt" }));

    expect(startTurnMock).toHaveBeenCalledWith(
      "Plan the refactor",
      expect.objectContaining({
        permissionMode: "plan",
      }),
    );
    expect(onTitleChangeMock).toHaveBeenCalledWith("Plan the refactor");
  });

  it("archives Claude background agents from the existing dock and hides them locally", async () => {
    mockSubagents = [
      {
        id: "task-1",
        name: "Scout",
        role: "explorer",
        status: "thinking",
        statusText: "is running",
        taskText: "Explore the repo",
        sessionID: "child-session-1",
      },
    ];

    render(
      <ClaudeChatPane
        directory="/tmp/project"
        sessionStorageKey="session-1"
        onTitleChange={onTitleChangeMock}
        permissionMode="ask-write"
        onPermissionModeChange={vi.fn()}
        branchMenuOpen={false}
        setBranchMenuOpen={vi.fn()}
        branchControlWidthCh={14}
        branchLoading={false}
        branchSwitching={false}
        hasActiveProject
        branchCurrent="main"
        branchDisplayValue="main"
        branchSearchInputRef={{ current: null }}
        branchQuery=""
        setBranchQuery={vi.fn()}
        branchActionError={null}
        clearBranchActionError={vi.fn()}
        checkoutBranch={vi.fn()}
        filteredBranches={["main"]}
        openBranchCreateModal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand background agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive Scout" }));

    expect(archiveProviderSessionMock).toHaveBeenCalledWith("child-session-1");
    await waitFor(() => {
      expect(screen.queryByText("Scout")).not.toBeInTheDocument();
    });
  });

  it("polls the selected Claude subagent transcript while the detail modal is open", async () => {
    vi.useFakeTimers();
    mockSubagents = [
      {
        id: "task-1",
        name: "Scout",
        role: "explorer",
        status: "thinking",
        statusText: "is running",
        taskText: "Explore the repo",
        sessionID: "child-session-1",
      },
    ];
    loadSubagentMessagesMock.mockResolvedValue([
      {
        id: "msg-1",
        role: "assistant",
        content: "First pass",
        timestamp: 1,
        sessionId: "child-session-1",
      },
    ] as never);

    render(
      <ClaudeChatPane
        directory="/tmp/project"
        sessionStorageKey="session-1"
        onTitleChange={onTitleChangeMock}
        permissionMode="ask-write"
        onPermissionModeChange={vi.fn()}
        branchMenuOpen={false}
        setBranchMenuOpen={vi.fn()}
        branchControlWidthCh={14}
        branchLoading={false}
        branchSwitching={false}
        hasActiveProject
        branchCurrent="main"
        branchDisplayValue="main"
        branchSearchInputRef={{ current: null }}
        branchQuery=""
        setBranchQuery={vi.fn()}
        branchActionError={null}
        clearBranchActionError={vi.fn()}
        checkoutBranch={vi.fn()}
        filteredBranches={["main"]}
        openBranchCreateModal={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand background agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Scout" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(loadSubagentMessagesMock).toHaveBeenCalledWith("child-session-1");

    await act(async () => {
      vi.advanceTimersByTime(1300);
      await Promise.resolve();
    });

    expect(loadSubagentMessagesMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
  });
});
