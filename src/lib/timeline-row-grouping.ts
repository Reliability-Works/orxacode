import type { UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";

export function groupAdjacentExploreRows(rows: UnifiedTimelineRenderRow[]): UnifiedTimelineRenderRow[] {
  const nextRows: UnifiedTimelineRenderRow[] = [];
  let pending: Extract<UnifiedTimelineRenderRow, { kind: "explore" }> | null = null;

  const flush = () => {
    if (!pending) {
      return;
    }
    nextRows.push(pending);
    pending = null;
  };

  for (const row of rows) {
    if (row.kind !== "explore") {
      flush();
      nextRows.push(row);
      continue;
    }

    if (!pending) {
      pending = row;
      continue;
    }

    pending = {
      ...pending,
      id: `${pending.id}:${row.id}`,
      item: {
        ...pending.item,
        status: pending.item.status === "exploring" || row.item.status === "exploring" ? "exploring" : "explored",
        entries: [...pending.item.entries, ...row.item.entries],
      },
    };
  }

  flush();
  return nextRows;
}

function isExplorationOnlyTimelineRow(row: UnifiedTimelineRenderRow): row is Extract<UnifiedTimelineRenderRow, { kind: "timeline" }> {
  return row.kind === "timeline" && row.blocks.length > 0 && row.blocks.every((block) => block.type === "exploration");
}

export function groupAdjacentTimelineExplorationRows(rows: UnifiedTimelineRenderRow[]): UnifiedTimelineRenderRow[] {
  const nextRows: UnifiedTimelineRenderRow[] = [];
  let pending: Extract<UnifiedTimelineRenderRow, { kind: "timeline" }> | null = null;

  const flush = () => {
    if (!pending) {
      return;
    }
    nextRows.push(pending);
    pending = null;
  };

  for (const row of rows) {
    if (!isExplorationOnlyTimelineRow(row)) {
      flush();
      nextRows.push(row);
      continue;
    }

    if (!pending) {
      pending = row;
      continue;
    }

    pending = {
      ...pending,
      id: `${pending.id}:${row.id}`,
      blocks: [...pending.blocks, ...row.blocks],
    };
  }

  flush();
  return nextRows;
}

export function groupAdjacentToolCallRows(
  rows: UnifiedTimelineRenderRow[],
  options?: { enabled?: boolean },
): UnifiedTimelineRenderRow[] {
  if (options?.enabled === false) {
    return rows;
  }

  const nextRows: UnifiedTimelineRenderRow[] = [];
  let pendingDiffs: Extract<UnifiedTimelineRenderRow, { kind: "diff" }>[] = [];
  let pendingTools: Extract<UnifiedTimelineRenderRow, { kind: "tool" }>[] = [];

  const flush = () => {
    if (pendingDiffs.length === 0 && pendingTools.length === 0) {
      return;
    }
    const firstId = pendingDiffs[0]?.id ?? pendingTools[0]?.id ?? "tool-group";
    nextRows.push({
      id: `${firstId}:tool-calls`,
      kind: "tool-group",
      title: "Tool calls",
      files: pendingDiffs.map((diff) => ({
        id: diff.id,
        path: diff.path,
        type: diff.type,
        diff: diff.diff,
        insertions: diff.insertions,
        deletions: diff.deletions,
      })),
      tools: pendingTools.length > 0 ? pendingTools : undefined,
    });
    pendingDiffs = [];
    pendingTools = [];
  };

  let deferredNonToolRows: UnifiedTimelineRenderRow[] = [];

  for (const row of rows) {
    if (row.kind === "diff") {
      pendingDiffs.push(row);
      continue;
    }
    if (row.kind === "tool") {
      pendingTools.push(row);
      continue;
    }
    // These lightweight rows shouldn't break tool grouping
    if ((row.kind === "explore" || row.kind === "context" || row.kind === "timeline") && (pendingDiffs.length > 0 || pendingTools.length > 0)) {
      deferredNonToolRows.push(row);
      continue;
    }
    flush();
    for (const deferred of deferredNonToolRows) nextRows.push(deferred);
    deferredNonToolRows = [];
    nextRows.push(row);
  }

  flush();
  for (const deferred of deferredNonToolRows) nextRows.push(deferred);
  return nextRows;
}

export function extractReviewChangesFiles(rows: UnifiedTimelineRenderRow[]) {
  const latestByPath = new Map<string, {
    id: string;
    path: string;
    type: string;
    diff?: string;
    insertions?: number;
    deletions?: number;
  }>();

  for (const row of rows) {
    if (row.kind === "diff") {
      latestByPath.set(row.path, {
        id: row.id,
        path: row.path,
        type: row.type,
        diff: row.diff,
        insertions: row.insertions,
        deletions: row.deletions,
      });
      continue;
    }
    if (row.kind === "diff-group" || row.kind === "tool-group") {
      for (const file of row.files) {
        latestByPath.set(file.path, file);
      }
    }
  }

  return [...latestByPath.values()];
}
