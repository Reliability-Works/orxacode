/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProvenanceIndex } from "./provenance-index";
import type { ChangeProvenanceRecord } from "../../shared/ipc";

let tempUserDataDir = "";

vi.mock("electron", () => ({
  app: {
    getPath: () => tempUserDataDir,
  },
}));

describe("ProvenanceIndex", () => {
  beforeEach(() => {
    tempUserDataDir = `/tmp/orxa-provenance-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  });

  it("deduplicates records by eventID and resolves per-file history", async () => {
    const index = new ProvenanceIndex();
    const records: ChangeProvenanceRecord[] = [
      {
        filePath: "src/app.ts",
        operation: "edit",
        actorType: "main",
        actorName: "Main agent",
        eventID: "evt-1",
        timestamp: 10,
      },
      {
        filePath: "src/app.ts",
        operation: "edit",
        actorType: "main",
        actorName: "Main agent",
        eventID: "evt-1",
        timestamp: 10,
      },
      {
        filePath: "src/app.ts",
        operation: "create",
        actorType: "subagent",
        actorName: "builder",
        eventID: "evt-2",
        timestamp: 12,
      },
    ];

    await index.appendMany("/repo", "session-1", records);
    const snapshot = await index.loadSnapshot("/repo", "session-1", 0);
    expect(snapshot.records).toHaveLength(2);

    const history = await index.getFileHistory("/repo", "session-1", "src/app.ts");
    expect(history.map((item) => item.eventID)).toEqual(["evt-2", "evt-1"]);
  });
});
