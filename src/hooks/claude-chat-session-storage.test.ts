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
    setPersistedClaudeChatState(SESSION_KEY, {
      providerThreadId: "thread-1",
      messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
      historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
      isStreaming: true,
      messageIdCounter: 4,
      subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
    });

    resetPersistedClaudeChatStateForTests();

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual({
      providerThreadId: "thread-1",
      messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
      historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
      isStreaming: false,
      messageIdCounter: 4,
      subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
    });
  });

  it("clears persisted Claude chat state from localStorage", () => {
    setPersistedClaudeChatState(SESSION_KEY, {
      providerThreadId: "thread-1",
      messages: [{ id: "msg-1", kind: "message", role: "assistant", content: "Saved", timestamp: 1 }],
      historyMessages: [{ id: "history-1", role: "assistant", content: "Saved", timestamp: 1, sessionId: "thread-1" }],
      isStreaming: false,
      messageIdCounter: 4,
      subagents: [{ id: "task-1", name: "Explorer", status: "completed", statusText: "Done", sessionID: "child-1" }],
    });

    clearPersistedClaudeChatState(SESSION_KEY);
    resetPersistedClaudeChatStateForTests();

    expect(getPersistedClaudeChatState(SESSION_KEY)).toEqual({
      providerThreadId: null,
      messages: [],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 0,
      subagents: [],
    });
  });
});
