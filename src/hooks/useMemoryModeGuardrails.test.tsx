import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionMessageBundle } from "@shared/ipc";
import { useMemoryModeGuardrails } from "./useMemoryModeGuardrails";

function assistantTextBundle(text: string): SessionMessageBundle {
  return {
    info: {
      role: "assistant",
      id: `assistant-${text.slice(0, 8)}`,
    },
    parts: [{ type: "text", text }],
  } as unknown as SessionMessageBundle;
}

function assistantToolBundle(tool: string): SessionMessageBundle {
  const now = Date.now();
  return {
    info: {
      role: "assistant",
      id: `assistant-tool-${tool}`,
      sessionID: "session-1",
      time: { created: now, updated: now },
    },
    parts: [
      {
        id: `part-tool-${tool}`,
        type: "tool",
        sessionID: "session-1",
        messageID: `assistant-tool-${tool}`,
        callID: `call-${tool}`,
        tool,
        state: {
          status: "completed",
          input: {},
          output: "",
          title: tool,
          metadata: {},
          time: { start: now, end: now },
        },
      },
    ],
  } as unknown as SessionMessageBundle;
}

describe("useMemoryModeGuardrails", () => {
  it("raises violation when assistant text references forbidden external memory services", async () => {
    const onGuardrailViolation = vi.fn();

    renderHook(() =>
      useMemoryModeGuardrails({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        memoryModeEnabled: true,
        messages: [assistantTextBundle("I'll store this in Pinecone and continue.")],
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
  });

  it("raises violation when assistant emits forbidden memory tool parts", async () => {
    const onGuardrailViolation = vi.fn();

    renderHook(() =>
      useMemoryModeGuardrails({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        memoryModeEnabled: true,
        messages: [assistantToolBundle("supermemory_search")],
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
  });

  it("does not raise violation for in-app ORXA memory lines", async () => {
    const onGuardrailViolation = vi.fn();

    renderHook(() =>
      useMemoryModeGuardrails({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        memoryModeEnabled: true,
        messages: [
          assistantTextBundle(
            '[ORXA_MEMORY] workspace="/repo" type="decision" tags="memory" content="Decision: keep in-app context enabled by default."',
          ),
        ],
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).not.toHaveBeenCalled();
    });
  });

  it("does not raise violation for internal SUPERMEMORY status lines", async () => {
    const onGuardrailViolation = vi.fn();

    renderHook(() =>
      useMemoryModeGuardrails({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        memoryModeEnabled: true,
        messages: [assistantTextBundle("[SUPERMEMORY] injected 2 items")],
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).not.toHaveBeenCalled();
    });
  });
});
