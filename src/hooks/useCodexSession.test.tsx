import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCodexSession } from './useCodexSession'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  SESSION_KEY,
  buildOrxaCodex,
  registerCodexSessionTestLifecycle,
} from './useCodexSession.test-helpers'

registerCodexSessionTestLifecycle()

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
    expect(window.orxa!.codex.startTurn).toHaveBeenCalledWith("thr-1", "hello world", "/workspace", undefined, undefined, undefined, undefined);
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

    expect(window.orxa!.codex.startTurn).toHaveBeenCalledWith("thr-1", "hello world", "/workspace", undefined, undefined, undefined, undefined);
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

  it("acceptPlan starts an explicit default-mode implementation turn", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      await result.current.startThread();
    });
    await act(async () => {
      await result.current.acceptPlan({
        collaborationMode: "default",
        model: "gpt-5.4",
        effort: "medium",
        planItemId: "plan-tool-1",
      });
    });

    expect(window.orxa!.codex.startTurn).toHaveBeenCalledWith(
      "thr-1",
      "Implement the plan.",
      "/workspace",
      "gpt-5.4",
      "medium",
      "default",
      undefined,
    );
    expect(result.current.dismissedPlanIds.has("plan-tool-1")).toBe(true);
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

