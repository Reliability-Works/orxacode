import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeChatPane } from "./ClaudeChatPane";

const startTurnMock = vi.fn();
const onTitleChangeMock = vi.fn();

vi.mock("../hooks/useClaudeChatSession", () => ({
  useClaudeChatSession: () => ({
    messages: [],
    pendingApproval: null,
    pendingUserInput: null,
    isStreaming: false,
    subagents: [],
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
    loadSubagentMessages: vi.fn(async () => []),
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
    onTitleChangeMock.mockReset();
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
});
