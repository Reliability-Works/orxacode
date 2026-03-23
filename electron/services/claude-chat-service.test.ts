/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeChatService } from "./claude-chat-service";
import { query } from "@anthropic-ai/claude-agent-sdk";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
}));

function createQueryStream(messages: unknown[]) {
  return {
    interrupt: vi.fn(async () => undefined),
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    },
  };
}

describe("ClaudeChatService", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it("maps task and child-thread events into structured background-agent notifications", async () => {
    const service = new ClaudeChatService();
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
    const states: Array<{ status: string; providerThreadId?: string; activeTurnId?: string | null }> = [];

    service.on("notification", (payload) => {
      notifications.push(payload);
    });
    service.on("state", (payload) => {
      states.push(payload);
    });

    vi.mocked(query).mockReturnValue(
      createQueryStream([
        {
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          description: "Investigate the failing flow",
          prompt: "Look into the bug",
          task_type: "researcher",
        },
        {
          type: "stream_event",
          uuid: "main-partial",
          session_id: "main-thread",
          event: { type: "content_block_delta", delta: { text: "Hi" } },
        },
        {
          type: "stream_event",
          uuid: "child-partial",
          session_id: "child-thread",
          event: { type: "content_block_delta", delta: { text: "" } },
        },
        {
          type: "system",
          subtype: "task_progress",
          task_id: "task-1",
          description: "Investigate the failing flow",
          summary: "Checking logs",
          last_tool_name: "Bash",
        },
        {
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          status: "completed",
          summary: "Done",
        },
        {
          type: "assistant",
          uuid: "assistant-1",
          session_id: "main-thread",
          message: { text: "Fixed it." },
        },
      ]) as never,
    );

    await service.startTurn("session-1", "/tmp/project", "hello", {
      model: "claude-sonnet-4-6",
      permissionMode: "ask-write",
    });

    expect(states.at(-1)).toMatchObject({
      status: "connected",
      providerThreadId: "main-thread",
      activeTurnId: null,
    });
    expect(notifications.map((entry) => entry.method)).toEqual(
      expect.arrayContaining([
        "turn/started",
        "task/started",
        "thread/started",
        "task/progress",
        "task/completed",
        "assistant/message",
        "turn/completed",
      ]),
    );
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "thread/started",
          params: expect.objectContaining({ providerThreadId: "child-thread", isSubagent: true, taskId: "task-1" }),
        }),
      ]),
    );
  });

  it("passes Claude plan mode through to the SDK query options", async () => {
    const service = new ClaudeChatService();

    vi.mocked(query).mockReturnValue(createQueryStream([]) as never);

    await service.startTurn("session-2", "/tmp/project", "plan this", {
      model: "claude-sonnet-4-6",
      permissionMode: "plan",
    });

    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "plan",
        }),
      }),
    );
  });
});
