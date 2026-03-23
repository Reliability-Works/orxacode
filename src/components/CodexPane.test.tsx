import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { CodexPane } from "./CodexPane";
import { setPersistedCodexState } from "../hooks/codex-session-storage";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

const mockOnExit = vi.fn();

function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({ status: "connected" as const, serverInfo: { name: "codex", version: "1.0.0" } })),
    stop: vi.fn(async () => ({ status: "disconnected" as const })),
    getState: vi.fn(async () => ({ status: "disconnected" as const })),
    startThread: vi.fn(async () => ({ id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() })),
    getThreadRuntime: vi.fn(async () => ({ thread: null, childThreads: [] })),
    resumeThread: vi.fn(async () => ({ thread: null })) as ReturnType<typeof vi.fn>,
    listThreads: vi.fn(async () => ({ threads: [], nextCursor: undefined })),
    listModels: vi.fn(async () => []),
    listCollaborationModes: vi.fn(async () => []),
    archiveThreadTree: vi.fn(async () => undefined),
    setThreadName: vi.fn(async () => undefined),
    generateRunMetadata: vi.fn(async () => ({ title: "Fix Workspace Session Naming", worktreeName: "fix/workspace-session-naming" })),
    startTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    deny: vi.fn(async () => undefined),
    respondToUserInput: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    interruptThreadTree: vi.fn(async () => undefined),
  };
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  };
}

function buildDefaultBranchProps(overrides: Record<string, unknown> = {}) {
  return {
    branchMenuOpen: false,
    setBranchMenuOpen: vi.fn() as Mock<(updater: (value: boolean) => boolean) => void>,
    branchControlWidthCh: 20,
    branchLoading: false,
    branchSwitching: false,
    hasActiveProject: false,
    branchCurrent: undefined,
    branchDisplayValue: "",
    branchSearchInputRef: { current: null },
    branchQuery: "",
    setBranchQuery: vi.fn(),
    branchActionError: null,
    clearBranchActionError: vi.fn(),
    checkoutBranch: vi.fn(),
    filteredBranches: [],
    openBranchCreateModal: vi.fn(),
    permissionMode: "ask-write" as const,
    onPermissionModeChange: vi.fn(),
    ...overrides,
  };
}

describe("CodexPane", () => {
  beforeEach(() => {
    mockOnExit.mockReset();
    useUnifiedRuntimeStore.setState((state) => ({
      ...state,
      codexSessions: {},
      activeSessionID: undefined,
      activeProvider: undefined,
      activeWorkspaceDirectory: undefined,
    }));
    setPersistedCodexState("/workspace/project::session-1", {
      messages: [],
      thread: null,
      isStreaming: false,
      messageIdCounter: 0,
    });
  });

  afterEach(() => {
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("shows unavailable message when codex bridge is not available", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByText(/codex is not available/i)).toBeInTheDocument();
  });

  it("renders the composer input", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByPlaceholderText(/connecting to codex/i)).toBeInTheDocument();
  });

  it("renders the send button", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("renders the conversation log area", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByRole("log", { name: /codex conversation/i })).toBeInTheDocument();
  });

  it("renders the Codex transcript without virtualization", async () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      messages: [{
        id: "msg-assistant-1",
        kind: "message",
        role: "assistant",
        content: "Transcript rows stay in normal flow.",
        timestamp: Date.now(),
      }],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 1,
    });

    const { container } = render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Transcript rows stay in normal flow.")).toBeInTheDocument();
    });
    expect(container.querySelector(".messages-virtual-row")).toBeNull();
    expect(container.querySelector(".messages-virtual-spacer")).toBeNull();
  });

  it("shows the bottom copy action for persisted user messages", async () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      messages: [{
        id: "msg-user-1",
        kind: "message",
        role: "user",
        content: "hello from user",
        timestamp: Date.now(),
      }],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 1,
    });

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });

  it("renders completed file changes even when Codex does not provide diff hunks or line counts", async () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      messages: [{
        id: "msg-diff-1",
        kind: "diff",
        path: "/workspace/project/src/app/page.tsx",
        type: "modified",
        status: "completed",
        timestamp: Date.now(),
      }],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 1,
    });

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    await waitFor(() => {
      expect(screen.getByText(/page\.tsx$/)).toBeInTheDocument();
      expect(screen.getByText("Edited")).toBeInTheDocument();
    });
  });

  it("clusters multiple edited files under a changed files section for the assistant turn", async () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      messages: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          content: "I have updated the scaffold.",
          timestamp: Date.now(),
        },
        {
          id: "diff-1",
          kind: "diff",
          path: "/workspace/project/northline-barber/.env.example",
          type: "modified",
          status: "completed",
          insertions: 20,
          deletions: 2,
          timestamp: Date.now(),
        },
        {
          id: "diff-2",
          kind: "diff",
          path: "/workspace/project/northline-barber/package.json",
          type: "modified",
          status: "completed",
          insertions: 10,
          deletions: 1,
          timestamp: Date.now(),
        },
      ],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 3,
    });

    render(<CodexPane directory="/workspace/project" sessionStorageKey="/workspace/project::session-1" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    await waitFor(() => {
      expect(screen.getByText("Changed files")).toBeInTheDocument();
      expect(screen.getByText(".env.example")).toBeInTheDocument();
      expect(screen.getByText("package.json")).toBeInTheDocument();
    });
  });

  it("starts new threads with full access in yolo mode", async () => {
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps({ permissionMode: "yolo-write" as const })}
      />,
    );

    await waitFor(() => {
      expect(codex.startThread).toHaveBeenCalledWith(
        expect.objectContaining({
          sandbox: "danger-full-access",
          approvalPolicy: "never",
        }),
      );
    });
  });

  it("auto-approves Codex approvals in yolo mode", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps({ permissionMode: "yolo-write" as const })}
      />,
    );

    await waitFor(() => {
      expect(codex.startThread).toHaveBeenCalled();
    });

    act(() => {
      notify?.({
        type: "codex.approval",
        payload: {
          id: 42,
          method: "item/fileChange/requestApproval",
          itemId: "item-1",
          threadId: "",
          turnId: "turn-1",
          reason: "",
          availableDecisions: ["accept", "acceptForSession"],
          changes: [{ path: "src/foo.ts", type: "modify" }],
        },
      });
    });

    await waitFor(() => {
      expect(codex.approve).toHaveBeenCalledWith(42, "acceptForSession");
    });
  });

  it("generates and persists a Codex title from the first user message", async () => {
    const codex = buildOrxaCodex();
    const onTitleChange = vi.fn();
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        onTitleChange={onTitleChange}
        {...buildDefaultBranchProps()}
      />,
    );

    await waitFor(() => {
      expect(codex.startThread).toHaveBeenCalled();
    });

    const composer = screen.getByRole("textbox");
    await act(async () => {
      fireEvent.change(composer, { target: { value: "Fix the workspace session naming flow" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    await waitFor(() => {
      expect(codex.generateRunMetadata).toHaveBeenCalledWith("/workspace/project", "Fix the workspace session naming flow");
    });

    await waitFor(() => {
      expect(codex.setThreadName).toHaveBeenCalledWith("thr-1", "Fix Workspace Session Naming");
      expect(onTitleChange).toHaveBeenCalledWith("Fix Workspace Session Naming");
    });
  });

  it("renders a newly sent message immediately in a fresh session while Codex starts work", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    await waitFor(() => {
      expect(notify).toBeTypeOf("function");
    });
    await waitFor(() => {
      expect(codex.startThread).toHaveBeenCalled();
    });

    const composer = screen.getByRole("textbox");
    await act(async () => {
      fireEvent.change(composer, { target: { value: "Build the workspace session flow" } });
      fireEvent.click(screen.getByRole("button", { name: /send/i }));
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr-1", turn: { id: "turn-1" } },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/plan/updated",
          params: {
            threadId: "thr-1",
            plan: [{ step: "Inspect repo", status: "in_progress" }],
          },
        },
      });
    });

    expect(screen.getByText("Build the workspace session flow")).toBeInTheDocument();
    expect(screen.getByText(/updated task list/i)).toBeInTheDocument();
  });

  it("steers queued messages into the active turn", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    setPersistedCodexState("/workspace/project::session-1", {
      messages: [],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    });
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    const composer = screen.getByRole("textbox");

    await act(async () => {
      fireEvent.change(composer, { target: { value: "queued follow up" } });
      fireEvent.keyDown(composer, { key: "Enter" });
    });

    expect(screen.getByText(/followup message queued/i)).toBeInTheDocument();
    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr-1", turn: { id: "turn-queued" } },
        },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /steer message/i }));
    });

    await waitFor(() => {
      expect(codex.steerTurn).toHaveBeenCalledWith("thr-1", "turn-queued", "queued follow up");
    });

    expect(screen.getAllByText("queued follow up").length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/followup message queued/i)).not.toBeInTheDocument();
  });

  it("keeps queued messages queued when steer is unavailable", async () => {
    const codex = buildOrxaCodex();
    setPersistedCodexState("/workspace/project::session-1", {
      messages: [],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    });
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    const composer = screen.getByRole("textbox");

    await act(async () => {
      fireEvent.change(composer, { target: { value: "interrupt and send this" } });
      fireEvent.keyDown(composer, { key: "Enter" });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /steer message/i }));
    });

    expect(codex.steerTurn).not.toHaveBeenCalled();
    expect(screen.getByText(/followup message queued/i)).toBeInTheDocument();
  });

  it("falls back to transcript-derived task list and subagent drawers when runtime state is empty", async () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 0,
      messages: [
        {
          id: "assistant-plan",
          kind: "message",
          role: "assistant",
          timestamp: Date.now(),
          content: [
            "I created a task list and started maintaining it with these phases:",
            "1. Inspect repo and choose the new standalone site folder",
            "2. Scaffold the app and core dependencies",
            "3. Implement the booking product and UX",
          ].join("\n"),
        },
        {
          id: "task-tool",
          kind: "tool",
          toolType: "task",
          title: "Spawn worker",
          status: "running",
          timestamp: Date.now(),
          collabReceivers: [{ threadId: "child-1", nickname: "Euclid", role: "worker" }],
          collabStatuses: [{ threadId: "child-1", nickname: "Euclid", role: "worker", status: "done" }],
        },
      ],
    });

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    expect(screen.getByText(/task list/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Expand background agents" }));
    expect(screen.getByText("Euclid")).toBeInTheDocument();
  });

  it("shows the background-agent drawer from runtime child threads when transcript metadata is absent", async () => {
    const codex = buildOrxaCodex();
    codex.getThreadRuntime.mockResolvedValue({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now() },
      childThreads: [{
        id: "child-1",
        preview: "Scout repo",
        modelProvider: "openai",
        createdAt: Date.now(),
        status: { type: "busy" },
      }],
    } as never);
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
      messages: [],
    });
    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand background agents" }));
    await waitFor(() => {
      expect(screen.getByText("Scout repo")).toBeInTheDocument();
    });
  });

  it("surfaces a provisional Codex background agent from thread-started metadata during an active turn", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    setPersistedCodexState("/workspace/project::session-1", {
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 0,
      messages: [],
    });

    render(
      <CodexPane
        directory="/workspace/project"
        sessionStorageKey="/workspace/project::session-1"
        onExit={mockOnExit}
        {...buildDefaultBranchProps()}
      />,
    );

    await waitFor(() => {
      expect(notify).toBeTypeOf("function");
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: {
            turn: {
              id: "turn-1",
              threadId: "thr-1",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "child-provisional-1",
              preview: "Scout repo",
              source: {
                subAgent: {
                  kind: "explorer",
                  nickname: "Scout",
                  role: "explorer",
                },
              },
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/1 background agent/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Expand background agents" }));
    await waitFor(() => {
      expect(screen.getByText("Scout")).toBeInTheDocument();
    });
  });
});
