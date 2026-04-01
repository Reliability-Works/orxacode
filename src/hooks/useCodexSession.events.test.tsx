import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCodexSession } from './useCodexSession'
import {
  SESSION_KEY,
  buildOrxaCodex,
  registerCodexSessionTestLifecycle,
} from './useCodexSession.test-helpers'

registerCodexSessionTestLifecycle()

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

