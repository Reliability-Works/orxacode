/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeChatService } from "./claude-chat-service";
import { query, renameSession, tagSession } from "@anthropic-ai/claude-agent-sdk";
import { ProviderSessionDirectory } from "./provider-session-directory";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  renameSession: vi.fn(),
  tagSession: vi.fn(),
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
    vi.mocked(renameSession).mockReset();
    vi.mocked(tagSession).mockReset();
  });

  it("maps task and child-thread events into structured background-agent notifications", async () => {
    const service = new ClaudeChatService(new ProviderSessionDirectory());
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
          tool_use_id: "toolu-task-1",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            server_tool_use: {
              web_search_requests: 0,
            },
            service_tier: "standard",
          },
        },
        {
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          status: "completed",
          summary: "Done",
          tool_use_id: "toolu-task-1",
          output_file: "/tmp/result.txt",
          usage: {
            input_tokens: 11,
            output_tokens: 6,
            server_tool_use: {
              web_search_requests: 0,
            },
            service_tier: "standard",
          },
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
        expect.objectContaining({
          method: "task/progress",
          params: expect.objectContaining({
            taskId: "task-1",
            lastToolName: "Bash",
            toolUseId: "toolu-task-1",
            usage: expect.objectContaining({
              input_tokens: 10,
              output_tokens: 5,
            }),
          }),
        }),
        expect.objectContaining({
          method: "task/completed",
          params: expect.objectContaining({
            taskId: "task-1",
            toolUseId: "toolu-task-1",
            outputFile: "/tmp/result.txt",
            usage: expect.objectContaining({
              input_tokens: 11,
              output_tokens: 6,
            }),
          }),
        }),
      ]),
    );

    const assistantIndex = notifications.findIndex((entry) => entry.method === "assistant/message");
    const thinkingStoppedIndex = notifications.findIndex((entry) => entry.method === "thinking/stopped");
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(thinkingStoppedIndex).toBeGreaterThan(assistantIndex);
  });

  it("passes Claude plan mode through to the SDK query options", async () => {
    const service = new ClaudeChatService(new ProviderSessionDirectory());

    vi.mocked(query).mockReturnValue(createQueryStream([]) as never);

    await service.startTurn("session-2", "/tmp/project", "plan this", {
      model: "claude-sonnet-4-6",
      permissionMode: "plan",
    });

    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          permissionMode: "plan",
          settingSources: ["user", "project", "local"],
        }),
      }),
    );
  });

  it("migrates a legacy Claude renderer session id into the provider directory and resumes it", async () => {
    const directory = new ProviderSessionDirectory();
    vi.spyOn(directory, "getLegacyRendererValue").mockReturnValue(JSON.stringify({
      providerThreadId: "claude-thread-restore",
      messages: [],
      historyMessages: [],
      isStreaming: false,
      messageIdCounter: 0,
      subagents: [],
    }));
    const setLegacyRendererValue = vi.spyOn(directory, "setLegacyRendererValue").mockImplementation(() => undefined);
    const service = new ClaudeChatService(directory);

    vi.mocked(query).mockReturnValue(createQueryStream([]) as never);

    await service.startTurn("session-restore", "/tmp/project", "continue");

    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: "claude-thread-restore",
        }),
      }),
    );
    expect(directory.getBinding("session-restore", "claude-chat")).toEqual(
      expect.objectContaining({
        resumeCursor: { resume: "claude-thread-restore" },
        runtimePayload: { directory: "/tmp/project" },
      }),
    );
    expect(setLegacyRendererValue).toHaveBeenCalled();
  });

  it("sends attached images through the Claude SDK user-message stream", async () => {
    const service = new ClaudeChatService(new ProviderSessionDirectory());

    vi.mocked(query).mockReturnValue(createQueryStream([]) as never);

    await service.startTurn("session-images", "/tmp/project", "Describe this screenshot", {
      model: "claude-sonnet-4-6",
      attachments: [
        {
          path: "/tmp/fake.png",
          url: "data:image/png;base64,QQ==",
          filename: "fake.png",
          mime: "image/png",
        },
      ],
    });

    const promptInput = vi.mocked(query).mock.calls[0]?.[0]?.prompt;
    expect(typeof promptInput).not.toBe("string");
    expect(promptInput).toBeDefined();

    const iterator = (promptInput as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "QQ==",
            },
          },
          {
            type: "text",
            text: "Describe this screenshot",
          },
        ],
      },
    });
  });

  it("ignores tool-use payload JSON in assistant text and keeps tool summaries structured", async () => {
    const service = new ClaudeChatService(new ProviderSessionDirectory());
    const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];

    service.on("notification", (payload) => {
      notifications.push(payload);
    });

    vi.mocked(query).mockReturnValue(
      createQueryStream([
        {
          type: "stream_event",
          uuid: "partial-tool-input",
          session_id: "main-thread",
          event: { type: "content_block_delta", delta: { partial_json: '{"subagent_type":"Explore"}' } },
        },
        {
          type: "assistant",
          uuid: "assistant-tool-use",
          session_id: "main-thread",
          message: {
            content: [
              { type: "text", text: "Now I can see the website directories. Let me spin up agents." },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Task",
                input: { subagent_type: "Explore", description: "Explore athena-pumping site" },
              },
            ],
          },
        },
        {
          type: "tool_progress",
          uuid: "tool-progress-1",
          session_id: "main-thread",
          tool_use_id: "toolu_1",
          tool_name: "Task",
          parent_tool_use_id: null,
          elapsed_time_seconds: 1.25,
        },
        {
          type: "tool_use_summary",
          uuid: "tool-summary-1",
          session_id: "main-thread",
          summary: "Queued 1 background task",
          preceding_tool_use_ids: ["toolu_1"],
        },
      ]) as never,
    );

    await service.startTurn("session-tools", "/tmp/project", "spin up subagents", {
      model: "claude-sonnet-4-6",
      permissionMode: "ask-write",
    });

    expect(notifications).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "assistant/partial",
          params: expect.objectContaining({
            content: expect.stringContaining("subagent_type"),
          }),
        }),
      ]),
    );

    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "assistant/message",
          params: expect.objectContaining({
            content: "Now I can see the website directories. Let me spin up agents.",
          }),
        }),
        expect.objectContaining({
          method: "tool/completed",
          params: expect.objectContaining({
            id: "toolu_1",
            toolName: "Task",
            summary: "Queued 1 background task",
            precedingToolUseIds: ["toolu_1"],
          }),
        }),
        expect.objectContaining({
          method: "tool/progress",
          params: expect.objectContaining({
            id: "toolu_1",
            toolName: "Task",
            parentToolUseId: null,
          }),
        }),
      ]),
    );
  });

  it("removes persisted Claude bindings when archiving a session", async () => {
    const directory = new ProviderSessionDirectory();
    const service = new ClaudeChatService(directory);

    directory.upsert({
      provider: "claude-chat",
      sessionKey: "session-archive",
      status: "running",
      resumeCursor: { resume: "claude-thread-archive" },
      runtimePayload: { directory: "/tmp/project" },
    });

    await service.archiveSession("session-archive");

    expect(directory.getBinding("session-archive", "claude-chat")).toBeNull();
  });

  it("renames Claude provider sessions through the SDK", async () => {
    const service = new ClaudeChatService();

    await service.renameProviderSession("claude-thread-1", "New Claude Title", "/tmp/project");

    expect(vi.mocked(renameSession)).toHaveBeenCalledWith("claude-thread-1", "New Claude Title", { dir: "/tmp/project" });
  });

  it("dedupes and caches Claude health checks for a short TTL", async () => {
    vi.useFakeTimers();
    const service = new ClaudeChatService();
    const fetchHealth = vi
      .spyOn(service as unknown as { fetchHealth: () => Promise<unknown> }, "fetchHealth")
      .mockResolvedValue({
        available: true,
        authenticated: true,
        version: "1.2.3",
      });

    const [first, second] = await Promise.all([service.health(), service.health()]);

    expect(first).toEqual(second);
    expect(fetchHealth).toHaveBeenCalledTimes(1);

    await service.health();
    expect(fetchHealth).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_001);
    await service.health();
    expect(fetchHealth).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("archives a provider child session by tagging it archived", async () => {
    const service = new ClaudeChatService();

    await service.archiveProviderSession("child-session-1", "/tmp/project");

    expect(vi.mocked(tagSession)).toHaveBeenCalledWith("child-session-1", "archived", { dir: "/tmp/project" });
  });

  it("cancels pending Claude approvals and inputs when interrupting a session", async () => {
    const service = new ClaudeChatService();
    const interrupt = vi.fn(async () => undefined);
    const resolveApproval = vi.fn();
    const resolveInput = vi.fn();

    (service as unknown as {
      sessions: Map<string, unknown>;
      pendingApprovals: Map<string, unknown>;
      pendingUserInputs: Map<string, unknown>;
    }).sessions.set("session-interrupt", {
      state: { sessionKey: "session-interrupt", status: "connected", activeTurnId: "turn-1" },
      directory: "/tmp/project",
      activeQuery: { interrupt },
      runningTasks: [],
      toolNamesById: new Map(),
    });
    (service as unknown as { pendingApprovals: Map<string, unknown> }).pendingApprovals.set("approval-1", {
      sessionKey: "session-interrupt",
      turnId: "turn-1",
      itemId: "item-1",
      toolName: "Task",
      resolve: resolveApproval,
    });
    (service as unknown as { pendingUserInputs: Map<string, unknown> }).pendingUserInputs.set("input-1", {
      sessionKey: "session-interrupt",
      turnId: "turn-1",
      request: { message: "Need a value", requestedSchema: undefined },
      resolve: resolveInput,
    });

    await service.interruptTurn("session-interrupt");

    expect(resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "deny",
        toolUseID: "item-1",
        interrupt: true,
      }),
    );
    expect(resolveInput).toHaveBeenCalledWith({ action: "cancel" });
    expect(interrupt).toHaveBeenCalledTimes(1);
  });
});
