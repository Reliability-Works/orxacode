import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_SESSION_PTY_TITLE_PREFIX } from "@shared/ipc";
import type { ProjectBootstrap, SessionMessageBundle, SessionRuntimeSnapshot } from "@shared/ipc";
import { normalizeMessageBundles } from "../lib/opencode-event-reducer";
import { EMPTY_WORKSPACE_SESSIONS_KEY, useWorkspaceState } from "./useWorkspaceState";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

function createProjectBootstrap(
  directory: string,
  sessions: Array<{ id: string; time: { updated: number } }>,
  ptys: Array<{ id: string; title: string; command?: string; args?: string[]; cwd?: string; status?: "running" | "exited"; pid?: number }> = [],
): ProjectBootstrap {
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
    ptys,
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
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  };
}

describe("useWorkspaceState", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUnifiedRuntimeStore.setState({
      activeWorkspaceDirectory: undefined,
      activeSessionID: undefined,
      activeProvider: undefined,
      pendingSessionId: undefined,
      projectDataByDirectory: {},
      workspaceMetaByDirectory: {},
      opencodeSessions: {},
      codexSessions: {},
      claudeSessions: {},
      sessionReadTimestamps: {},
      collapsedProjects: {},
    });
  });

  it("creates sessions with the requested permission mode", async () => {
    const directory = "/repo";
    const now = Date.now();
    const createdSession = {
      id: "session-created",
      slug: "session-created",
      title: "OpenCode Session",
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
          availableAgentNames: new Set<string>(),
          permissionMode: "yolo-write",
        },
      );
    });

    expect(createSessionMock).toHaveBeenCalledWith(directory, "OpenCode Session", "yolo-write");
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
      title: "OpenCode Session",
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

  it("deletes an empty OpenCode session before creating the next one in the same workspace", async () => {
    const directory = "/repo";
    const now = Date.now();
    const createSessionMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: "session-empty",
        slug: "session-empty",
        title: "OpenCode Session",
        time: { created: now, updated: now },
      })
      .mockResolvedValueOnce({
        id: "session-next",
        slug: "session-next",
        title: "OpenCode Session",
        time: { created: now + 1, updated: now + 1 },
      });
    const deleteSessionMock = vi.fn(async () => true);
    const refreshProjectMock = vi
      .fn()
      .mockResolvedValueOnce(createProjectBootstrap(directory, [{ id: "session-empty", time: { updated: now } }]))
      .mockResolvedValueOnce(createProjectBootstrap(directory, [{ id: "session-next", time: { updated: now + 1 } }]));

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
          refreshProject: refreshProjectMock,
          createSession: createSessionMock,
          deleteSession: deleteSessionMock,
          getSessionRuntime: vi.fn(async (currentDirectory: string, sessionID: string) =>
            createRuntimeSnapshot(currentDirectory, sessionID, [])),
          sendPrompt: vi.fn(async () => true),
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
      result.current.setActiveProjectDir(directory);
      await (result.current.createSession as unknown as (directory: string) => Promise<void>)(directory);
    });

    await act(async () => {
      await (result.current.createSession as unknown as (directory: string) => Promise<void>)(directory);
    });

    expect(deleteSessionMock).toHaveBeenCalledWith(directory, "session-empty");
    expect(deleteSessionMock.mock.invocationCallOrder[0]).toBeLessThan(createSessionMock.mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER);
    expect(result.current.activeSessionID).toBe("session-next");
  });

  it("can switch workspaces without forcing the landing state when a target session is known", async () => {
    const targetDirectory = "/repo/target";
    const targetSessionID = "session-target";
    const now = Date.now();
    const targetBootstrap = createProjectBootstrap(targetDirectory, [{ id: targetSessionID, time: { updated: now } }]);

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => targetBootstrap),
          refreshProject: vi.fn(async () => targetBootstrap),
          createSession: vi.fn(async () => ({ id: "unused", slug: "unused", title: "unused", time: { created: now, updated: now } })),
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
      await (result.current.selectProject as unknown as (directory: string, options?: unknown) => Promise<void>)(
        targetDirectory,
        { showLanding: false, sessionID: targetSessionID },
      );
    });

    expect(result.current.activeProjectDir).toBe(targetDirectory);
    expect(result.current.activeSessionID).toBe(targetSessionID);
  });

  it("cleans up persisted empty sessions on startup", async () => {
    const directory = "/repo";
    const deleteSessionMock = vi.fn(async () => true);
    const onCleanupEmptySession = vi.fn(async () => undefined);

    window.localStorage.setItem(EMPTY_WORKSPACE_SESSIONS_KEY, JSON.stringify({
      "session-empty": directory,
    }));

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
          refreshProject: vi.fn(async () => createProjectBootstrap(directory, [])),
          createSession: vi.fn(async () => ({ id: "unused", slug: "unused", title: "unused", time: { created: 1, updated: 1 } })),
          deleteSession: deleteSessionMock,
          getSessionRuntime: vi.fn(async (currentDirectory: string, sessionID: string) =>
            createRuntimeSnapshot(currentDirectory, sessionID, [])),
          sendPrompt: vi.fn(async () => true),
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
        onCleanupEmptySession,
      }),
    );

    await act(async () => {
      await result.current.cleanupPersistedEmptySessions();
    });

    expect(deleteSessionMock).toHaveBeenCalledWith(directory, "session-empty");
    expect(onCleanupEmptySession).toHaveBeenCalledWith(directory, "session-empty");
    expect(window.localStorage.getItem(EMPTY_WORKSPACE_SESSIONS_KEY)).toBeNull();
  });

  it("refreshes messages immediately after sending the initial prompt for a new session", async () => {
    const directory = "/repo";
    const now = Date.now();
    const createdSession = {
      id: "session-created",
      slug: "session-created",
      title: "Which agent are you",
      time: { created: now, updated: now },
    };

    const refreshProjectMock = vi.fn(async () => createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }]));
    const sendPromptMock = vi.fn(async () => true);
    const getSessionRuntimeMock = vi.fn(async (_directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, []));

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
          refreshProject: refreshProjectMock,
          createSession: vi.fn(async () => createdSession),
          getSessionRuntime: getSessionRuntimeMock,
          sendPrompt: sendPromptMock,
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
      await (result.current.createSession as unknown as (directory: string, prompt?: string, options?: unknown) => Promise<void>)(
        directory,
        "Which agent are you",
        {
          selectedAgent: "builder",
          availableAgentNames: new Set(["builder"]),
        },
      );
    });

    expect(sendPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      agent: "builder",
      text: "Which agent are you",
    }));
    expect(getSessionRuntimeMock).toHaveBeenCalledWith(expect.any(String), createdSession.id);
  });

  it("applies raw opencode stream events to the active session without waiting for a refresh", async () => {
    const directory = "/repo";
    const now = Date.now();
    const createdSession = {
      id: "session-created",
      slug: "session-created",
      title: "OpenCode Session",
      time: { created: now, updated: now },
    };

    const getSessionRuntimeMock = vi.fn(async (_directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, []));

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => createProjectBootstrap(directory, [])),
          refreshProject: vi.fn(async () => ({
            ...createProjectBootstrap(directory, [{ id: createdSession.id, time: { updated: now } }]),
            sessionStatus: {
              [createdSession.id]: { type: "busy" },
            },
          })),
          createSession: vi.fn(async () => createdSession),
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
      await (result.current.createSession as unknown as (directory: string, prompt?: string, options?: unknown) => Promise<void>)(
        directory,
        "Build this",
        { availableAgentNames: new Set<string>() },
      );
    });

    await act(async () => {
      result.current.applyOpencodeStreamEvent(directory, {
        type: "message.updated",
        properties: {
          info: {
            id: "assistant-1",
            role: "assistant",
            sessionID: createdSession.id,
            time: { created: now + 1, updated: now + 1 },
          },
        },
      } as never);
    });

    const state = useUnifiedRuntimeStore.getState();
    const sessionKey = `opencode::${directory}::${createdSession.id}`;
    expect(state.opencodeSessions[sessionKey]?.messages.map((bundle) => bundle.info.id)).toContain("assistant-1");
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

  it("keeps previously loaded workspace sessions cached when selecting another workspace", async () => {
    const sourceDirectory = "/repo/source";
    const targetDirectory = "/repo/target";
    const now = Date.now();
    const sourceBootstrap = createProjectBootstrap(sourceDirectory, [{ id: "session-source", time: { updated: now - 100 } }]);
    const targetBootstrap = createProjectBootstrap(targetDirectory, [{ id: "session-target", time: { updated: now } }]);

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
            if (directory === sourceDirectory) {
              return sourceBootstrap;
            }
            if (directory === targetDirectory) {
              return targetBootstrap;
            }
            throw new Error(`unexpected directory ${directory}`);
          }),
          createSession: vi.fn(),
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
      await result.current.selectProject(sourceDirectory);
    });

    await act(async () => {
      await result.current.selectProject(targetDirectory);
    });

    const state = useUnifiedRuntimeStore.getState();
    expect(state.projectDataByDirectory[sourceDirectory]?.sessions.map((session) => session.id)).toEqual(["session-source"]);
    expect(state.projectDataByDirectory[targetDirectory]?.sessions.map((session) => session.id)).toEqual(["session-target"]);
  });

  it("closes the integrated terminal when switching workspaces", async () => {
    const directory = "/repo/target";
    const projectBootstrap = createProjectBootstrap(directory, []);
    const setTerminalOpen = vi.fn();

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => projectBootstrap),
          refreshProject: vi.fn(async () => projectBootstrap),
          createSession: vi.fn(async () => ({ id: "unused", slug: "unused", title: "unused", time: { created: Date.now(), updated: Date.now() } })),
          getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, [])),
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
        setTerminalOpen,
      }),
    );

    await act(async () => {
      await result.current.selectProject(directory);
    });

    expect(setTerminalOpen).toHaveBeenCalledWith(false);
  });

  it("filters Claude-owned PTYs out of integrated terminal hydration", async () => {
    const directory = "/repo/target";
    const projectBootstrap = createProjectBootstrap(
      directory,
      [],
      [
        {
          id: "pty-claude",
          title: `${CLAUDE_SESSION_PTY_TITLE_PREFIX}full`,
          command: "/bin/zsh",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
        {
          id: "pty-shell",
          title: "shell",
          command: "/bin/zsh",
          args: [],
          cwd: directory,
          status: "running",
          pid: 2,
        },
      ],
    );
    const setTerminalTabs = vi.fn();
    const setActiveTerminalId = vi.fn();

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          selectProject: vi.fn(async () => projectBootstrap),
          refreshProject: vi.fn(async () => projectBootstrap),
          createSession: vi.fn(async () => ({ id: "unused", slug: "unused", title: "unused", time: { created: Date.now(), updated: Date.now() } })),
          getSessionRuntime: vi.fn(async (_directory: string, sessionID: string) => createRuntimeSnapshot(directory, sessionID, [])),
          sendPrompt: vi.fn(async () => true),
          deleteSession: vi.fn(async () => true),
        },
      },
    });

    const { result } = renderHook(() =>
      useWorkspaceState({
        setStatusLine: vi.fn(),
        terminalTabIds: [],
        setTerminalTabs,
        setActiveTerminalId,
        setTerminalOpen: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.selectProject(directory);
    });

    expect(setTerminalTabs).toHaveBeenCalledWith([{ id: "pty-shell", label: "Tab 1" }]);
    expect(setActiveTerminalId).toHaveBeenCalledWith("pty-shell");
  });
});
