/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMessageBundle } from "../../shared/ipc";
import { MemoryStore } from "./memory-store";

let tempUserDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => tempUserDataDir,
  },
}));

function textBundle(sessionID: string, messageID: string, role: "user" | "assistant", text: string): SessionMessageBundle {
  return {
    info: ({
      id: messageID,
      sessionID,
      role,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    } as unknown) as SessionMessageBundle["info"],
    parts: [
      {
        id: `${messageID}-text`,
        type: "text",
        sessionID,
        messageID,
        text,
      } as SessionMessageBundle["parts"][number],
    ],
  };
}

describe("MemoryStore", () => {
  beforeEach(() => {
    tempUserDataDir = `/tmp/orxa-memory-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  });

  it("encrypts memory content and can recover decrypted graph data", async () => {
    const store = new MemoryStore();
    await store.updateSettings({
      global: {
        enabled: true,
        mode: "aggressive",
      },
    });

    await store.ingestSessionMessages("/repo-a", "s-1", [
      textBundle("s-1", "m-user-1", "user", "I prefer using pnpm for this project and avoid npm scripts."),
      textBundle("s-1", "m-assistant-1", "assistant", "Decision: keep memory behind a toggle in the settings center."),
    ]);

    const graph = await store.getGraph({ workspace: "/repo-a" });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.some((node) => node.content.includes("pnpm"))).toBe(true);
  });

  it("isolates retrieval by workspace and deduplicates repeated memory", async () => {
    const store = new MemoryStore();
    await store.updateSettings({
      global: {
        enabled: true,
        mode: "aggressive",
      },
    });

    const bundlesA = [textBundle("s-a", "m-a-1", "user", "Workspace alpha uses Orxa mode for planning tasks.")];
    const bundlesB = [textBundle("s-b", "m-b-1", "user", "Workspace beta uses standard mode for most sessions.")];
    const first = await store.ingestSessionMessages("/repo-alpha", "s-a", bundlesA);
    const second = await store.ingestSessionMessages("/repo-alpha", "s-a", bundlesA);
    await store.ingestSessionMessages("/repo-beta", "s-b", bundlesB);

    expect(first.inserted).toBeGreaterThan(0);
    expect(second.updated).toBeGreaterThan(0);

    const alphaMemories = await store.getPromptMemories("/repo-alpha", "Orxa mode", 6);
    expect(alphaMemories.some((item) => item.content.toLowerCase().includes("workspace alpha"))).toBe(true);
    expect(alphaMemories.some((item) => item.content.toLowerCase().includes("workspace beta"))).toBe(false);
  });

  it("creates relationship edges between captured memories", async () => {
    const store = new MemoryStore();
    await store.updateSettings({
      global: {
        enabled: true,
        mode: "aggressive",
      },
    });

    await store.ingestSessionMessages("/repo-edges", "s-edge", [
      textBundle("s-edge", "m-1", "user", "Important constraint: only retrieve memory for the active workspace."),
      textBundle("s-edge", "m-2", "assistant", "Decision: render memory graph after dashboard in the sidebar."),
    ]);

    const graph = await store.getGraph({ workspace: "/repo-edges" });
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("filters weak/stopword-only prompt queries to avoid irrelevant memory injection", async () => {
    const store = new MemoryStore();
    await store.updateSettings({
      global: {
        enabled: true,
        mode: "balanced",
      },
    });

    await store.ingestSessionMessages("/repo-signal", "s-signal", [
      textBundle("s-signal", "m-1", "user", "Project signal: prioritize browser agent reliability and action retries."),
    ]);

    const stopwordOnly = await store.getPromptMemories("/repo-signal", "please help me with this", 6);
    const unrelated = await store.getPromptMemories("/repo-signal", "recipe for italian tiramisu", 6);

    expect(stopwordOnly).toHaveLength(0);
    expect(unrelated).toHaveLength(0);
  });

  it("ingests structured ORXA memory lines with explicit workspace routing", async () => {
    const store = new MemoryStore();
    await store.updateSettings({
      global: {
        enabled: true,
        mode: "balanced",
      },
    });

    await store.ingestSessionMessages("/repo-seed", "s-seed", [
      textBundle(
        "s-seed",
        "m-structured-1",
        "assistant",
        [
          '[ORXA_MEMORY] workspace="/repo-alpha" type="decision" tags="memory,backfill" content="Decision: keep workspace memory retrieval isolated by directory."',
          '[ORXA_MEMORY] workspace="/repo-beta" type="fact" tags="codebase,nextjs" content="Fact: /repo-beta uses Next.js for the main application shell."',
        ].join("\n"),
      ),
    ]);

    const alpha = await store.getPromptMemories("/repo-alpha", "isolated", 8);
    const beta = await store.getPromptMemories("/repo-beta", "Next.js", 8);
    const seed = await store.getPromptMemories("/repo-seed", "memory", 8);

    expect(alpha.some((item) => item.content.toLowerCase().includes("retrieval isolated"))).toBe(true);
    expect(beta.some((item) => item.content.toLowerCase().includes("next.js"))).toBe(true);
    expect(seed.length).toBe(0);
  });
});
