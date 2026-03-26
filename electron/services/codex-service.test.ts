/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { buildRunMetadataPrompt, CodexService, parseRunMetadataValue } from "./codex-service";

describe("CodexService metadata helpers", () => {
  it("builds the metadata prompt with the task text", () => {
    const prompt = buildRunMetadataPrompt("Fix the workspace sidebar race");

    expect(prompt).toContain("Return ONLY a JSON object");
    expect(prompt).toContain("Fix the workspace sidebar race");
  });

  it("parses JSON metadata responses", () => {
    expect(
      parseRunMetadataValue('{"title":"Fix Workspace Session Naming","worktreeName":"fix/workspace-session-naming"}'),
    ).toEqual({
      title: "Fix Workspace Session Naming",
      worktreeName: "fix/workspace-session-naming",
    });
  });

  it("parses metadata wrapped in surrounding text", () => {
    expect(
      parseRunMetadataValue('Result:\n{"title":"Add Codex Thread Rename","worktreeName":"feat/codex-thread-rename"}\nDone.'),
    ).toEqual({
      title: "Add Codex Thread Rename",
      worktreeName: "feat/codex-thread-rename",
    });
  });

  it("throws when metadata is missing required fields", () => {
    expect(() => parseRunMetadataValue('{"title":""}')).toThrow(/missing title|missing worktree/i);
  });
});

describe("CodexService archive semantics", () => {
  it("treats a missing rollout during archive as already archived", async () => {
    const service = new CodexService();
    const request = vi.fn(async (method: string) => {
      if (method === "thread/archive") {
        throw new Error("no rollout found for thread id 019d0aab-c237-7783-8e5f-bf32a98f72e1");
      }
      return {};
    });
    const ensureConnected = vi.fn(async () => undefined);
    const cleanupThreadMappings = vi.fn();

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      ensureConnected,
      cleanupThreadMappings,
    });

    await expect(service.archiveThread("019d0aab-c237-7783-8e5f-bf32a98f72e1")).resolves.toBeUndefined();
    expect(ensureConnected).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("thread/archive", {
      threadId: "019d0aab-c237-7783-8e5f-bf32a98f72e1",
    });
    expect(cleanupThreadMappings).toHaveBeenCalledWith("019d0aab-c237-7783-8e5f-bf32a98f72e1");
  });

  it("still throws archive errors that are not missing-rollout cases", async () => {
    const service = new CodexService();
    const request = vi.fn(async (method: string) => {
      if (method === "thread/archive") {
        throw new Error("permission denied");
      }
      return {};
    });

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      ensureConnected: vi.fn(async () => undefined),
      cleanupThreadMappings: vi.fn(),
    });

    await expect(service.archiveThread("thr-1")).rejects.toThrow("permission denied");
  });
});

describe("CodexService turn steering", () => {
  it("parses collaboration modes when app-server omits ids", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({
      data: [
        { name: "Plan", mode: "plan", model: null, reasoning_effort: "medium" },
        { name: "Default", mode: "default", model: null, reasoning_effort: null },
      ],
    }));

    Object.assign(service as unknown as Record<string, unknown>, {
      process: {} as object,
      ensureConnected: vi.fn(async () => undefined),
      request,
    });

    await expect(service.listCollaborationModes()).resolves.toEqual([
      {
        id: "plan",
        label: "Plan",
        mode: "plan",
        model: "",
        reasoningEffort: "medium",
        developerInstructions: "",
      },
      {
        id: "default",
        label: "Default",
        mode: "default",
        model: "",
        reasoningEffort: "",
        developerInstructions: "",
      },
    ]);
  });

  it("includes required collaboration mode settings when starting a turn", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({}));

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      _collaborationModes: [
        {
          id: "default",
          label: "Default",
          mode: "default",
          model: "gpt-5.4",
          reasoningEffort: "high",
          developerInstructions: "",
        },
      ],
    });

    await service.startTurn({
      threadId: "thread-1",
      prompt: "Implement the plan.",
      collaborationMode: "default",
    });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [{ type: "text", text: "Implement the plan.", text_elements: [] }],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "high",
          developer_instructions: null,
        },
      },
    });
  });

  it("falls back to stored thread settings when plan acceptance omits model and effort", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({}));

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
      _collaborationModes: [
        {
          id: "default",
          label: "Default",
          mode: "default",
          model: "",
          reasoningEffort: "",
          developerInstructions: "",
        },
      ],
      threadSettings: new Map([
        ["thread-1", { model: "gpt-5.4", reasoningEffort: "medium" }],
      ]),
    });

    await service.startTurn({
      threadId: "thread-1",
      prompt: "Implement the plan.",
      collaborationMode: "default",
    });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [{ type: "text", text: "Implement the plan.", text_elements: [] }],
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.4",
          reasoning_effort: "medium",
          developer_instructions: null,
        },
      },
    });
  });

  it("includes image attachments in turn/start input items", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({}));

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    });

    await service.startTurn({
      threadId: "thread-1",
      prompt: "Inspect this image",
      attachments: [{ type: "image", url: "data:image/png;base64,AAAA" }],
    });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        { type: "text", text: "Inspect this image", text_elements: [] },
        { type: "image", url: "data:image/png;base64,AAAA" },
      ],
    });
  });

  it("resumes a persisted thread before the first turn after process restart", async () => {
    const service = new CodexService();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "thread/resume") {
        return { thread: { id: params.threadId } };
      }
      return {};
    });
    vi.spyOn(service as unknown as { ensureConnected: (cwd?: string) => Promise<void> }, "ensureConnected").mockResolvedValue(undefined);

    Object.assign(service as unknown as Record<string, unknown>, {
      process: {} as object,
      request,
    });

    await service.startTurn({
      threadId: "thread-restore",
      prompt: "Continue the existing thread",
    });

    expect(request).toHaveBeenNthCalledWith(1, "thread/resume", { threadId: "thread-restore" });
    expect(request).toHaveBeenNthCalledWith(2, "turn/start", {
      threadId: "thread-restore",
      input: [{ type: "text", text: "Continue the existing thread", text_elements: [] }],
    });
  });

  it("supports image-only Codex turns", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({}));

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    });

    await service.startTurn({
      threadId: "thread-1",
      prompt: "",
      attachments: [{ type: "image", url: "data:image/png;base64,BBBB" }],
    });

    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [{ type: "image", url: "data:image/png;base64,BBBB" }],
    });
  });

  it("sends turn/steer with expectedTurnId and text input", async () => {
    const service = new CodexService();
    const request = vi.fn(async () => ({}));

    Object.assign(service as unknown as Record<string, unknown>, {
      request,
    });

    await service.steerTurn("thread-1", "turn-1", "continue with this");

    expect(request).toHaveBeenCalledWith("turn/steer", {
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "continue with this", text_elements: [] }],
    });
  });
});
