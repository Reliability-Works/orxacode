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
// Write commands — commands that mutate state and should NOT be in explore groups
// Everything else is treated as exploration by default
// ---------------------------------------------------------------------------
const WRITE_COMMANDS = new Set([
  "mkdir", "mkdirp", "rmdir",
  "rm", "mv", "cp", "ln", "install",
  "touch", "chmod", "chown", "chgrp",
  "git", "npm", "npx", "yarn", "pnpm", "bun",
  "pip", "pip3", "cargo", "go", "make", "cmake",
  "docker", "kubectl", "terraform",
  "curl", "wget", "ssh", "scp", "rsync",
  "kill", "pkill", "killall",
  "systemctl", "service",
  "apt", "apt-get", "brew", "dnf", "yum", "pacman",
  "tee",
]);

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
 * Uses a deny-list approach: everything is exploration UNLESS
 * the binary is a known write/mutation command.
 */
export function isReadOnlyCommand(rawCommand: string): boolean {
  const cleaned = cleanCommandText(rawCommand);
  const binary = commandBinary(cleaned).toLowerCase();
  if (!binary) return true;
  // git subcommands: only git log/diff/status/show/blame are read-only
  if (binary === "git") {
    const subCmd = cleaned.split(/\s+/)[1]?.toLowerCase() ?? "";
    const readOnlyGit = new Set(["log", "diff", "status", "show", "blame", "branch", "tag", "remote", "ls-files", "ls-tree", "rev-parse", "describe"]);
    return readOnlyGit.has(subCmd);
  }
  // npm/npx: only list/info/view are read-only
  if (binary === "npm" || binary === "npx") {
    const subCmd = cleaned.split(/\s+/)[1]?.toLowerCase() ?? "";
    return subCmd === "list" || subCmd === "ls" || subCmd === "info" || subCmd === "view" || subCmd === "outdated";
  }
  return !WRITE_COMMANDS.has(binary);
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

  const total = entries.length;
  const parts: string[] = [];
  if (readCount > 0) parts.push(`${readCount} read${readCount !== 1 ? "s" : ""}`);
  if (searchCount > 0) parts.push(`${searchCount} search${searchCount !== 1 ? "es" : ""}`);

  // Use a combined label: "N files" for reads + commands, plus searches separately
  const fileCount = readCount + runCount + mcpCount;
  if (parts.length === 0) {
    // All entries are commands/tools/reads — just show total
    const summary = `${total} file${total !== 1 ? "s" : ""}`;
    return status === "exploring" ? `Exploring ${summary}` : `Explored ${summary}`;
  }

  // Mix of types: show "N reads, M searches"
  const mixedParts: string[] = [];
  if (fileCount > 0) mixedParts.push(`${fileCount} file${fileCount !== 1 ? "s" : ""}`);
  if (searchCount > 0) mixedParts.push(`${searchCount} search${searchCount !== 1 ? "es" : ""}`);
  const summary = mixedParts.join(", ");
  return status === "exploring" ? `Exploring ${summary}` : `Explored ${summary}`;
}
