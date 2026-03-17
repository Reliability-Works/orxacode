import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useCodexSession } from "./useCodexSession";

function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({ status: "connected" as const, serverInfo: { name: "codex", version: "1.0.0" } })),
    stop: vi.fn(async () => ({ status: "disconnected" as const })),
    getState: vi.fn(async () => ({ status: "disconnected" as const })),
    startThread: vi.fn(async () => ({ id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() })),
    listThreads: vi.fn(async () => ({ threads: [], nextCursor: undefined })),
    startTurn: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    deny: vi.fn(async () => undefined),
    respondToUserInput: vi.fn(async () => undefined),
  };
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  };
}

describe("useCodexSession", () => {
  beforeEach(() => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;
  });

  afterEach(() => {
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("starts with disconnected status", () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    expect(result.current.connectionStatus).toBe("disconnected");
  });

  it("has null thread initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    expect(result.current.thread).toBeNull();
  });

  it("has empty messages initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    expect(result.current.messages).toEqual([]);
  });

  it("isStreaming is false initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    expect(result.current.isStreaming).toBe(false);
  });

  it("pendingApproval is null initially", () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    expect(result.current.pendingApproval).toBeNull();
  });

  it("connect calls codex.start with directory", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    await act(async () => {
      await result.current.connect();
    });
    expect(window.orxa!.codex.start).toHaveBeenCalledWith("/workspace");
  });

  it("disconnect calls codex.stop", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
    await act(async () => {
      await result.current.disconnect();
    });
    expect(window.orxa!.codex.stop).toHaveBeenCalled();
  });

  it("startThread calls codex.startThread with cwd", async () => {
    const { result } = renderHook(() => useCodexSession("/workspace"));
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
    const { result } = renderHook(() => useCodexSession("/workspace"));

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
    const { result } = renderHook(() => useCodexSession("/workspace"));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.lastError).toBe("Codex bridge not available");
  });
});
