import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClaudeChatSession } from "./useClaudeChatSession";
import {
  clearPersistedClaudeChatState,
  resetPersistedClaudeChatStateForTests,
} from "./claude-chat-session-storage";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

const SESSION_KEY = "/workspace::claude-chat-1";

function buildEvents() {
  let handler: ((event: unknown) => void) | null = null;
  return {
    subscribe: vi.fn((next: (event: unknown) => void) => {
      handler = next;
      return () => {
        handler = null;
      };
    }),
    emit(event: unknown) {
      handler?.(event);
    },
  };
}

describe("useClaudeChatSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistedClaudeChatStateForTests();
    clearPersistedClaudeChatState(SESSION_KEY);
    useUnifiedRuntimeStore.setState((state) => ({
      ...state,
      claudeChatSessions: {},
    }));

    const events = buildEvents();
    window.orxa = {
      claudeChat: {
        listModels: vi.fn(async () => []),
        startTurn: vi.fn(async () => undefined),
        interruptTurn: vi.fn(async () => undefined),
        approve: vi.fn(async () => undefined),
        respondToUserInput: vi.fn(async () => undefined),
        archiveSession: vi.fn(async () => undefined),
        archiveProviderSession: vi.fn(async () => undefined),
        getSessionMessages: vi.fn(async () => []),
        getState: vi.fn(async () => ({ sessionKey: SESSION_KEY, status: "disconnected" })),
        health: vi.fn(async () => ({ available: true, authenticated: true })),
      },
      events,
    } as unknown as typeof window.orxa;
  });

  afterEach(() => {
    window.localStorage.clear();
    resetPersistedClaudeChatStateForTests();
    clearPersistedClaudeChatState(SESSION_KEY);
    // @ts-expect-error test cleanup
    delete window.orxa;
  });

  it("coalesces Claude partial and final assistant output into one message row", async () => {
    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));
    const events = window.orxa!.events as unknown as ReturnType<typeof buildEvents>;

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "turn/started",
          params: { turnId: "turn-1", timestamp: 1 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "assistant/partial",
          params: { id: "partial-1", turnId: "turn-1", content: "Hi", timestamp: 2 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "assistant/message",
          params: { id: "assistant-1", turnId: "turn-1", content: "Hi! How can I help you today?", timestamp: 3 },
        },
      });
    });

    const assistantMessages = result.current.messages.filter((item) => item.kind === "message" && item.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      content: "Hi! How can I help you today?",
    });
  });

  it("reconciles provider state and history on mount", async () => {
    vi.mocked(window.orxa!.claudeChat.getState).mockResolvedValue({
      sessionKey: SESSION_KEY,
      status: "connected",
      providerThreadId: "claude-thread-1",
      activeTurnId: "turn-1",
    });
    vi.mocked(window.orxa!.claudeChat.getSessionMessages).mockResolvedValue([
      {
        id: "history-1",
        role: "assistant",
        content: "Recovered history",
        timestamp: 1,
        sessionId: "claude-thread-1",
      },
    ]);

    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));

    await waitFor(() => {
      expect(result.current.providerThreadId).toBe("claude-thread-1");
    });
    expect(window.orxa!.claudeChat.getSessionMessages).toHaveBeenCalledWith("claude-thread-1", "/workspace");
    expect(useUnifiedRuntimeStore.getState().claudeChatSessions[SESSION_KEY]?.historyMessages).toHaveLength(1);
  });

  it("ignores legacy persisted Claude provider ids and sends turns without renderer-managed resume metadata", async () => {
    window.localStorage.setItem(
      `orxa:claudeChatSession:v1:${SESSION_KEY}`,
      JSON.stringify({
        providerThreadId: "claude-thread-1",
        messages: [],
        historyMessages: [],
        isStreaming: false,
        messageIdCounter: 0,
        subagents: [],
      }),
    );

    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startTurn("Continue the previous conversation");
    });

    expect(window.orxa!.claudeChat.startTurn).toHaveBeenCalledWith(
      SESSION_KEY,
      "/workspace",
      "Continue the previous conversation",
      expect.objectContaining({
        cwd: "/workspace",
      }),
    );
  });

  it("keeps streaming active through assistant text until turn completion and updates tool rows in place", async () => {
    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));
    const events = window.orxa!.events as unknown as ReturnType<typeof buildEvents>;

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "turn/started",
          params: { turnId: "turn-2", timestamp: 1 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "tool/progress",
          params: { id: "toolu_1", toolName: "Task", timestamp: 2, elapsedTimeSeconds: 1.2 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "assistant/message",
          params: { id: "assistant-2", turnId: "turn-2", content: "I'll fan out a few agents.", timestamp: 3 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "tool/completed",
          params: { id: "toolu_1", toolName: "Task", summary: "Queued 1 background task", timestamp: 4 },
        },
      });
    });

    expect(result.current.isStreaming).toBe(true);

    const toolMessages = result.current.messages.filter((item) => item.kind === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]).toMatchObject({
      title: "Task",
      status: "completed",
      output: "Queued 1 background task",
    });

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "turn/completed",
          params: { turnId: "turn-2", timestamp: 5 },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it("keeps Claude thinking visible through assistant partials until the turn completes", async () => {
    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));
    const events = window.orxa!.events as unknown as ReturnType<typeof buildEvents>;

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "turn/started",
          params: { turnId: "turn-thinking", timestamp: 1 },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "assistant/partial",
          params: { id: "assistant-thinking", turnId: "turn-thinking", content: "Hello", timestamp: 2 },
        },
      });
    });

    expect(result.current.messages.some((item) => item.kind === "thinking")).toBe(true);

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "turn/completed",
          params: { turnId: "turn-thinking", timestamp: 3 },
        },
      });
    });

    expect(result.current.messages.some((item) => item.kind === "thinking")).toBe(false);
  });

  it("normalizes read-only Claude task progress into explore rows", async () => {
    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));
    const events = window.orxa!.events as unknown as ReturnType<typeof buildEvents>;

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "task/started",
          params: {
            taskId: "task-1",
            description: "Explore the repository for failing tests",
            taskType: "researcher",
            timestamp: 1,
          },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "task/completed",
          params: {
            taskId: "task-1",
            status: "completed",
            summary: "Explored the repository and identified the failing tests",
            timestamp: 2,
          },
        },
      });
    });

    const explore = result.current.messages.find((item) => item.kind === "explore");
    expect(explore).toMatchObject({
      kind: "explore",
      source: "delegated",
      status: "explored",
    });
    if (!explore || explore.kind !== "explore") {
      throw new Error("Expected an explore row");
    }
    expect(explore.entries[0]).toMatchObject({
      status: "completed",
    });
  });

  it("keeps the original Claude subagent task text when progress updates arrive", async () => {
    const { result } = renderHook(() => useClaudeChatSession("/workspace", SESSION_KEY));
    const events = window.orxa!.events as unknown as ReturnType<typeof buildEvents>;

    await act(async () => {
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "task/started",
          params: {
            taskId: "task-1",
            description: "Explore the repository structure",
            taskType: "explorer",
          },
        },
      });
      events.emit({
        type: "claude-chat.notification",
        payload: {
          sessionKey: SESSION_KEY,
          method: "task/progress",
          params: {
            taskId: "task-1",
            description: "Explore the repository structure",
            summary: "Running ls -1d /Users/callumspencer/Repos/...",
          },
        },
      });
    });

    expect(result.current.subagents).toEqual([
      expect.objectContaining({
        id: "task-1",
        taskText: "Explore the repository structure",
        statusText: "Running ls -1d /Users/callumspencer/Repos/...",
      }),
    ]);
  });
});
