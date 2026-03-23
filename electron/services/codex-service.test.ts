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
