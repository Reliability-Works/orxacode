import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useComposerState } from "./useComposerState";

describe("useComposerState", () => {
  it("marks manual abort requests before aborting active session", async () => {
    const abortSessionMock = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          abortSession: abortSessionMock,
        },
      },
    });

    const onSessionAbortRequested = vi.fn();
    const { result } = renderHook(() =>
      useComposerState("/repo", "session-1", {
        availableSlashCommands: [],
        refreshMessages: vi.fn(async () => undefined),
        refreshProject: vi.fn(async () => undefined),
        sessions: [{ id: "session-1", title: "Session 1" }],
        selectedAgent: "build",
        serverAgentNames: new Set(["build"]),
        setStatusLine: vi.fn(),
        shouldAutoRenameSessionTitle: vi.fn(() => false),
        deriveSessionTitleFromPrompt: vi.fn((prompt: string) => prompt),
        startResponsePolling: vi.fn(),
        stopResponsePolling: vi.fn(),
        clearPendingSession: vi.fn(),
        onSessionAbortRequested,
      }),
    );

    await act(async () => {
      await result.current.abortActiveSession();
    });

    expect(onSessionAbortRequested).toHaveBeenCalledWith("/repo", "session-1");
    expect(abortSessionMock).toHaveBeenCalledWith("/repo", "session-1");
  });
});
