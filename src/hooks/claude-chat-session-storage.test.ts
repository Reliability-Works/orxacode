import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPersistedClaudeChatState,
  getPersistedClaudeChatState,
  resetPersistedClaudeChatStateForTests,
  setPersistedClaudeChatState,
} from "./claude-chat-session-storage";

const SESSION_KEY = "/workspace::claude-chat-1";

describe("claude-chat-session-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistedClaudeChatStateForTests();
  });

  it("hydrates persisted Claude chat state from localStorage after cache reset", () => {
    window.localStorage.setItem(
      `orxa:claudeChatSession:v1:${SESSION_KEY}`,
      JSON.stringify({
        providerThreadId: "thread-1",
        messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
        historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
        isStreaming: true,
        messageIdCounter: 4,
        subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
      }),
    );

    resetPersistedClaudeChatStateForTests();

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual({
      messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
      historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
      isStreaming: false,
      messageIdCounter: 4,
      subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
    });
  });

  it("clears persisted Claude chat state from localStorage", () => {
    setPersistedClaudeChatState(SESSION_KEY, {
      messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
      historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
      isStreaming: false,
      messageIdCounter: 4,
      subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
    });

    clearPersistedClaudeChatState(SESSION_KEY);
    resetPersistedClaudeChatStateForTests();

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual({
      messages: [],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 0,
      subagents: [],
    });
  });

  it("preserves a legacy provider thread id while runtime snapshots rewrite the persisted state", () => {
    window.localStorage.setItem(
      `orxa:claudeChatSession:v1:${SESSION_KEY}`,
      JSON.stringify({
        providerThreadId: "thread-legacy",
        messages: [],
        historyMessages: [],
        isStreaming: false,
        messageIdCounter: 0,
        subagents: [],
      }),
    );

    setPersistedClaudeChatState(SESSION_KEY, {
      messages: [{ id: "msg-2", kind: "message", role: "assistant", content: "Updated", timestamp: 2 }],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 1,
      subagents: [],
    });

    expect(
      JSON.parse(window.localStorage.getItem(`orxa:claudeChatSession:v1:${SESSION_KEY}`) ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        providerThreadId: "thread-legacy",
        messages: [{ id: "msg-2", kind: "message", role: "assistant", content: "Updated", timestamp: 2 }],
      }),
    );
  });
});
