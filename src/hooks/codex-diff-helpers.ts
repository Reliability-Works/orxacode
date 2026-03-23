import type { GitDiffFile, GitStatusFile } from "../lib/git-diff";

export type CommandDiffBaseline = {
  snapshot: Map<string, GitDiffSnapshotEntry>;
  statusSnapshot: Map<string, GitStatusFile>;
  dirtyContents: Map<string, string | null>;
};

export type FileChangeDescriptor = {
  path: string;
  type: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
};

export type GitSnapshotLookup = {
  diffByPath: Map<string, GitDiffSnapshotEntry>;
  statusByPath: Map<string, GitStatusFile>;
};

type GitDiffSnapshotEntry = {
  path: string;
  oldPath?: string;
  type: string;
  diff: string;
  insertions: number;
  deletions: number;
};

export function captureGitDiffSnapshot(files: GitDiffFile[]) {
  return new Map<string, GitDiffSnapshotEntry>(
    files.map((file) => [file.key, {
      path: file.path,
      oldPath: file.oldPath,
      type: file.status,
      insertions: file.added,
      deletions: file.removed,
      diff: file.diffLines.join("\n"),
    }]),
  );
}

export function captureGitStatusSnapshot(files: GitStatusFile[]) {
  return new Map(files.map((file) => [file.key, file]));
}

export function isSameGitDiffSnapshotEntry(left?: GitDiffSnapshotEntry, right?: GitDiffSnapshotEntry) {
  if (!left || !right) {
    return false;
  }
  return (
    left.path === right.path &&
    left.type === right.type &&
    left.insertions === right.insertions &&
    left.deletions === right.deletions &&
    left.diff === right.diff
  );
}

export function isSameGitStatusSnapshotEntry(left?: GitStatusFile, right?: GitStatusFile) {
  if (!left || !right) {
    return false;
  }
  return left.path === right.path && left.oldPath === right.oldPath && left.status === right.status;
}

function splitLinesPreserveFinalNewline(value: string | null) {
  if (value == null) {
    return [];
  }
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

export function buildSyntheticCommandDiff(path: string, beforeContent: string | null, afterContent: string | null) {
  const beforeLines = splitLinesPreserveFinalNewline(beforeContent);
  const afterLines = splitLinesPreserveFinalNewline(afterContent);

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const removedLines = beforeLines.slice(prefix, beforeSuffix + 1);
  const addedLines = afterLines.slice(prefix, afterSuffix + 1);
  const type =
    beforeContent == null ? "added" : afterContent == null ? "deleted" : "modified";

  if (removedLines.length === 0 && addedLines.length === 0) {
    return {
      type,
      diff: "",
      insertions: 0,
      deletions: 0,
    };
  }

  const oldStart = removedLines.length === 0 ? prefix : prefix + 1;
  const newStart = addedLines.length === 0 ? prefix : prefix + 1;
  const diffLines = [
    `diff --git a/${path} b/${path}`,
    `--- ${beforeContent == null ? "/dev/null" : `a/${path}`}`,
    `+++ ${afterContent == null ? "/dev/null" : `b/${path}`}`,
    `@@ -${oldStart},${removedLines.length} +${newStart},${addedLines.length} @@`,
    ...removedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ];

  return {
    type,
    diff: diffLines.join("\n"),
    insertions: addedLines.length,
    deletions: removedLines.length,
  };
}

export function looksLikeUnifiedDiff(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.startsWith("diff --git ") ||
    trimmed.includes("\n@@ ") ||
    trimmed.startsWith("@@ ") ||
    trimmed.includes("\n--- ") ||
    trimmed.includes("\n+++ ") ||
    trimmed.startsWith("--- ") ||
    trimmed.startsWith("+++ ")
  );
}

export function normalizeFileChangeType(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "add" || normalized === "added" || normalized === "create" || normalized === "created") {
    return "added";
  }
  if (normalized === "delete" || normalized === "deleted" || normalized === "remove" || normalized === "removed") {
    return "deleted";
  }
  if (normalized === "rename" || normalized === "renamed" || normalized === "move" || normalized === "moved") {
    return "renamed";
  }
  return "modified";
}

export function parseFileChangeSummary(output: string | undefined) {
  if (!output) {
    return [];
  }
  const descriptors: FileChangeDescriptor[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^([AMDR])\s+(.+)$/);
    if (!match) {
      continue;
    }
    const code = match[1] ?? "M";
    descriptors.push({
      path: match[2]!.trim(),
      type: code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified",
    });
  }
  return descriptors;
}

export function extractFileChangeDescriptors(item: {
  path?: string;
  changeType?: unknown;
  insertions?: number;
  deletions?: number;
  changes?: unknown;
  aggregatedOutput?: string;
}, existingDiff?: string): FileChangeDescriptor[] {
  const rawChanges = Array.isArray(item.changes) ? item.changes : [];
  const fromChanges = rawChanges
    .map((change) => {
      const record = change && typeof change === "object" && !Array.isArray(change)
        ? (change as Record<string, unknown>)
        : null;
      const path = typeof record?.path === "string" ? record.path.trim() : "";
      if (!path) {
        return null;
      }
      const diff = typeof record?.diff === "string" ? record.diff.trim() : "";
      const insertions = typeof record?.insertions === "number" ? record.insertions : undefined;
      const deletions = typeof record?.deletions === "number" ? record.deletions : undefined;
      return {
        path,
        type: normalizeFileChangeType(record?.kind ?? record?.type ?? item.changeType),
        diff: looksLikeUnifiedDiff(diff) ? diff : undefined,
        insertions,
        deletions,
      } satisfies FileChangeDescriptor;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (fromChanges.length > 0) {
    return fromChanges;
  }

  const fallbackPath = typeof item.path === "string" ? item.path.trim() : "";
  if (fallbackPath) {
    return [{
      path: fallbackPath,
      type: normalizeFileChangeType(item.changeType),
      diff: looksLikeUnifiedDiff(existingDiff) ? existingDiff : undefined,
      insertions: item.insertions,
      deletions: item.deletions,
    }];
  }

  return parseFileChangeSummary(item.aggregatedOutput);
}
