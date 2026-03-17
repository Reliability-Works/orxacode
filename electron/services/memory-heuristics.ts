import { createHash } from "node:crypto";
import type { MemoryPolicyMode } from "../../shared/ipc";

export const MEMORY_POLICY_MODES: ReadonlyArray<MemoryPolicyMode> = ["conservative", "balanced", "aggressive", "codebase-facts"];

const PROMPT_STOPWORDS = new Set([
  "all",
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "get",
  "help",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "this",
  "to",
  "up",
  "use",
  "want",
  "we",
  "with",
  "you",
  "your",
]);

export type StructuredBackfillLine = {
  workspace: string;
  content: string;
  tags: string[];
  type: string;
};

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeWorkspace(workspace: string) {
  return workspace.replace(/\\/g, "/");
}

export function normalizePolicyMode(mode: string): MemoryPolicyMode {
  return MEMORY_POLICY_MODES.includes(mode as MemoryPolicyMode) ? (mode as MemoryPolicyMode) : "balanced";
}

export function scopeForWorkspace(workspace: string) {
  return `workspace:${normalizeWorkspace(workspace)}`;
}

export function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as string[];
    }
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0)
          .slice(0, 12),
      ),
    ];
  } catch {
    return [] as string[];
  }
}

export function serializeTags(tags: string[]) {
  return JSON.stringify(
    [
      ...new Set(
        tags
          .map((item) => item.trim().toLowerCase())
          .filter((item) => item.length > 0),
      ),
    ].slice(0, 12),
  );
}

export function tokenize(text: string) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/)
    .filter((token) => token.length >= 3 && !PROMPT_STOPWORDS.has(token))
    .slice(0, 30);
}

export function tokenizeToSet(text: string) {
  return new Set(tokenize(text));
}

export function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function toDedupeKey(value: string) {
  return stableHash(normalizeWhitespace(value).toLowerCase());
}

export function previewSummary(content: string, maxLength = 128) {
  const normalized = normalizeWhitespace(content);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function splitIntoCandidateLines(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [] as string[];
  }
  const chunks: string[] = [];
  for (const line of lines) {
    for (const sentence of line.split(/(?<=[.!?])\s+/g)) {
      const normalized = normalizeWhitespace(sentence);
      if (normalized.length > 0) {
        chunks.push(normalized);
      }
    }
  }
  return chunks;
}

function parseInlineList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  ];
}

export function parseStructuredBackfillLine(line: string): StructuredBackfillLine | undefined {
  if (!line.toLowerCase().startsWith("[orxa_memory]")) {
    return undefined;
  }
  const readField = (key: string) => {
    const match = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
    return match?.[1]?.trim();
  };
  const workspace = readField("workspace");
  const type = readField("type");
  const tagsRaw = readField("tags") ?? "";
  const content = readField("content");
  if (!workspace || !content) {
    return undefined;
  }
  const baseType = normalizeWhitespace(type ?? "fact").toLowerCase();
  const tags = parseInlineList(tagsRaw);
  if (baseType.length > 0) {
    tags.unshift(baseType);
  }
  return {
    workspace: normalizeWorkspace(workspace),
    content: normalizeWhitespace(content),
    tags: [...new Set(tags)].slice(0, 12),
    type: baseType,
  };
}

export function detectTags(content: string, actor: string) {
  const value = content.toLowerCase();
  const tags: string[] = [];
  if (actor === "user") {
    tags.push("user");
  }
  if (actor === "assistant") {
    tags.push("assistant");
  }
  if (/(prefer|like|usually|always|never|don't|do not)/i.test(value)) {
    tags.push("preference");
  }
  if (/(must|should|required|constraint|limit|blocked)/i.test(value)) {
    tags.push("constraint");
  }
  if (/(decision|decide|chose|chosen|agreed)/i.test(value)) {
    tags.push("decision");
  }
  if (/(todo|follow[- ]?up|next step|action item)/i.test(value)) {
    tags.push("follow-up");
  }
  if (/(^|[\s`])(src\/|app\/|electron\/|shared\/|package\.json|pnpm|npm|git|tsconfig|eslint)([\s`]|$)/i.test(value)) {
    tags.push("codebase");
  }
  return [...new Set(tags)];
}

export function shouldCapture(mode: MemoryPolicyMode, content: string, actor: string) {
  const value = content.toLowerCase();
  if (content.length < 24 || content.length > 360) {
    return false;
  }
  if (mode === "aggressive") {
    return true;
  }
  if (mode === "codebase-facts") {
    return /(src\/|app\/|electron\/|shared\/|package\.json|pnpm|npm|eslint|tsconfig|git|command|build|lint|test|workspace|session)/i.test(value);
  }
  const strongSignal = /(prefer|always|never|don't|do not|must|should|required|decision|constraint|remember|important)/i.test(value);
  if (mode === "conservative") {
    return strongSignal;
  }
  if (strongSignal) {
    return true;
  }
  if (actor === "user" && /(need|want|goal|plan|scope|workflow)/i.test(value)) {
    return true;
  }
  if (actor === "assistant" && /(implemented|updated|added|fixed|will|next)/i.test(value)) {
    return true;
  }
  return false;
}

export function confidenceFor(mode: MemoryPolicyMode, tags: string[]) {
  let score = mode === "conservative" ? 0.68 : mode === "balanced" ? 0.6 : mode === "codebase-facts" ? 0.72 : 0.52;
  if (tags.includes("constraint") || tags.includes("decision")) {
    score += 0.12;
  }
  if (tags.includes("preference")) {
    score += 0.08;
  }
  if (tags.includes("codebase")) {
    score += 0.06;
  }
  return Math.max(0.3, Math.min(0.95, Number(score.toFixed(2))));
}

export function scorePromptCandidate(tokens: string[], summary: string, tags: string[], content: string, confidence: number) {
  const summaryTokens = tokenizeToSet(summary);
  const tagTokens = tokenizeToSet(tags.join(" "));
  const contentTokens = tokenizeToSet(content);
  const matchedTokens = new Set<string>();
  let score = confidence;
  for (const token of tokens) {
    if (summaryTokens.has(token)) {
      matchedTokens.add(token);
      score += 0.9;
    }
    if (tagTokens.has(token)) {
      matchedTokens.add(token);
      score += 0.7;
    }
    if (contentTokens.has(token)) {
      matchedTokens.add(token);
      score += 0.5;
    }
  }
  return {
    score,
    matchedCount: matchedTokens.size,
    ratio: tokens.length === 0 ? 0 : matchedTokens.size / tokens.length,
    scoreBoost: score - confidence,
  };
}
