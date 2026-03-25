import type { ToolCallStatus } from "./ToolCallCard";
import type { ContextToolItem } from "./ContextToolGroup";
import type { ExploreRowItem } from "./ExploreRow";
import type { TimelineBlock } from "../../lib/message-feed-timeline";

export type UnifiedMessageSection =
  | {
      id: string;
      type: "text";
      content: string;
    }
  | {
      id: string;
      type: "file";
      label: string;
    }
  | {
      id: string;
      type: "image";
      url: string;
      label: string;
    };

export type UnifiedTimelineRenderRow =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      label: string;
      timestamp?: number;
      showHeader?: boolean;
      copyText?: string;
      copyLabel?: string;
      sections: UnifiedMessageSection[];
    }
  | {
      id: string;
      kind: "thinking";
      summary?: string;
      content?: string;
    }
  | {
      id: string;
      kind: "tool";
      title: string;
      expandedTitle?: string;
      subtitle?: string;
      status: ToolCallStatus;
      command?: string;
      output?: string;
      error?: string;
      defaultExpanded?: boolean;
    }
  | {
      id: string;
      kind: "diff";
      path: string;
      type: string;
      diff?: string;
      insertions?: number;
      deletions?: number;
    }
  | {
      id: string;
      kind: "diff-group";
      title: string;
      files: Array<{
        id: string;
        path: string;
        type: string;
        diff?: string;
        insertions?: number;
        deletions?: number;
      }>;
    }
  | {
      id: string;
      kind: "tool-group";
      title: string;
      files: Array<{
        id: string;
        path: string;
        type: string;
        diff?: string;
        insertions?: number;
        deletions?: number;
      }>;
      tools?: Array<Extract<UnifiedTimelineRenderRow, { kind: "tool" }>>;
    }
  | {
      id: string;
      kind: "context";
      items: ContextToolItem[];
    }
  | {
      id: string;
      kind: "explore";
      item: ExploreRowItem;
    }
  | {
      id: string;
      kind: "timeline";
      blocks: TimelineBlock[];
    }
  | {
      id: string;
      kind: "notice";
      label: string;
      detail?: string;
      tone?: "info" | "error";
      timestamp?: number;
    }
  | {
      id: string;
      kind: "status";
      label: string;
    }
  | {
      id: string;
      kind: "compaction";
    }
  | {
      id: string;
      kind: "turn-divider";
      timestamp?: number;
      durationSeconds?: number;
    };

export function estimateUnifiedTimelineRowHeight(row: UnifiedTimelineRenderRow) {
  switch (row.kind) {
    case "message": {
      let estimate = row.showHeader === false ? 28 : 52;
      for (const section of row.sections) {
        if (section.type === "text") {
          estimate += 28 + Math.min(420, Math.ceil(section.content.length / 72) * 20);
        } else {
          estimate += 32;
        }
      }
      return Math.min(estimate, 1400);
    }
    case "thinking":
      return row.content?.trim() ? 92 : 36;
    case "tool":
      return 80 + Math.min(520, Math.ceil(((row.output ?? row.error)?.length ?? 0) / 120) * 18);
    case "diff":
      return row.diff ? 68 : 44;
    case "diff-group":
      return 34 + row.files.reduce((total, file) => total + (file.diff ? 68 : 44), 0);
    case "tool-group":
      return 34
        + row.files.reduce((total, file) => total + (file.diff ? 68 : 44), 0)
        + (row.tools ?? []).reduce((total, tool) => total + 80 + Math.min(520, Math.ceil(((tool.output ?? tool.error)?.length ?? 0) / 120) * 18), 0);
    case "context":
      return row.items.length > 1 ? 72 : 52;
    case "explore":
      return 44 + row.item.entries.length * 24;
    case "timeline":
      return Math.min(120 + row.blocks.length * 36, 920);
    case "notice":
      return row.detail ? 112 : 84;
    case "status":
      return 30;
    case "compaction":
      return 42;
    case "turn-divider":
      return 32;
    default:
      return 72;
  }
}
