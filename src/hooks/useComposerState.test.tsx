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
        availableAgentNames: new Set(["build"]),
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

  it("sends the selected agent when it is available from the picker set", async () => {
    const sendPromptMock = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          sendPrompt: sendPromptMock,
          renameSession: vi.fn(async () => true),
        },
      },
    });

    const { result } = renderHook(() =>
      useComposerState("/repo", "session-1", {
        availableSlashCommands: [],
        refreshMessages: vi.fn(async () => undefined),
        refreshProject: vi.fn(async () => undefined),
        sessions: [{ id: "session-1", title: "Session 1" }],
        selectedAgent: "builder",
        availableAgentNames: new Set(["builder"]),
        setStatusLine: vi.fn(),
        shouldAutoRenameSessionTitle: vi.fn(() => false),
        deriveSessionTitleFromPrompt: vi.fn((prompt: string) => prompt),
        startResponsePolling: vi.fn(),
        stopResponsePolling: vi.fn(),
        clearPendingSession: vi.fn(),
      }),
    );

    act(() => {
      result.current.setComposer("Ship it");
    });

    await act(async () => {
      await result.current.sendPrompt();
    });

    expect(sendPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: "builder",
    }));
  });

  it("omits the selected agent when it is not in the available picker set", async () => {
    const sendPromptMock = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          sendPrompt: sendPromptMock,
          renameSession: vi.fn(async () => true),
        },
      },
    });

    const { result } = renderHook(() =>
      useComposerState("/repo", "session-1", {
        availableSlashCommands: [],
        refreshMessages: vi.fn(async () => undefined),
        refreshProject: vi.fn(async () => undefined),
        sessions: [{ id: "session-1", title: "Session 1" }],
        selectedAgent: "builder",
        availableAgentNames: new Set(["plan", "build"]),
        setStatusLine: vi.fn(),
        shouldAutoRenameSessionTitle: vi.fn(() => false),
        deriveSessionTitleFromPrompt: vi.fn((prompt: string) => prompt),
        startResponsePolling: vi.fn(),
        stopResponsePolling: vi.fn(),
        clearPendingSession: vi.fn(),
      }),
    );

    act(() => {
      result.current.setComposer("Ship it");
    });

    await act(async () => {
      await result.current.sendPrompt();
    });

    expect(sendPromptMock).toHaveBeenCalledWith(expect.not.objectContaining({
      agent: "builder",
    }));
  });

  it("refreshes project data after auto-renaming an OpenCode session title", async () => {
    const sendPromptMock = vi.fn(async () => true);
    const renameSessionMock = vi.fn(async () => true);
    const refreshProjectMock = vi.fn(async () => undefined);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          sendPrompt: sendPromptMock,
          renameSession: renameSessionMock,
        },
      },
    });

    const { result } = renderHook(() =>
      useComposerState("/repo", "session-1", {
        availableSlashCommands: [],
        refreshMessages: vi.fn(async () => undefined),
        refreshProject: refreshProjectMock,
        sessions: [{ id: "session-1", title: "OpenCode Session" }],
        selectedAgent: "builder",
        availableAgentNames: new Set(["builder"]),
        setStatusLine: vi.fn(),
        shouldAutoRenameSessionTitle: vi.fn(() => true),
        deriveSessionTitleFromPrompt: vi.fn(() => "Ship booking flow"),
        startResponsePolling: vi.fn(),
        stopResponsePolling: vi.fn(),
        clearPendingSession: vi.fn(),
      }),
    );

    act(() => {
      result.current.setComposer("Ship booking flow");
    });

    await act(async () => {
      await result.current.sendPrompt();
    });

    expect(renameSessionMock).toHaveBeenCalledWith("/repo", "session-1", "Ship booking flow");
    expect(refreshProjectMock).toHaveBeenCalledWith("/repo");
    expect(sendPromptMock).toHaveBeenCalled();
  });
});
