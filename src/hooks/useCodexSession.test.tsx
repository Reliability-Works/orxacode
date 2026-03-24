import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useCodexSession } from "./useCodexSession";
import { resetPersistedCodexStateForTests, setPersistedCodexState } from "./codex-session-storage";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

const SESSION_KEY = "/workspace::session-1";

function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({ status: "connected" as const, serverInfo: { name: "codex", version: "1.0.0" } })),
    stop: vi.fn(async () => ({ status: "disconnected" as const })),
    getState: vi.fn(async () => ({ status: "disconnected" as const })),
    startThread: vi.fn(async () => ({ id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() })),
    getThreadRuntime: vi.fn(async () => ({ thread: null, childThreads: [] })) as ReturnType<typeof vi.fn>,
    resumeThread: vi.fn(async () => ({ thread: null })) as ReturnType<typeof vi.fn>,
    listThreads: vi.fn(async () => ({ threads: [] as Array<Record<string, unknown>>, nextCursor: undefined })),
    archiveThreadTree: vi.fn(async () => undefined),
    startTurn: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    deny: vi.fn(async () => undefined),
    respondToUserInput: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    interruptThreadTree: vi.fn(async () => undefined),
  };
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  };
}

describe("useCodexSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPersistedCodexStateForTests();
    setPersistedCodexState(SESSION_KEY, {
      messages: [],
      thread: null,
      isStreaming: false,
      messageIdCounter: 0,
    });
    window.orxa = {
      codex: buildOrxaCodex(),
      opencode: {
        gitDiff: vi.fn(async () => "No local changes."),
        gitStatus: vi.fn(async () => ""),
        readProjectFile: vi.fn(async (_directory: string, relativePath: string) => ({
          path: `/workspace/${relativePath}`,
          relativePath,
          content: "",
          binary: false,
          truncated: false,
        })),
      },
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;
  });

  afterEach(() => {
    window.localStorage.clear();
    resetPersistedCodexStateForTests();
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("starts with disconnected status", () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("has null thread initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    expect(result.current.thread).toBeNull();
  });

  it("has empty messages initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    expect(result.current.messages).toEqual([]);
  });

  it("isStreaming is false initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    expect(result.current.isStreaming).toBe(false);
  });

  it("pendingApproval is null initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    expect(result.current.pendingApproval).toBeNull();
  });

  it("connect calls codex.start with directory", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    await act(async () => {
      await result.current.connect();
    });
    expect(window.orxa!.codex.start).toHaveBeenCalledWith("/workspace", undefined);
  });

  it("disconnect calls codex.stop", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    await act(async () => {
      await result.current.disconnect();
    });
    expect(window.orxa!.codex.stop).toHaveBeenCalled();
  });

  it("startThread calls codex.startThread with cwd", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    await act(async () => {
      await result.current.startThread({ title: "test" });
    });
    expect(window.orxa!.codex.startThread).toHaveBeenCalledWith({
      cwd: "/workspace",
      model: undefined,
      title: "test",
    });
  });

  it("sendMessage adds a user message and calls startTurn", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    // First connect and start thread
    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      await result.current.startThread();
    });

    await act(async () => {
      await result.current.sendMessage("hello world");
    });

    expect(result.current.messages.length).toBe(1);
    const item = result.current.messages[0];
    if (item?.kind !== "message") throw new Error("Expected a message item");
    expect(item.role).toBe("user");
    expect(item.content).toBe("hello world");
    expect(window.orxa!.codex.startTurn).toHaveBeenCalledWith("thr-1", "hello world", "/workspace", undefined, undefined, undefined);
  });

  it("sets lastError when codex bridge is missing", async () => {
    // @ts-expect-error test teardown
    delete window.orxa;
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.lastError).toBe("Codex bridge not available");
  });

  it("clears a stale lastError when a new turn starts successfully", async () => {
    const store = useUnifiedRuntimeStore.getState();
    store.initCodexSession(SESSION_KEY, "/workspace");
    store.setCodexConnectionState(SESSION_KEY, "connected", { name: "codex", version: "1.0.0" }, "insufficient quota");
    store.setCodexThread(SESSION_KEY, { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() });

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.sendMessage("hello world");
    });

    expect(window.orxa!.codex.startTurn).toHaveBeenCalledWith("thr-1", "hello world", "/workspace", undefined, undefined, undefined);
    expect(result.current.lastError).toBeUndefined();
  });

  it("unsubscribes from events on unmount", () => {
    const unsubscribe = vi.fn();
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn(() => unsubscribe),
      },
    } as unknown as typeof window.orxa;

    const { unmount } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps persisted state isolated per session key", async () => {
    const sessionOne = "/workspace::session-1";
    const sessionTwo = "/workspace::session-2";

    const { result: first, unmount } = renderHook(() => useCodexSession("/workspace", sessionOne));
    await act(async () => {
      await first.current.connect();
    });
    await act(async () => {
      await first.current.startThread();
    });
    await act(async () => {
      await first.current.sendMessage("session one");
    });
    expect(first.current.messages).toHaveLength(1);
    unmount();

    const { result: second } = renderHook(() => useCodexSession("/workspace", sessionTwo));
    expect(second.current.messages).toEqual([]);
    expect(second.current.thread).toBeNull();
  });

  it("ignores idle status notifications for other threads while the active turn is streaming", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr-1", turn: { id: "turn-1" } },
        },
      });
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/status/changed",
          params: { threadId: "other-thread", status: { type: "idle" } },
        },
      });
    });

    expect(result.current.isStreaming).toBe(true);
  });

  it("creates a live placeholder item when a command starts", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr-1", turn: { id: "turn-1" } },
        },
      });
    });

    expect(result.current.messages).toHaveLength(1);

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
              method: "item/started",
              params: { item: { id: "cmd-1", type: "commandExecution", command: ["rg", "foo"] } },
            },
          });
        });

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "explore" }),
      ]),
    );
  });

  it("emits a single updated task list status message for plan refreshes", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/plan/updated",
          params: {
            threadId: "thr-1",
            plan: [{ step: "Inspect repo", status: "completed" }],
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/plan/updated",
          params: {
            threadId: "thr-1",
            plan: [{ step: "Patch files", status: "in_progress" }],
          },
        },
      });
    });

    const statusMessages = result.current.messages.filter((message) => message.kind === "status");
    expect(statusMessages).toHaveLength(1);
    expect(statusMessages[0]).toMatchObject({ kind: "status", label: "Updated task list" });
    expect(result.current.planItems).toHaveLength(1);
  });

  it("creates a pending diff item when a file change starts", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: { threadId: "thr-1", item: { id: "file-1", type: "fileChange", path: "src/foo.ts" } },
        },
      });
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({
        kind: "diff",
        path: "src/foo.ts",
        diff: "",
      }),
    ]);
  });

  it("detects subagent threads from lower-case source metadata", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "thread-child",
              source: {
                subagent: {
                  role: "review",
                  thread_spawn: {
                    parent_thread_id: "thr-1",
                  },
                },
              },
            },
          },
        },
      });
    });

    expect(result.current.subagents).toHaveLength(1);
    expect(result.current.subagents[0]).toMatchObject({ threadId: "thread-child", role: "review" });
    expect(result.current.isSubagentThread("thread-child")).toBe(true);
  });

  it("ignores thread/started subagents that do not belong to the active parent thread", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "thread-foreign-child",
              source: {
                subAgent: {
                  role: "worker",
                  thread_spawn: {
                    parent_thread_id: "thread-somewhere-else",
                  },
                },
              },
            },
          },
        },
      });
    });

    expect(result.current.subagents).toHaveLength(0);
    expect(result.current.isSubagentThread("thread-foreign-child")).toBe(false);
  });

  it("queues an interrupt until the server announces the active turn id", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(codex.interruptTurn).toHaveBeenCalledWith("thr-1", "pending");

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { turn: { id: "turn-queued" } },
        },
      });
    });

    expect(codex.interruptTurn).toHaveBeenCalledWith("thr-1", "turn-queued");
  });

  it("does not route child thread output into the main Codex transcript", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: { threadId: "thr-1", turn: { id: "turn-main" } },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "thr-child-output",
              preview: "Scout repo",
              source: {
                subAgent: {
                  kind: "explorer",
                  nickname: "Scout",
                  role: "explorer",
                },
              },
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-child-output",
            item: {
              id: "child-agent-message-1",
              type: "agentMessage",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thr-child-output",
            itemId: "child-agent-message-1",
            delta: "Child agent output",
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([expect.objectContaining({ threadId: "thr-child-output" })]),
      );
    });
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "message", content: expect.stringContaining("Child agent output") })]),
    );
  });

  it("creates a live diff item so file change deltas are rendered", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-1",
              type: "fileChange",
              path: "src/app.tsx",
              changeType: "modified",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/fileChange/outputDelta",
          params: {
            threadId: "thr-1",
            itemId: "file-1",
            delta: "@@ -1 +1 @@\n-old\n+new",
          },
        },
      });
    });

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diff",
          path: "src/app.tsx",
          diff: "@@ -1 +1 @@\n-old\n+new",
        }),
      ]),
    );
  });

  it("attributes git diff changes to mutating command executions", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValueOnce([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"));
    window.orxa = {
      codex,
      opencode: {
        gitDiff,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-1",
              type: "commandExecution",
              command: ["/bin/zsh", "-lc", "rsync -a _template/ new-site/"],
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-1",
              type: "commandExecution",
              command: ["/bin/zsh", "-lc", "rsync -a _template/ new-site/"],
              exitCode: 0,
              aggregatedOutput: "",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/app/page.tsx",
            type: "modified",
            insertions: 1,
            deletions: 1,
          }),
        ]),
      );
    });
  });

  it("surfaces command-attributed diffs while a mutating command is still running", async () => {
    vi.useFakeTimers();
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValue([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"));
    const gitStatus = vi.fn<() => Promise<string>>().mockResolvedValue("");

    window.orxa = {
      codex,
      opencode: {
        gitDiff,
        gitStatus,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result, unmount } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-live-1",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
            },
          },
        },
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      result.current.messages.some((message) =>
        message.kind === "diff" &&
        message.path === "src/app/page.tsx" &&
        message.status === "running",
      ),
    ).toBe(true);

    unmount();
    vi.useRealTimers();
  });

  it("isolates command-attributed diffs from earlier dirty-file changes", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+before",
      ].join("\n"))
      .mockResolvedValueOnce([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+after",
      ].join("\n"));
    const readProjectFile = vi
      .fn<() => Promise<{ path: string; relativePath: string; content: string; binary: false; truncated: false }>>()
      .mockResolvedValueOnce({
        path: "/workspace/src/app/page.tsx",
        relativePath: "src/app/page.tsx",
        content: "before\n",
        binary: false,
        truncated: false,
      })
      .mockResolvedValueOnce({
        path: "/workspace/src/app/page.tsx",
        relativePath: "src/app/page.tsx",
        content: "after\n",
        binary: false,
        truncated: false,
      });
    window.orxa = {
      codex,
      opencode: {
        gitDiff,
        readProjectFile,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-2",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-2",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
              exitCode: 0,
              aggregatedOutput: "",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/app/page.tsx",
            diff: expect.stringContaining("-before"),
          }),
        ]),
      );
    });
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diff",
          diff: expect.stringContaining("-old"),
        }),
      ]),
    );
  });

  it("attributes new untracked files from git status when command diffs do not include them", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValueOnce("No local changes.");
    const gitStatus = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("?? src/new-page.tsx");
    const readProjectFile = vi
      .fn<() => Promise<{ path: string; relativePath: string; content: string; binary: false; truncated: false }>>()
      .mockResolvedValueOnce({
        path: "/workspace/src/new-page.tsx",
        relativePath: "src/new-page.tsx",
        content: "export default function Page() {}\n",
        binary: false,
        truncated: false,
      });

    window.orxa = {
      codex,
      opencode: {
        gitDiff,
        gitStatus,
        readProjectFile,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-3",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-3",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
              exitCode: 0,
              aggregatedOutput: "",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/new-page.tsx",
            type: "added",
            diff: expect.stringContaining("+++ b/src/new-page.tsx"),
          }),
        ]),
      );
    });
  });

  it("splits grouped file change summaries into one diff row per file", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-group-1",
              type: "fileChange",
              aggregatedOutput: [
                "Success. Updated the following files:",
                "M /workspace/src/package.json",
                "A /workspace/src/package-lock.json",
              ].join("\n"),
              exitCode: 0,
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/package.json",
            type: "modified",
          }),
          expect.objectContaining({
            kind: "diff",
            path: "src/package-lock.json",
            type: "added",
          }),
        ]),
      );
    });
  });

  it("hydrates grouped file change summaries with git diff hunks when available", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      opencode: {
        gitDiff: vi.fn(async () => [
          "## Unstaged",
          "diff --git a/src/package.json b/src/package.json",
          "--- a/src/package.json",
          "+++ b/src/package.json",
          "@@ -1 +1 @@",
          "-\"name\": \"old\"",
          "+\"name\": \"new\"",
          "diff --git a/src/package-lock.json b/src/package-lock.json",
          "--- /dev/null",
          "+++ b/src/package-lock.json",
          "@@ -0,0 +1 @@",
          "+{\"lock\":true}",
        ].join("\n")),
        gitStatus: vi.fn(async () => ""),
        readProjectFile: vi.fn(async (_directory: string, relativePath: string) => ({
          path: `/workspace/${relativePath}`,
          relativePath,
          content: "{\"lock\":true}\n",
          binary: false,
          truncated: false,
        })),
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-group-hydrated-1",
              type: "fileChange",
              aggregatedOutput: [
                "Success. Updated the following files:",
                "M /workspace/src/package.json",
                "A /workspace/src/package-lock.json",
              ].join("\n"),
              exitCode: 0,
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/package.json",
            diff: expect.stringContaining("+++ b/src/package.json"),
            insertions: 1,
            deletions: 1,
          }),
          expect.objectContaining({
            kind: "diff",
            path: "src/package-lock.json",
            diff: expect.stringContaining("+++ b/src/package-lock.json"),
            insertions: 1,
            deletions: 0,
          }),
        ]),
      );
    });
  });

  it("discovers subagent child threads from thread runtime polling", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    codex.getThreadRuntime = vi.fn(async () => ({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now(), activeTurnId: "turn-main" },
      childThreads: [
        {
          id: "thr-child-1",
          preview: "Docs cleanup worker",
          modelProvider: "openai",
          createdAt: Date.now(),
          status: { type: "running" },
          source: {
            subagent: {
              role: "worker",
              nickname: "Docs Worker",
              thread_spawn: { parent_thread_id: "thr-1" },
            },
          },
          activeTurnId: "turn-child-1",
        },
      ],
    }));
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: {
            threadId: "thr-1",
            turn: { id: "turn-main" },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "thr-child-1",
            nickname: "Docs Worker",
            status: "thinking",
          }),
        ]),
      );
    });
  });

  it("polls for child subagent threads even before local subagent state exists", async () => {
    const codex = buildOrxaCodex();
    codex.getThreadRuntime = vi.fn(async () => ({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now() },
      childThreads: [
        {
          id: "thr-child-2",
          preview: "Frontend worker",
          modelProvider: "openai",
          createdAt: Date.now(),
          status: { type: "running" },
          source: {
            subagent: {
              role: "worker",
              nickname: "Frontend Worker",
              thread_spawn: { parent_thread_id: "thr-1" },
            },
          },
          activeTurnId: "turn-child-2",
        },
      ],
    }));
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "thr-child-2",
            nickname: "Frontend Worker",
          }),
        ]),
      );
    });
  });

  it("preserves provisional subagents across transient empty runtime snapshots", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    codex.getThreadRuntime = vi.fn(async () => ({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now(), activeTurnId: "turn-main" },
      childThreads: [],
    }));
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "turn/started",
          params: {
            turn: { id: "turn-main", threadId: "thr-1" },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "child-provisional-1",
              preview: "Scout repo",
              source: {
                subAgent: {
                  kind: "explorer",
                  nickname: "Scout",
                  role: "explorer",
                },
              },
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "child-provisional-1",
            nickname: "Scout",
          }),
        ]),
      );
    });
  });

  it("hydrates child subagents from thread list when runtime snapshots omit them", async () => {
    const codex = buildOrxaCodex();
    codex.getThreadRuntime = vi.fn(async () => ({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now(), activeTurnId: "turn-main" },
      childThreads: [],
    }));
    codex.listThreads = vi.fn(async () => ({
      threads: [
        {
          id: "thr-child-3",
          preview: "Site explorer",
          modelProvider: "openai",
          createdAt: Date.now(),
          status: { type: "running" },
          source: {
            subagent: {
              role: "explorer",
              nickname: "Explorer Northline",
              thread_spawn: { parent_thread_id: "thr-1" },
            },
          },
          activeTurnId: "turn-child-3",
        },
      ] as Array<Record<string, unknown>>,
      nextCursor: undefined,
    }));
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "thr-child-3",
            nickname: "Explorer Northline",
          }),
        ]),
      );
    });
  });

  it("discovers child subagents from completed collab tool payloads", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "item-collab-complete-1",
              type: "collabToolCall",
              sender_thread_id: "thr-1",
              receiver_agents: [
                {
                  thread_id: "thr-child-4",
                  agent_nickname: "Athena",
                  agent_role: "explorer",
                },
              ],
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.subagents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            threadId: "thr-child-4",
            nickname: "Athena",
            role: "explorer",
          }),
        ]),
      );
    });
  });

  it("clears stale subagents when switching to a different session key", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result, rerender } = renderHook(
      ({ sessionKey }) => useCodexSession("/workspace", sessionKey),
      { initialProps: { sessionKey: SESSION_KEY } },
    );

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "thread/started",
          params: {
            thread: {
              id: "thread-child",
              source: {
                subagent: {
                  nickname: "Child Agent",
                  role: "worker",
                  thread_spawn: { parent_thread_id: "thr-1" },
                },
              },
            },
          },
        },
      });
    });

    expect(result.current.subagents).toHaveLength(1);

    rerender({ sessionKey: "/workspace::session-2" });

    expect(result.current.subagents).toEqual([]);
  });
});
