import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCodexSession } from './useCodexSession'
import { setPersistedCodexState } from './codex-session-storage'
import {
  SESSION_KEY,
  buildOrxaCodex,
  buildOrxaEvents,
  registerCodexSessionTestLifecycle,
} from './useCodexSession.test-helpers'

registerCodexSessionTestLifecycle()

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

  it("pauses runtime polling while a plan is awaiting review", async () => {
    vi.useFakeTimers();
    const codex = buildOrxaCodex();
    codex.getThreadRuntime = vi.fn(async () => ({
      thread: { id: "thr-1", preview: "Main thread", modelProvider: "openai", createdAt: Date.now() },
      childThreads: [],
    }));
    window.orxa = {
      codex,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    setPersistedCodexState(SESSION_KEY, {
      messages: [{
        id: "plan-tool-1",
        kind: "tool",
        toolType: "plan",
        title: "plan",
        status: "completed",
        output: "## Plan\n\n- First step",
        timestamp: Date.now(),
      }],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: false,
      messageIdCounter: 1,
    });

    renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    const initialCallCount = codex.getThreadRuntime.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(codex.getThreadRuntime).toHaveBeenCalledTimes(initialCallCount);
    vi.useRealTimers();
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
