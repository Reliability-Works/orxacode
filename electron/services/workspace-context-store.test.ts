/** @vitest-environment node */

import { rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceContextStore } from "./workspace-context-store";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
  },
}));

function tempRoot() {
  return `/tmp/orxa-workspace-context-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe("WorkspaceContextStore", () => {
  it("skips weak generic overlap for unrelated long-form prompts", async () => {
    const rootDir = tempRoot();
    const store = new WorkspaceContextStore({
      rootDir,
      now: () => 1_710_000_000_000,
      createID: () => "trace-1",
    });

    try {
      await store.write({
        workspace: "/repo-alpha",
        filename: "recent-context.md",
        content: [
          "# Recent Context",
          "",
          "- Task: fixed Codex startup config parse error.",
          "- Documented UI cleanup findings from the last visual pass.",
        ].join("\n"),
      });

      const result = await store.buildPromptContext(
        "/repo-alpha",
        "session-1",
        "do a comprehensive research task for the top defi news in 2026 then document all of your findings",
      );

      expect(result.prompt).toBe("");
      expect(result.trace.selected).toHaveLength(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("selects context when there is strong lexical overlap", async () => {
    const rootDir = tempRoot();
    const store = new WorkspaceContextStore({
      rootDir,
      now: () => 1_710_000_000_000,
      createID: () => "trace-2",
    });

    try {
      await store.write({
        workspace: "/repo-alpha",
        filename: "defi-briefing.md",
        content: [
          "# DeFi Research",
          "",
          "Top DeFi news sources for 2026 and a documentation checklist for final findings.",
        ].join("\n"),
      });

      const result = await store.buildPromptContext(
        "/repo-alpha",
        "session-2",
        "do a comprehensive research task for the top defi news in 2026 then document all of your findings",
      );

      expect(result.trace.selected.length).toBeGreaterThan(0);
      expect(result.prompt.toLowerCase()).toContain("defi");
      expect(result.prompt.toLowerCase()).toContain("news");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
