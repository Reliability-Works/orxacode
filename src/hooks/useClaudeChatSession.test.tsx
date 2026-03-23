import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClaudeChatSession } from "./useClaudeChatSession";
import { clearPersistedClaudeChatState } from "./claude-chat-session-storage";
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
        getSessionMessages: vi.fn(async () => []),
        getState: vi.fn(async () => ({ sessionKey: SESSION_KEY, status: "disconnected" })),
        health: vi.fn(async () => ({ available: true, authenticated: true })),
      },
      events,
    } as unknown as typeof window.orxa;
  });

  afterEach(() => {
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
});
