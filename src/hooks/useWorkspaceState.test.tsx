import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBootstrap } from "@shared/ipc";
import { useWorkspaceState } from "./useWorkspaceState";

function createProjectBootstrap(directory: string, sessions: Array<{ id: string; time: { updated: number } }>): ProjectBootstrap {
  const sessionStatus = Object.fromEntries(sessions.map((session) => [session.id, { type: "idle" }]));
  return ({
    directory,
    path: {},
    sessions,
    sessionStatus,
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {},
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys: [],
  } as unknown) as ProjectBootstrap;
}

describe("useWorkspaceState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates sessions with ask-write permissions so mode can change mid-session", async () => {
    const directory = "/repo";
    const now = Date.now();
    const createdSession = {
      id: "session-created",
      slug: "session-created",
      title: "New session",
      time: { created: now, updated: now },
    };
    const selectProjectMock = vi.fn(async () => createProjectBootstrap(directory, []));
    const refreshProjectMock = vi.fn(async () => createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }]));
    const createSessionMock = vi.fn(async () => createdSession);

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          createSession: createSessionMock,
          loadMessages: vi.fn(async () => []),
          sendPrompt: vi.fn(async () => true),
        },
      },
    });

    const setStatusLine = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceState({
        setStatusLine,
        terminalTabIds: [],
        setTerminalTabs: vi.fn(),
        setActiveTerminalId: vi.fn(),
        setTerminalOpen: vi.fn(),
        messageCacheRef: { current: {} },
        projectLastOpenedRef: { current: {} },
        projectLastUpdatedRef: { current: {} },
      }),
    );

    await act(async () => {
      await (result.current.createSession as unknown as (directory: string, prompt?: string, options?: unknown) => Promise<void>)(
        directory,
        undefined,
        {
          serverAgentNames: new Set<string>(),
          permissionMode: "yolo-write",
        },
      );
    });

    expect(createSessionMock).toHaveBeenCalledWith(directory, "New session", "ask-write");
  });
});
