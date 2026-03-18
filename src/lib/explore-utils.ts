/**
 * Utilities for grouping context/command items into "Exploring" summaries.
 * Mirrors the summarizeExploration / cleanCommandText logic from the reference
 * Codex Mac App and OpenCode desktop implementations.
 */

/** Entry types in an explore group */
export type ExploreEntryKind = "read" | "search" | "list" | "run" | "mcp";

export interface ExploreEntry {
  id: string;
  kind: ExploreEntryKind;
  label: string;
  detail?: string;
  status: "running" | "completed" | "error";
}

// ---------------------------------------------------------------------------
// Read-only command patterns (commands that only observe; never mutate state)
// ---------------------------------------------------------------------------
const READ_ONLY_COMMANDS = [
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "bat",
  "grep",
  "rg",
  "ag",
  "ack",
  "ls",
  "ll",
  "la",
  "l",
  "dir",
  "find",
  "fd",
  "locate",
  "tree",
  "echo",
  "printf",
  "wc",
  "file",
  "stat",
  "du",
  "df",
  "pwd",
  "which",
  "type",
  "readlink",
  "realpath",
  "basename",
  "dirname",
  "sort",
  "uniq",
  "diff",
  "diff3",
  "cmp",
  "comm",
  "cut",
  "awk",
  "sed",
  "tr",
  "xargs",
  "jq",
  "yq",
  "python3",
  "python",
  "node",
  "ruby",
  "perl",
  "env",
  "printenv",
];

/**
 * Strip the outer shell wrapper that Codex wraps commands in.
 * e.g. `/bin/zsh -lc "cat README.md"` -> `cat README.md`
 */
export function unwrapShellCommand(raw: string): string {
  // Match /bin/zsh -lc "..." or /bin/bash -c "..."
  const shellMatch = raw.match(/^\S*(?:zsh|bash|sh)\s+\S+\s+"([\s\S]+)"$/);
  if (shellMatch?.[1]) return shellMatch[1].trim();
  // Also handle single-quote variants
  const singleQuote = raw.match(/^\S*(?:zsh|bash|sh)\s+\S+\s+'([\s\S]+)'$/);
  if (singleQuote?.[1]) return singleQuote[1].trim();
  return raw.trim();
}

/**
 * Strip a leading `cd /some/path && ` prefix from a command.
 */
export function stripCdPrefix(cmd: string): string {
  return cmd.replace(/^cd\s+\S+\s*&&\s*/, "").trim();
}

/**
 * Clean a raw command string into a short displayable label.
 */
export function cleanCommandText(raw: string): string {
  const unwrapped = unwrapShellCommand(raw);
  return stripCdPrefix(unwrapped);
}

/**
 * Extract just the binary name from the start of a command string.
 */
function commandBinary(cmd: string): string {
  return cmd.trim().split(/\s+/)[0] ?? "";
}

/**
 * Return true if the command is a read-only exploration command.
 */
export function isReadOnlyCommand(rawCommand: string): boolean {
  const cleaned = cleanCommandText(rawCommand);
  const binary = commandBinary(cleaned);
  return READ_ONLY_COMMANDS.includes(binary.toLowerCase());
}

/**
 * Derive an ExploreEntry for a commandExecution item.
 * Returns null if the command is not a read-only command.
 */
export function commandToExploreEntry(
  id: string,
  rawCommand: string,
  status: "running" | "completed" | "error" = "running",
): ExploreEntry | null {
  if (!isReadOnlyCommand(rawCommand)) return null;
  const cleaned = cleanCommandText(rawCommand);
  const label = cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
  return { id, kind: "run", label, status };
}

/**
 * Derive an ExploreEntry for a fileRead item.
 */
export function fileReadToExploreEntry(
  id: string,
  filePath: string,
  status: "running" | "completed" | "error" = "running",
): ExploreEntry {
  const basename = filePath.split(/[\\/]/).pop() ?? filePath;
  return {
    id,
    kind: "read",
    label: `Read ${basename}`,
    detail: filePath !== basename ? filePath : undefined,
    status,
  };
}

/**
 * Derive an ExploreEntry for a webSearch item.
 */
export function webSearchToExploreEntry(
  id: string,
  query: string,
  status: "running" | "completed" | "error" = "running",
): ExploreEntry {
  const label = `Searched for ${query.length > 60 ? `${query.slice(0, 57)}...` : query}`;
  return { id, kind: "search", label, status };
}

/**
 * Derive an ExploreEntry for an mcpToolCall item.
 */
export function mcpToolCallToExploreEntry(
  id: string,
  toolName: string,
  status: "running" | "completed" | "error" = "running",
): ExploreEntry {
  return { id, kind: "mcp", label: toolName, status };
}

/**
 * Build a human-readable summary label for the explore group header.
 * e.g. "Exploring 3 files, 1 search" or "Explored 3 files"
 */
export function buildExploreLabel(
  entries: ExploreEntry[],
  status: "exploring" | "explored",
): string {
  const readCount = entries.filter((e) => e.kind === "read").length;
  const searchCount = entries.filter((e) => e.kind === "search").length;
  const runCount = entries.filter((e) => e.kind === "run").length;
  const mcpCount = entries.filter((e) => e.kind === "mcp").length;

  const parts: string[] = [];
  if (readCount > 0) parts.push(`${readCount} file${readCount !== 1 ? "s" : ""}`);
  if (searchCount > 0) parts.push(`${searchCount} search${searchCount !== 1 ? "es" : ""}`);
  if (runCount > 0) parts.push(`${runCount} command${runCount !== 1 ? "s" : ""}`);
  if (mcpCount > 0) parts.push(`${mcpCount} tool${mcpCount !== 1 ? "s" : ""}`);

  const summary = parts.length > 0 ? parts.join(", ") : `${entries.length} item${entries.length !== 1 ? "s" : ""}`;
  return status === "exploring" ? `Exploring ${summary}` : `Explored ${summary}`;
}
