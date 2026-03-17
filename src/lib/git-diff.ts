export type GitDiffSection = "unstaged" | "staged";
export type GitFileStatus = "modified" | "added" | "deleted" | "renamed";

type ParsedDiffChunk = {
  section: GitDiffSection;
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  added: number;
  removed: number;
  lines: string[];
};

export type GitDiffFile = {
  key: string;
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  added: number;
  removed: number;
  hasUnstaged: boolean;
  hasStaged: boolean;
  diffLines: string[];
  unstagedDiffLines?: string[];
  stagedDiffLines?: string[];
};

export type GitDiffViewSection = {
  key: string;
  label: string;
  data: {
    oldFile: { fileName: string; content?: string };
    newFile: { fileName: string; content?: string };
    hunks: string[];
  };
};

export type ParsedHunkLine = {
  id: string;
  type: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type ParsedHunk = {
  key: string;
  header: string;
  lines: ParsedHunkLine[];
};

function mergeDiffLines(existing: string[] | undefined, next: string[]) {
  if (!existing || existing.length === 0) {
    return [...next];
  }
  if (next.length === 0) {
    return [...existing];
  }
  if (existing[existing.length - 1] === "" || next[0] === "") {
    return [...existing, ...next];
  }
  return [...existing, "", ...next];
}

function normalizeDiffPath(rawPath: string | undefined, fallback: string) {
  if (!rawPath) {
    return fallback;
  }
  const value = rawPath.trim().split(/\s+/)[0] ?? fallback;
  if (value === "/dev/null") {
    return fallback;
  }
  return value.replace(/^[ab]\//, "");
}

function buildDiffViewData(file: GitDiffFile, hunks: string[]) {
  const oldHeader = hunks.find((line) => line.startsWith("--- "));
  const newHeader = hunks.find((line) => line.startsWith("+++ "));
  const oldFileName = normalizeDiffPath(oldHeader?.slice(4), file.oldPath ?? file.path);
  const newFileName = normalizeDiffPath(newHeader?.slice(4), file.path);

  return {
    oldFile: { fileName: oldFileName },
    newFile: { fileName: newFileName },
    hunks,
  };
}

function statusPriority(status: GitFileStatus) {
  if (status === "renamed") {
    return 4;
  }
  if (status === "deleted") {
    return 3;
  }
  if (status === "added") {
    return 2;
  }
  return 1;
}

export function inferStatusTag(status: GitFileStatus) {
  if (status === "added") {
    return "A";
  }
  if (status === "deleted") {
    return "D";
  }
  if (status === "renamed") {
    return "R";
  }
  return "M";
}

export function parseGitDiffOutput(output: string): { files: GitDiffFile[]; message?: string } {
  if (!output.trim()) {
    return { files: [], message: "No local changes." };
  }
  if (output.startsWith("Loading diff")) {
    return { files: [], message: "Loading diff..." };
  }
  if (output === "No local changes." || output === "Not a git repository.") {
    return { files: [], message: output };
  }

  const lines = output.split(/\r?\n/);
  const chunks: ParsedDiffChunk[] = [];
  let section: GitDiffSection = "unstaged";
  let current: ParsedDiffChunk | null = null;

  const flushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line === "## Unstaged") {
      flushCurrent();
      section = "unstaged";
      continue;
    }
    if (line === "## Staged") {
      flushCurrent();
      section = "staged";
      continue;
    }
    if (line === "## Untracked") {
      flushCurrent();
      section = "unstaged";
      continue;
    }

    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      flushCurrent();
      current = {
        section,
        path: diffMatch[2] ?? diffMatch[1] ?? "",
        oldPath: undefined,
        status: "modified",
        added: 0,
        removed: 0,
        lines: [line],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);

    if (line.startsWith("new file mode ")) {
      current.status = "added";
    } else if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
    } else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.replace("rename from ", "").trim();
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.replace("rename to ", "").trim();
    } else if (line.startsWith("--- /dev/null")) {
      current.status = "added";
    } else if (line.startsWith("+++ /dev/null")) {
      current.status = "deleted";
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
    }
  }
  flushCurrent();

  if (chunks.length === 0) {
    return { files: [], message: output.trim() };
  }

  const grouped = new Map<string, GitDiffFile>();
  for (const chunk of chunks) {
    const key = chunk.oldPath ? `${chunk.oldPath}->${chunk.path}` : chunk.path;
    const existing = grouped.get(key);
    const chunkLines = [...chunk.lines];
    const nextDiffLines = mergeDiffLines(existing?.diffLines, chunkLines);

    if (!existing) {
      grouped.set(key, {
        key,
        path: chunk.path,
        oldPath: chunk.oldPath,
        status: chunk.status,
        added: chunk.added,
        removed: chunk.removed,
        hasUnstaged: chunk.section === "unstaged",
        hasStaged: chunk.section === "staged",
        diffLines: nextDiffLines,
        unstagedDiffLines: chunk.section === "unstaged" ? [...chunkLines] : undefined,
        stagedDiffLines: chunk.section === "staged" ? [...chunkLines] : undefined,
      });
      continue;
    }

    existing.added += chunk.added;
    existing.removed += chunk.removed;
    existing.hasUnstaged = existing.hasUnstaged || chunk.section === "unstaged";
    existing.hasStaged = existing.hasStaged || chunk.section === "staged";
    existing.diffLines = nextDiffLines;
    if (chunk.section === "unstaged") {
      existing.unstagedDiffLines = mergeDiffLines(existing.unstagedDiffLines, chunkLines);
    }
    if (chunk.section === "staged") {
      existing.stagedDiffLines = mergeDiffLines(existing.stagedDiffLines, chunkLines);
    }

    if (statusPriority(chunk.status) > statusPriority(existing.status)) {
      existing.status = chunk.status;
    }
    if (!existing.oldPath && chunk.oldPath) {
      existing.oldPath = chunk.oldPath;
    }
    existing.path = chunk.path;
  }

  const files = Array.from(grouped.values()).sort((left, right) => left.path.localeCompare(right.path));
  return { files };
}

export function toDiffSections(file: GitDiffFile | null): GitDiffViewSection[] {
  if (!file) {
    return [];
  }
  const sections: GitDiffViewSection[] = [];
  if (file.unstagedDiffLines && file.unstagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:unstaged`,
      label: "Unstaged",
      data: buildDiffViewData(file, file.unstagedDiffLines),
    });
  }
  if (file.stagedDiffLines && file.stagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:staged`,
      label: "Staged",
      data: buildDiffViewData(file, file.stagedDiffLines),
    });
  }
  if (sections.length === 0 && file.diffLines.length > 0) {
    sections.push({
      key: `${file.key}:diff`,
      label: "Changes",
      data: buildDiffViewData(file, file.diffLines),
    });
  }
  return sections;
}

export function parseHunkHeader(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    return { oldStart: 0, newStart: 0 };
  }
  return {
    oldStart: Number(match[1] ?? "0"),
    newStart: Number(match[3] ?? "0"),
  };
}

export function parseDiffHunks(section: GitDiffViewSection): ParsedHunk[] {
  const lines = section.data.hunks;
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flush();
      const start = parseHunkHeader(line);
      oldLine = start.oldStart;
      newLine = start.newStart;
      current = {
        key: `${section.key}:${hunks.length}`,
        header: line,
        lines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push({
        id: `${current.key}:n${newLine}`,
        type: "add",
        text: line.slice(1),
        oldLine: null,
        newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.lines.push({
        id: `${current.key}:o${oldLine}`,
        type: "remove",
        text: line.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      current.lines.push({
        id: `${current.key}:c${oldLine}:${newLine}`,
        type: "context",
        text: line.slice(1),
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  flush();
  return hunks;
}

export function lineNumber(value: number | null) {
  if (value === null) {
    return "";
  }
  return String(value);
}
