import { describe, expect, it } from "vitest";
import { parseGitDiffStats } from "./useGitPanel";

describe("parseGitDiffStats", () => {
  it("counts additions/deletions from standard diff output", () => {
    const output = [
      "## Untracked",
      "",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+const a = 1;",
      "+const b = 2;",
    ].join("\n");

    expect(parseGitDiffStats(output)).toEqual({
      additions: 2,
      deletions: 0,
      filesChanged: 1,
      hasChanges: true,
    });
  });

  it("counts untracked files when backend returns porcelain markers", () => {
    const output = ["## Untracked", "", "?? foo.txt", "?? src/new.ts"].join("\n");
    expect(parseGitDiffStats(output)).toEqual({
      additions: 2,
      deletions: 0,
      filesChanged: 2,
      hasChanges: true,
    });
  });

  it("counts untracked files from inline fallback output", () => {
    const output = "## Untracked ?? foo.txt ?? src/new.ts ?? src/three.ts";
    expect(parseGitDiffStats(output)).toEqual({
      additions: 3,
      deletions: 0,
      filesChanged: 3,
      hasChanges: true,
    });
  });
});
