import type { ExecutionEventKind, ExecutionEventRecord } from "@shared/ipc";

export type TimelineVerb = "Read" | "Searched" | "Edited" | "Created" | "Deleted" | "Ran" | "Checked git" | "Delegated";

export function kindToTimelineVerb(kind: ExecutionEventKind): TimelineVerb {
  if (kind === "read") {
    return "Read";
  }
  if (kind === "search") {
    return "Searched";
  }
  if (kind === "edit") {
    return "Edited";
  }
  if (kind === "create") {
    return "Created";
  }
  if (kind === "delete") {
    return "Deleted";
  }
  if (kind === "git") {
    return "Checked git";
  }
  if (kind === "delegate") {
    return "Delegated";
  }
  return "Ran";
}

export function toTimelineLabel(record: ExecutionEventRecord) {
  const verb = kindToTimelineVerb(record.kind);
  const target = record.paths?.[0];
  if (verb === "Delegated") {
    return record.summary;
  }
  if (target && target !== ".") {
    return `${verb} ${target}`;
  }
  return record.summary || verb;
}

export function normalizeLedgerPath(pathValue: string, workspaceDirectory: string | null | undefined) {
  const target = pathValue.replace(/\\/g, "/");
  const workspace = (workspaceDirectory ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!workspace) {
    return target;
  }
  if (target.startsWith(`${workspace}/`)) {
    return target.slice(workspace.length + 1);
  }
  if (target === workspace) {
    return ".";
  }
  return target;
}

export function groupLedgerByTurn(records: ExecutionEventRecord[]) {
  const grouped = new Map<string, ExecutionEventRecord[]>();
  for (const record of records) {
    const key = record.turnID ?? "unknown";
    const existing = grouped.get(key);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(key, [record]);
    }
  }
  for (const row of grouped.values()) {
    row.sort((a, b) => a.timestamp - b.timestamp);
  }
  return grouped;
}

