import { describe, expect, it } from "vitest";
import {
  confidenceFor,
  detectTags,
  normalizePolicyMode,
  normalizeWhitespace,
  normalizeWorkspace,
  parseStructuredBackfillLine,
  parseTags,
  previewSummary,
  scorePromptCandidate,
  serializeTags,
  shouldCapture,
  splitIntoCandidateLines,
  stableHash,
  toDedupeKey,
  tokenize,
} from "./memory-heuristics";

describe("memory-heuristics", () => {
  it("normalizes whitespace, workspace paths, and policy mode", () => {
    expect(normalizeWhitespace("  hello   world  ")).toBe("hello world");
    expect(normalizeWorkspace("C:\\repo\\app")).toBe("C:/repo/app");
    expect(normalizePolicyMode("aggressive")).toBe("aggressive");
    expect(normalizePolicyMode("unknown")).toBe("balanced");
  });

  it("serializes and parses tags with dedupe and normalization", () => {
    const json = serializeTags([" Codebase ", "codebase", "Decision", ""]);
    expect(parseTags(json)).toEqual(["codebase", "decision"]);
    expect(parseTags("not-json")).toEqual([]);
  });

  it("tokenizes and hashes consistently", () => {
    expect(tokenize("Please help me run pnpm lint in src/app with tests")).toEqual(["run", "pnpm", "lint", "src/app", "tests"]);
    expect(stableHash("abc")).toBe(stableHash("abc"));
    expect(toDedupeKey("  Hello   WORLD ")).toBe(toDedupeKey("hello world"));
  });

  it("parses structured backfill lines", () => {
    const parsed = parseStructuredBackfillLine(
      '[ORXA_MEMORY] workspace="/repo-a" type="decision" tags="memory,refactor" content="Keep IPC handlers split by domain."',
    );
    expect(parsed).toEqual({
      workspace: "/repo-a",
      type: "decision",
      tags: ["decision", "memory", "refactor"],
      content: "Keep IPC handlers split by domain.",
    });
    expect(parseStructuredBackfillLine("plain text")).toBeUndefined();
  });

  it("detects tags and capture policy correctly", () => {
    const text = "Decision: keep src/app and electron/main split. Must avoid regressions.";
    expect(detectTags(text, "assistant")).toEqual(expect.arrayContaining(["assistant", "decision", "constraint"]));

    expect(shouldCapture("aggressive", "small but long enough memory candidate text goes here", "user")).toBe(true);
    expect(shouldCapture("conservative", "Need to update build workflow and must keep this.", "user")).toBe(true);
    expect(shouldCapture("balanced", "short", "user")).toBe(false);
  });

  it("scores confidence and prompt matches", () => {
    expect(confidenceFor("balanced", ["preference", "codebase"])).toBeGreaterThan(0.6);
    const score = scorePromptCandidate(
      ["pnpm", "lint"],
      "Run pnpm lint before merge",
      ["codebase", "workflow"],
      "Use pnpm lint and test for validation.",
      0.5,
    );
    expect(score.matchedCount).toBeGreaterThan(0);
    expect(score.score).toBeGreaterThan(0.5);
  });

  it("splits candidate lines and previews summaries", () => {
    const chunks = splitIntoCandidateLines("Line one. Line two!\n\nLine three?");
    expect(chunks).toEqual(["Line one.", "Line two!", "Line three?"]);
    expect(previewSummary("a".repeat(150), 20)).toBe("aaaaaaaaaaaaaaaaa...");
  });
});
