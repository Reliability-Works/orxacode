import { describe, expect, it } from "vitest";
import { buildExploreLabel, commandToExploreEntry } from "./explore-utils";

describe("explore-utils", () => {
  it("classifies rg commands as search entries", () => {
    const entry = commandToExploreEntry("1", "/bin/zsh -lc \"rg setOpencodeRuntimeSnapshot src\"");
    expect(entry).toMatchObject({
      kind: "search",
      label: "Searched for setOpencodeRuntimeSnapshot",
    });
  });

  it("classifies cat commands as read entries", () => {
    const entry = commandToExploreEntry("1", "/bin/zsh -lc \"cat src/hooks/useWorkspaceState.ts\"");
    expect(entry).toMatchObject({
      kind: "read",
      label: "Read useWorkspaceState.ts",
      detail: "src/hooks/useWorkspaceState.ts",
    });
  });

  it("classifies workspace scans as search entries", () => {
    const entry = commandToExploreEntry("1", "/bin/zsh -lc \"ls src/components\"");
    expect(entry).toMatchObject({
      kind: "search",
      label: "Scanned workspace",
      detail: "ls src/components",
    });
  });

  it("builds explore labels that combine files and searches", () => {
    expect(buildExploreLabel([
      { id: "1", kind: "read", label: "Read a.ts", status: "completed" },
      { id: "2", kind: "search", label: "Searched for foo", status: "completed" },
      { id: "3", kind: "search", label: "Searched for bar", status: "completed" },
    ], "explored")).toBe("Explored 1 file, 2 searches");
  });
});
