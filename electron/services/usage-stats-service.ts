import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderUsageStats {
  totalSessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  topModels: Array<{ model: string; count: number }>;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Cost estimation (approximate USD per million tokens)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "sonnet": { input: 3, output: 15 },
  "haiku": { input: 0.25, output: 1.25 },
  "opus": { input: 15, output: 75 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "codex-mini": { input: 1.5, output: 6 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const lower = model.toLowerCase();
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (lower.includes(key)) {
      return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    }
  }
  // Default: use sonnet pricing as a reasonable middle ground
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

// ---------------------------------------------------------------------------
// Claude Code usage reader
// ---------------------------------------------------------------------------

async function findJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findJsonlFiles(fullPath);
        results.push(...nested);
      } else if (entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return results;
}

interface ClaudeJsonlLine {
  type?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    model?: string;
  };
}

export async function readClaudeUsageStats(): Promise<ProviderUsageStats> {
  const homeDir = process.env.HOME ?? "";
  const claudeDir = path.join(homeDir, ".claude", "projects");

  const jsonlFiles = await findJsonlFiles(claudeDir);
  const totalSessions = jsonlFiles.length;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let totalCost = 0;
  const modelCounts = new Map<string, number>();

  for (const filePath of jsonlFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as ClaudeJsonlLine;
          if (parsed.type === "assistant" && parsed.message?.usage) {
            const usage = parsed.message.usage;
            const lineInput = usage.input_tokens ?? 0;
            const lineOutput = usage.output_tokens ?? 0;
            const lineCacheRead = usage.cache_read_input_tokens ?? 0;

            inputTokens += lineInput;
            outputTokens += lineOutput;
            cacheReadTokens += lineCacheRead;

            if (parsed.message.model) {
              const model = parsed.message.model;
              modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
              totalCost += estimateCost(model, lineInput, lineOutput);
            }
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  const topModels = [...modelCounts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    totalSessions,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    totalCost,
    topModels,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Codex usage tracker
// ---------------------------------------------------------------------------

interface CodexUsageCache {
  inputTokens: number;
  outputTokens: number;
  threadCount: number;
  modelCounts: Record<string, number>;
  updatedAt: number;
}

const CODEX_CACHE_PATH = path.join(process.env.HOME ?? "", ".codex", "orxa_usage_cache.json");

let codexUsageCache: CodexUsageCache = {
  inputTokens: 0,
  outputTokens: 0,
  threadCount: 0,
  modelCounts: {},
  updatedAt: 0,
};

let cacheLoaded = false;

async function loadCodexCache(): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const content = await readFile(CODEX_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(content) as CodexUsageCache;
    if (parsed && typeof parsed.inputTokens === "number") {
      codexUsageCache = parsed;
    }
  } catch {
    // No cache file yet — start fresh
  }
}

async function persistCodexCache(): Promise<void> {
  try {
    const dir = path.dirname(CODEX_CACHE_PATH);
    await mkdir(dir, { recursive: true });
    await writeFile(CODEX_CACHE_PATH, JSON.stringify(codexUsageCache, null, 2), "utf-8");
  } catch {
    // Non-fatal — cache write failure is acceptable
  }
}

export function trackCodexTokenUsage(params: Record<string, unknown>): void {
  const input = typeof params.input === "number" ? params.input : 0;
  const output = typeof params.output === "number" ? params.output : 0;
  const model = typeof params.model === "string" ? params.model : undefined;

  codexUsageCache.inputTokens += input;
  codexUsageCache.outputTokens += output;
  codexUsageCache.updatedAt = Date.now();

  if (model) {
    codexUsageCache.modelCounts[model] = (codexUsageCache.modelCounts[model] ?? 0) + 1;
  }

  // Persist asynchronously — fire and forget
  void persistCodexCache();
}

export function trackCodexThread(): void {
  codexUsageCache.threadCount += 1;
  codexUsageCache.updatedAt = Date.now();
  void persistCodexCache();
}

export async function readCodexUsageStats(): Promise<ProviderUsageStats> {
  await loadCodexCache();

  const modelCounts = codexUsageCache.modelCounts;
  const topModels = Object.entries(modelCounts)
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  let totalCost = 0;
  for (const [model, count] of Object.entries(modelCounts)) {
    // Approximate: distribute tokens proportionally by model call count
    const totalCalls = Object.values(modelCounts).reduce((sum, c) => sum + c, 0);
    if (totalCalls > 0) {
      const fraction = count / totalCalls;
      totalCost += estimateCost(
        model,
        codexUsageCache.inputTokens * fraction,
        codexUsageCache.outputTokens * fraction,
      );
    }
  }

  // If no model data, use default pricing
  if (Object.keys(modelCounts).length === 0 && (codexUsageCache.inputTokens > 0 || codexUsageCache.outputTokens > 0)) {
    totalCost = estimateCost("gpt-4o", codexUsageCache.inputTokens, codexUsageCache.outputTokens);
  }

  return {
    totalSessions: codexUsageCache.threadCount,
    inputTokens: codexUsageCache.inputTokens,
    outputTokens: codexUsageCache.outputTokens,
    cacheReadTokens: 0, // Codex doesn't report cache tokens
    totalCost,
    topModels,
    updatedAt: codexUsageCache.updatedAt || Date.now(),
  };
}

export async function initCodexUsageTracking(): Promise<void> {
  await loadCodexCache();
}
