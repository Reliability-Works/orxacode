import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBootstrap, SessionMessageBundle, SessionRuntimeSnapshot } from "@shared/ipc";
import { normalizeMessageBundles, useWorkspaceState } from "./useWorkspaceState";

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

function createRuntimeSnapshot(directory: string, sessionID: string, messages: SessionMessageBundle[] = []): SessionRuntimeSnapshot {
  return {
    directory,
    sessionID,
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  };
}

describe("useWorkspaceState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates sessions with the requested permission mode", async () => {
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
          getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, [])),
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

    expect(createSessionMock).toHaveBeenCalledWith(directory, "New session", "yolo-write");
  });

  it("merges duplicate message bundle ids without dropping visible parts", () => {
    const now = Date.now();
    const bundles: SessionMessageBundle[] = [
      {
        info: {
          id: "message-1",
          role: "user",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-1",
            type: "text",
            sessionID: "session-1",
            messageID: "message-1",
            text: "First part",
          },
        ] as SessionMessageBundle["parts"],
      },
      {
        info: {
          id: "message-1",
          role: "user",
          sessionID: "session-1",
          time: { created: now, updated: now + 1 },
        } as unknown as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-2",
            type: "text",
            sessionID: "session-1",
            messageID: "message-1",
            text: "Second part",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];
    const normalized = normalizeMessageBundles(bundles);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.parts).toHaveLength(2);
  });

  it("opens the created session when creating in another workspace", async () => {
    const sourceDirectory = "/repo/source";
    const targetDirectory = "/repo/target";
    const now = Date.now();
    const createdSession = {
      id: "session-created",
      slug: "session-created",
      title: "New session",
      time: { created: now, updated: now },
    };

    const sourceBootstrap = createProjectBootstrap(sourceDirectory, [{ id: "session-source", time: { updated: now - 1000 } }]);
    const targetBootstrap = createProjectBootstrap(targetDirectory, []);
    const targetWithCreatedSession = createProjectBootstrap(targetDirectory, [{ id: createdSession.id, time: { updated: now } }]);

    const selectProjectMock = vi.fn(async (directory: string) => {
      if (directory === sourceDirectory) {
        return sourceBootstrap;
      }
      if (directory === targetDirectory) {
        return targetBootstrap;
      }
      throw new Error(`unexpected directory ${directory}`);
    });
    const refreshProjectMock = vi.fn(async (directory: string) => {
      if (directory === targetDirectory) {
        return targetWithCreatedSession;
      }
      if (directory === sourceDirectory) {
        return sourceBootstrap;
      }
      throw new Error(`unexpected directory ${directory}`);
    });
    const createSessionMock = vi.fn(async () => createdSession);

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          createSession: createSessionMock,
          getSessionRuntime: vi.fn(async (directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, [])),
          sendPrompt: vi.fn(async () => true),
          deleteSession: vi.fn(async () => true),
        },
      },
    });

    const { result } = renderHook(() =>
      useWorkspaceState({
        setStatusLine: vi.fn(),
        terminalTabIds: [],
        setTerminalTabs: vi.fn(),
        setActiveTerminalId: vi.fn(),
        setTerminalOpen: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.setActiveProjectDir(sourceDirectory);
      result.current.setActiveSessionID("session-source");
    });

    await act(async () => {
      await (result.current.createSession as unknown as (directory: string, prompt?: string, options?: unknown) => Promise<void>)(
        targetDirectory,
      );
    });

    expect(result.current.activeProjectDir).toBe(targetDirectory);
    expect(result.current.activeSessionID).toBe(createdSession.id);
  });

  it("can select a session in another workspace immediately after selecting that workspace", async () => {
    const sourceDirectory = "/repo/source";
    const targetDirectory = "/repo/target";
    const sourceSessionId = "session-source";
    const targetSessionId = "session-target";
    const now = Date.now();

    const sourceBootstrap = createProjectBootstrap(sourceDirectory, [{ id: sourceSessionId, time: { updated: now - 100 } }]);
    const targetBootstrap = createProjectBootstrap(targetDirectory, [{ id: targetSessionId, time: { updated: now } }]);
    const targetMessages = [{
      info: {
        id: "msg-target",
        role: "assistant",
        sessionID: targetSessionId,
        time: { created: now, updated: now },
      },
      parts: [],
    }] as unknown as SessionMessageBundle[];

    const getSessionRuntimeMock = vi.fn(async (directory: string, sessionID: string) => {
      if (directory === targetDirectory && sessionID === targetSessionId) {
        return createRuntimeSnapshot(directory, sessionID, targetMessages);
      }
      return createRuntimeSnapshot(directory, sessionID, []);
    });

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async (directory: string) => {
            if (directory === sourceDirectory) {
              return sourceBootstrap;
            }
            if (directory === targetDirectory) {
              return targetBootstrap;
            }
            throw new Error(`unexpected directory ${directory}`);
          }),
          refreshProject: vi.fn(async (directory: string) => {
            if (directory === targetDirectory) {
              return targetBootstrap;
            }
            return sourceBootstrap;
          }),
          createSession: vi.fn(async () => ({ id: "unused", slug: "unused", title: "unused", time: { created: now, updated: now } })),
          getSessionRuntime: getSessionRuntimeMock,
          sendPrompt: vi.fn(async () => true),
          deleteSession: vi.fn(async () => true),
        },
      },
    });

    const { result } = renderHook(() =>
      useWorkspaceState({
        setStatusLine: vi.fn(),
        terminalTabIds: [],
        setTerminalTabs: vi.fn(),
        setActiveTerminalId: vi.fn(),
        setTerminalOpen: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.setActiveProjectDir(sourceDirectory);
      result.current.setActiveSessionID(sourceSessionId);
      await result.current.selectProject(targetDirectory);
      result.current.selectSession(targetSessionId, targetDirectory);
    });

    expect(result.current.activeProjectDir).toBe(targetDirectory);
    expect(result.current.activeSessionID).toBe(targetSessionId);
    expect(getSessionRuntimeMock).toHaveBeenCalledWith(targetDirectory, targetSessionId);
  });
});
