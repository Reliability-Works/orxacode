type PatchFileStat = {
  filePath: string;
  additions: number;
  deletions: number;
};

type WriteFileSummary = {
  verb: "Created" | "Edited";
  summary: string;
};

function compactText(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function toWorkspaceRelativePath(target: string, workspaceDirectory?: string | null) {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedWorkspace = (workspaceDirectory ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalizedWorkspace) {
    return normalizedTarget;
  }
  if (normalizedTarget === normalizedWorkspace) {
    return ".";
  }
  if (normalizedTarget.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedTarget.slice(normalizedWorkspace.length + 1);
  }
  const embeddedWorkspaceIndex = normalizedTarget.indexOf(`${normalizedWorkspace}/`);
  if (embeddedWorkspaceIndex >= 0) {
    return normalizedTarget.slice(embeddedWorkspaceIndex + normalizedWorkspace.length + 1);
  }
  return normalizedTarget;
}

function formatTarget(target: string, workspaceDirectory?: string | null, maxLength = 58) {
  return compactText(toWorkspaceRelativePath(target, workspaceDirectory), maxLength);
}

function extractStringByKeys(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const nested = extractStringByKeys(value, keys);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(record)) {
    const nested = extractStringByKeys(value, keys);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function toObjectRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function isLikelyPatchText(value: string) {
  return /(?:\*\*\*\s+(?:Begin Patch|Update|Add|Delete)\s+File:|diff --git\s+a\/|@@)/.test(value);
}

function extractPatchText(input: unknown, output: unknown) {
  const candidates: string[] = [];
  if (typeof input === "string" && input.trim()) {
    candidates.push(input);
  }
  const nestedPatchText = extractStringByKeys(input, ["patch", "content", "text", "diff"]);
  if (nestedPatchText) {
    candidates.push(nestedPatchText);
  }
  if (typeof output === "string" && output.trim()) {
    candidates.push(output);
  }
  return candidates.find((candidate) => isLikelyPatchText(candidate)) ?? null;
}

function parsePatchFileStats(patchText: string, workspaceDirectory?: string | null): PatchFileStat[] {
  const lines = patchText.split(/\r?\n/);
  const stats = new Map<string, PatchFileStat>();
  let currentFilePath: string | null = null;

  const normalizePath = (rawPath: string) => {
    const cleaned = rawPath
      .trim()
      .replace(/^a\//, "")
      .replace(/^b\//, "");
    return formatTarget(cleaned, workspaceDirectory, 96);
  };

  const startFile = (rawPath: string) => {
    const nextPath = normalizePath(rawPath);
    if (!nextPath) {
      return;
    }
    if (currentFilePath === nextPath) {
      return;
    }
    currentFilePath = nextPath;
    if (!stats.has(nextPath)) {
      stats.set(nextPath, { filePath: nextPath, additions: 0, deletions: 0 });
    }
  };

  for (const line of lines) {
    const applyPatchMatch = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/i);
    if (applyPatchMatch?.[1]) {
      startFile(applyPatchMatch[1]);
      continue;
    }
    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitDiffMatch?.[2]) {
      startFile(gitDiffMatch[2]);
      continue;
    }
    const plusPlusPlusMatch = line.match(/^\+\+\+\s+(.+)$/);
    if (plusPlusPlusMatch?.[1] && plusPlusPlusMatch[1] !== "/dev/null") {
      startFile(plusPlusPlusMatch[1]);
      continue;
    }
    if (!currentFilePath) {
      continue;
    }
    const active = stats.get(currentFilePath);
    if (!active) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      active.additions += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      active.deletions += 1;
    }
  }
  return [...stats.values()];
}

function summarizePatchFileStats(stats: PatchFileStat[]) {
  if (stats.length === 0) {
    return null;
  }
  const [first] = stats;
  const base = `${first.filePath} +${first.additions} | -${first.deletions}`;
  if (stats.length === 1) {
    return base;
  }
  return `${base} (+${stats.length - 1} more file${stats.length - 1 === 1 ? "" : "s"})`;
}

function countContentLines(value: string) {
  const normalized = value.replace(/\r/g, "");
  if (!normalized) {
    return 0;
  }
  return normalized.split("\n").length;
}

function collectMetadataFileDiffStats(
  value: unknown,
  workspaceDirectory: string | null | undefined,
  depth = 0,
): PatchFileStat[] {
  if (!value || depth > 4) {
    return [];
  }
  const toStat = (record: Record<string, unknown>): PatchFileStat | null => {
    const rawFile = ["file", "filepath", "filePath", "path"]
      .map((key) => record[key])
      .find((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (!rawFile) {
      return null;
    }
    const additionsRaw = ["additions", "added", "insertions"]
      .map((key) => record[key])
      .find((item) => typeof item === "number");
    const deletionsRaw = ["deletions", "removed", "removals"]
      .map((key) => record[key])
      .find((item) => typeof item === "number");
    return {
      filePath: formatTarget(rawFile, workspaceDirectory, 96),
      additions: typeof additionsRaw === "number" ? Math.max(0, Math.round(additionsRaw)) : 0,
      deletions: typeof deletionsRaw === "number" ? Math.max(0, Math.round(deletionsRaw)) : 0,
    };
  };

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectMetadataFileDiffStats(entry, workspaceDirectory, depth + 1));
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const found: PatchFileStat[] = [];
  const direct = toStat(record);
  if (direct) {
    found.push(direct);
  }
  for (const nestedKey of ["filediff", "filediffs", "files", "changes", "diff", "result", "output", "metadata"]) {
    if (nestedKey in record) {
      found.push(...collectMetadataFileDiffStats(record[nestedKey], workspaceDirectory, depth + 1));
    }
  }
  return found;
}

export function extractMetaFileDiffSummary(metadata: unknown, workspaceDirectory?: string | null) {
  const stats = collectMetadataFileDiffStats(metadata, workspaceDirectory);
  if (stats.length === 0) {
    return null;
  }
  const merged = new Map<string, PatchFileStat>();
  for (const stat of stats) {
    const existing = merged.get(stat.filePath);
    if (!existing) {
      merged.set(stat.filePath, { ...stat });
      continue;
    }
    existing.additions += stat.additions;
    existing.deletions += stat.deletions;
  }
  return summarizePatchFileStats([...merged.values()]);
}

export function extractWriteFileSummary(
  input: unknown,
  metadata: unknown,
  workspaceDirectory?: string | null,
): WriteFileSummary | null {
  const inputRecord = toObjectRecord(input);
  const metadataRecord = toObjectRecord(metadata);
  const filepath =
    (metadataRecord && typeof metadataRecord.filepath === "string" ? metadataRecord.filepath : undefined) ??
    (inputRecord && typeof inputRecord.filePath === "string" ? inputRecord.filePath : undefined) ??
    (inputRecord && typeof inputRecord.path === "string" ? inputRecord.path : undefined);
  if (!filepath) {
    return null;
  }
  const exists = metadataRecord && typeof metadataRecord.exists === "boolean" ? metadataRecord.exists : undefined;
  const target = formatTarget(filepath, workspaceDirectory, 96);
  if (exists === false) {
    const content = inputRecord && typeof inputRecord.content === "string" ? inputRecord.content : "";
    const additions = countContentLines(content);
    return {
      verb: "Created",
      summary: `${target} +${additions} | -0`,
    };
  }
  return {
    verb: "Edited",
    summary: target,
  };
}

export function extractPatchSummary(input: unknown, output: unknown, workspaceDirectory?: string | null) {
  const patchText = extractPatchText(input, output);
  if (!patchText) {
    return null;
  }
  return summarizePatchFileStats(parsePatchFileStats(patchText, workspaceDirectory));
}
