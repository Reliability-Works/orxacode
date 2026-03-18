import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSessionMetadataKey,
  migrateLegacySessionMetadata,
  readWorkspaceSessionMetadata,
} from "./workspace-session-metadata";

describe("workspace session metadata helpers", () => {
  it("builds a workspace-scoped session key", () => {
    expect(buildWorkspaceSessionMetadataKey("/repo", "sess-1")).toBe("/repo::sess-1");
  });

  it("reads workspace-scoped metadata entries", () => {
    const map = {
      "/repo-a::sess-1": "Canvas",
      "/repo-b::sess-1": "Codex Session",
    };

    expect(readWorkspaceSessionMetadata(map, "/repo-a", "sess-1")).toBe("Canvas");
    expect(readWorkspaceSessionMetadata(map, "/repo-b", "sess-1")).toBe("Codex Session");
    expect(readWorkspaceSessionMetadata(map, "/repo-c", "sess-1")).toBeUndefined();
  });

  it("migrates legacy sessionID-only entries into workspace-scoped keys", () => {
    const migrated = migrateLegacySessionMetadata(
      { "sess-1": "canvas", "sess-2": "codex" },
      {},
      [
        { directory: "/repo-a", sessionID: "sess-1" },
        { directory: "/repo-b", sessionID: "sess-2" },
      ],
    );

    expect(migrated).toEqual({
      "/repo-a::sess-1": "canvas",
      "/repo-b::sess-2": "codex",
    });
  });

  it("preserves existing workspace-scoped entries during migration", () => {
    const current = {
      "/repo-a::sess-1": "renamed canvas",
    };

    const migrated = migrateLegacySessionMetadata(
      { "sess-1": "canvas" },
      current,
      [{ directory: "/repo-a", sessionID: "sess-1" }],
    );

    expect(migrated).toBe(current);
  });
});
