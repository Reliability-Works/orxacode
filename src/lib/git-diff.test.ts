import { describe, expect, it } from "vitest";
import {
  inferStatusTag,
  lineNumber,
  parseDiffHunks,
  parseGitDiffOutput,
  toDiffSections,
  type GitDiffFile,
} from "./git-diff";

describe("git-diff", () => {
  it("maps status tags", () => {
    expect(inferStatusTag("added")).toBe("A");
    expect(inferStatusTag("deleted")).toBe("D");
    expect(inferStatusTag("renamed")).toBe("R");
    expect(inferStatusTag("modified")).toBe("M");
  });

  it("parses empty and sentinel output messages", () => {
    expect(parseGitDiffOutput("")).toEqual({ files: [], message: "No local changes." });
    expect(parseGitDiffOutput("Loading diff...")).toEqual({ files: [], message: "Loading diff..." });
    expect(parseGitDiffOutput("Not a git repository.")).toEqual({ files: [], message: "Not a git repository." });
  });

  it("merges staged and unstaged chunks for the same file", () => {
    const output = [
      "## Unstaged",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-const a = 1;",
      "+const a = 2;",
      "## Staged",
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -2 +2 @@",
      "-const b = 1;",
      "+const b = 2;",
    ].join("\n");

    const parsed = parseGitDiffOutput(output);
    expect(parsed.message).toBeUndefined();
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]).toMatchObject({
      path: "src/a.ts",
      hasUnstaged: true,
      hasStaged: true,
      added: 2,
      removed: 2,
    });
  });

  it("builds sections and parses hunk line numbers", () => {
    const file: GitDiffFile = {
      key: "src/a.ts",
      path: "src/a.ts",
      status: "modified",
      added: 1,
      removed: 1,
      hasUnstaged: true,
      hasStaged: false,
      diffLines: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -10,2 +10,2 @@",
        " const keep = true;",
        "-const before = 1;",
        "+const after = 2;",
      ],
      unstagedDiffLines: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -10,2 +10,2 @@",
        " const keep = true;",
        "-const before = 1;",
        "+const after = 2;",
      ],
    };

    const sections = toDiffSections(file);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.label).toBe("Unstaged");

    const hunks = parseDiffHunks(sections[0]!);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines).toEqual([
      { id: expect.any(String), type: "context", text: "const keep = true;", oldLine: 10, newLine: 10 },
      { id: expect.any(String), type: "remove", text: "const before = 1;", oldLine: 11, newLine: null },
      { id: expect.any(String), type: "add", text: "const after = 2;", oldLine: null, newLine: 11 },
    ]);
  });

  it("formats line numbers for rendering", () => {
    expect(lineNumber(42)).toBe("42");
    expect(lineNumber(null)).toBe("");
  });
});
