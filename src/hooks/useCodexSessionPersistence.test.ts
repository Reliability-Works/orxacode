import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydratePersistedCodexSession } from "./useCodexSessionPersistence";
import { resetPersistedCodexStateForTests } from "./codex-session-storage";

describe("hydratePersistedCodexSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistedCodexStateForTests();
  });

  it("infers a minimal Codex thread from the session key when persisted thread metadata is missing", () => {
    const setThreadState = vi.fn();

    hydratePersistedCodexSession("codex::/workspace::thread-123", {
      setMessagesState: vi.fn(),
      setThreadState,
      setStreamingState: vi.fn(),
      setPendingApprovalState: vi.fn(),
      setPendingUserInputState: vi.fn(),
      setSubagentsState: vi.fn(),
      setActiveSubagentThreadIdState: vi.fn(),
      setPlanItemsState: vi.fn(),
      setThreadNameState: vi.fn(),
      resetRefs: vi.fn(),
    });

    expect(setThreadState).toHaveBeenCalledWith({
      id: "thread-123",
      preview: "",
      modelProvider: "",
      createdAt: 0,
      ephemeral: true,
    });
  });
});
