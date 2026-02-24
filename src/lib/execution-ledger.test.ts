import { describe, expect, it } from "vitest";
import { groupLedgerByTurn, kindToTimelineVerb, normalizeLedgerPath, toTimelineLabel } from "./execution-ledger";
import type { ExecutionEventRecord } from "@shared/ipc";

describe("execution-ledger helpers", () => {
  it("maps event kinds to user-facing verbs", () => {
    expect(kindToTimelineVerb("read")).toBe("Read");
    expect(kindToTimelineVerb("search")).toBe("Searched");
    expect(kindToTimelineVerb("edit")).toBe("Edited");
    expect(kindToTimelineVerb("git")).toBe("Checked git");
  });

  it("normalizes workspace-relative paths", () => {
    expect(normalizeLedgerPath("/repo/src/app.ts", "/repo")).toBe("src/app.ts");
    expect(normalizeLedgerPath("/repo", "/repo")).toBe(".");
  });

  it("groups records deterministically by turn id", () => {
    const records: ExecutionEventRecord[] = [
      {
        id: "b",
        directory: "/repo",
        sessionID: "s1",
        timestamp: 2,
        kind: "edit",
        summary: "Edited src/a.ts",
        actor: { type: "main", name: "Main agent" },
        turnID: "turn-1",
      },
      {
        id: "a",
        directory: "/repo",
        sessionID: "s1",
        timestamp: 1,
        kind: "read",
        summary: "Read src/a.ts",
        actor: { type: "main", name: "Main agent" },
        turnID: "turn-1",
      },
    ];

    const grouped = groupLedgerByTurn(records);
    expect(grouped.get("turn-1")?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(toTimelineLabel(records[0]!)).toContain("Edited");
  });
});

