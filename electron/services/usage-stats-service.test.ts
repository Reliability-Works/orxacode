import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCodexUsageStats } from "./usage-stats-service";

function formatDayKey(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function writeCodexSession(root: string, date: Date, name: string, lines: string[]) {
  const dayKey = formatDayKey(date);
  const [year, month, day] = dayKey.split("-");
  const dir = path.join(root, ".codex", "sessions", year!, month!, day!);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

describe("usage-stats-service", () => {
  let tempHome: string | null = null;

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
  });

  it("reads Codex usage from session logs instead of the legacy cache", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "orxa-codex-usage-"));
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("CODEX_HOME", "");

    const now = new Date();
    const within7d = new Date(now);
    within7d.setDate(now.getDate() - 2);
    const within30d = new Date(now);
    within30d.setDate(now.getDate() - 10);
    const older = new Date(now);
    older.setDate(now.getDate() - 45);

    await writeCodexSession(tempHome, within7d, "session-a", [
      JSON.stringify({
        timestamp: within7d.toISOString(),
        type: "session_meta",
        payload: { cwd: "/repo/a" },
      }),
      JSON.stringify({
        timestamp: within7d.toISOString(),
        type: "turn_context",
        payload: { cwd: "/repo/a", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: within7d.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10 },
          },
        },
      }),
      JSON.stringify({
        timestamp: within7d.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 2 },
          },
        },
      }),
      JSON.stringify({
        timestamp: within7d.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 110, cached_input_tokens: 45, output_tokens: 12 },
          },
        },
      }),
    ]);

    await writeCodexSession(tempHome, within30d, "session-b", [
      JSON.stringify({
        timestamp: within30d.toISOString(),
        type: "session_meta",
        payload: { cwd: "/repo/b" },
      }),
      JSON.stringify({
        timestamp: within30d.toISOString(),
        type: "turn_context",
        payload: { cwd: "/repo/b", model: "o3-mini" },
      }),
      JSON.stringify({
        timestamp: within30d.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 20 },
          },
        },
      }),
    ]);

    await writeCodexSession(tempHome, older, "session-old", [
      JSON.stringify({
        timestamp: older.toISOString(),
        type: "session_meta",
        payload: { cwd: "/repo/old" },
      }),
      JSON.stringify({
        timestamp: older.toISOString(),
        type: "turn_context",
        payload: { cwd: "/repo/old", model: "gpt-4o" },
      }),
      JSON.stringify({
        timestamp: older.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 500, cached_input_tokens: 50, output_tokens: 100 },
          },
        },
      }),
    ]);

    const stats = await readCodexUsageStats();

    expect(stats.totalThreads).toBe(3);
    expect(stats.sessions7d).toBe(1);
    expect(stats.sessions30d).toBe(2);
    expect(stats.totalSessions).toBe(2);
    expect(stats.modelCount).toBe(2);
    expect(stats.inputTokens).toBe(160);
    expect(stats.cacheReadTokens).toBe(45);
    expect(stats.outputTokens).toBe(32);
    expect(stats.topModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "gpt-5.4", count: 1 }),
        expect.objectContaining({ model: "o3-mini", count: 1 }),
      ]),
    );
    expect(stats.updatedAt).toBeGreaterThan(0);
    expect(stats.totalCost).toBeCloseTo(0.00049675, 8);
  });

  it("applies cached-input pricing so heavy cache usage does not inflate cost estimates", async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "orxa-codex-usage-"));
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("CODEX_HOME", "");

    const now = new Date();

    await writeCodexSession(tempHome, now, "session-huge", [
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "session_meta",
        payload: { cwd: "/repo/huge" },
      }),
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "turn_context",
        payload: { cwd: "/repo/huge", model: "gpt-5.4" },
      }),
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 5_800_000_000,
              cached_input_tokens: 5_600_000_000,
              output_tokens: 17_600_000,
            },
          },
        },
      }),
    ]);

    const stats = await readCodexUsageStats();

    expect(stats.totalThreads).toBe(1);
    expect(stats.sessions7d).toBe(1);
    expect(stats.sessions30d).toBe(1);
    expect(stats.inputTokens).toBe(5_800_000_000);
    expect(stats.cacheReadTokens).toBe(5_600_000_000);
    expect(stats.outputTokens).toBe(17_600_000);
    expect(stats.totalCost).toBeCloseTo(2_164, 0);
    expect(stats.totalCost).toBeLessThan(5_000);
  });
});
