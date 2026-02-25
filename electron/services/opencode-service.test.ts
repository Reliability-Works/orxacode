/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { updateOrxaPluginInConfigDocument } from "./plugin-config";
import { hasRecentMatchingUserPrompt } from "./prompt-dedupe";
import { OpencodeService } from "./opencode-service";
import type { SessionMessageBundle } from "../../shared/ipc";

vi.mock("electron", () => ({
  app: {
    getName: () => "Opencode Orxa Test",
    getPath: () => "/tmp/orxa-opencode-service-test",
  },
}));

describe("updateOrxaPluginInConfigDocument", () => {
  it("adds Orxa plugin in Orxa mode", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3"
  ]
}\n`;

    const result = updateOrxaPluginInConfigDocument(input, "orxa");
    expect(result.changed).toBe(true);
    expect(result.output).toContain('"example/plugin@1.2.3"');
    expect(result.output).toContain('"@reliabilityworks/opencode-orxa@1.0.43"');
  });

  it("removes Orxa plugin in standard mode and stays idempotent", () => {
    const input = `{
  "plugin": [
    "example/plugin@1.2.3",
    "@reliabilityworks/opencode-orxa@1.0.43"
  ]
}\n`;

    const removed = updateOrxaPluginInConfigDocument(input, "standard");
    expect(removed.changed).toBe(true);
    expect(removed.output).toContain('"example/plugin@1.2.3"');
    expect(removed.output).not.toContain("opencode-orxa");

    const secondPass = updateOrxaPluginInConfigDocument(removed.output, "standard");
    expect(secondPass.changed).toBe(false);
  });
});

describe("hasRecentMatchingUserPrompt", () => {
  it("detects a matching recent user prompt", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "assistant-1",
          role: "assistant",
          sessionID: "s-1",
          time: { created: now - 1_000, updated: now - 1_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [] as SessionMessageBundle["parts"],
      },
      {
        info: ({
          id: "user-1",
          role: "user",
          sessionID: "s-1",
          time: { created: now + 400, updated: now + 400 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-1",
            type: "text",
            sessionID: "s-1",
            messageID: "user-1",
            text: "build me a website",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    expect(hasRecentMatchingUserPrompt(messages, "build me a website", now)).toBe(true);
  });

  it("ignores stale or non-matching user prompts", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "user-stale",
          role: "user",
          sessionID: "s-1",
          time: { created: now - 15_000, updated: now - 15_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-stale",
            type: "text",
            sessionID: "s-1",
            messageID: "user-stale",
            text: "build me a website",
          },
        ] as SessionMessageBundle["parts"],
      },
      {
        info: ({
          id: "user-new",
          role: "user",
          sessionID: "s-1",
          time: { created: now + 500, updated: now + 500 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-new",
            type: "text",
            sessionID: "s-1",
            messageID: "user-new",
            text: "different message",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    expect(hasRecentMatchingUserPrompt(messages, "build me a website", now)).toBe(false);
  });
});

describe("OpencodeService memory prompt integration", () => {
  function createSendPromptHarness() {
    const service = Object.create(OpencodeService.prototype) as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string }) => Promise<boolean>;
      promptFence: Map<string, number>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: (directory: string, text: string) => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
    };
    service.promptFence = new Map<string, number>();
    return service;
  }

  it("injects memory context into prompt system field", async () => {
    const service = createSendPromptHarness();
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    const buildContextMock = vi.fn(async () => "Workspace memory guidance:\nUse pnpm.");
    const scheduleMock = vi.fn(async () => undefined);
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: buildContextMock,
    };
    service.scheduleSessionMemoryIngest = scheduleMock;

    await service.sendPrompt({
      directory: "/repo-memory",
      sessionID: "session-1",
      text: "Run tests",
    });

    const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined;
    expect(buildContextMock).toHaveBeenCalledWith("/repo-memory", "Run tests");
    expect(payload?.system).toContain("Workspace memory guidance");
  });

  it("omits system field when no memory context exists", async () => {
    const service = createSendPromptHarness() as unknown as {
      sendPrompt: (input: { directory: string; sessionID: string; text: string }) => Promise<boolean>;
      client: () => { session: { prompt: (payload: unknown) => Promise<void> } };
      memoryStore: { buildPromptContext: () => Promise<string> };
      scheduleSessionMemoryIngest: (directory: string, sessionID: string, reason: string) => Promise<void>;
    };
    const promptMock = vi.fn(async (payload: unknown) => {
      void payload;
      return undefined;
    });
    service.client = () => ({ session: { prompt: promptMock } });
    service.memoryStore = {
      buildPromptContext: async () => "",
    };
    service.scheduleSessionMemoryIngest = async () => undefined;

    await service.sendPrompt({
      directory: "/repo-standard",
      sessionID: "session-2",
      text: "No memory",
    });

    const payload = promptMock.mock.calls[0]?.[0] as { system?: string } | undefined;
    expect(payload?.system).toBeUndefined();
  });
});
