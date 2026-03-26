import type { UnifiedProjectedSessionPresentation, UnifiedSessionPresentation } from "./session-presentation";
import type { UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "../hooks/useClaudeChatSession";
import { groupChangedFileRows } from "./session-presentation";
import { groupAdjacentTimelineExplorationRows, groupAdjacentToolCallRows } from "./timeline-row-grouping";

function compactDelegationText(value: string, maxLength = 72) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function buildClaudeDelegationSummary(subagents: ClaudeChatSubagentState[]) {
  const activeSubagents = subagents.filter((agent) => agent.status === "thinking" || agent.status === "awaiting_instruction");
  if (activeSubagents.length === 0) {
    return null;
  }
  if (activeSubagents.length === 1) {
    const taskText = compactDelegationText(activeSubagents[0]?.taskText ?? "");
    if (taskText) {
      return `Delegating: Waiting on ${taskText}`;
    }
  }
  if (activeSubagents.length > 1) {
    return `Delegating: Waiting on ${activeSubagents.length} background agents`;
  }
  return "Delegating: Waiting on background agent";
}

export function projectClaudeChatSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
  subagents: ClaudeChatSubagentState[] = [],
): UnifiedSessionPresentation {
  const rawRows: UnifiedTimelineRenderRow[] = [];
  let previousWasAssistantContent = false;
  let pendingThinkingRows: Extract<UnifiedTimelineRenderRow, { kind: "thinking" }>[] = [];
  const delegationSummary = buildClaudeDelegationSummary(subagents);

  const flushPendingThinkingRows = () => {
    if (pendingThinkingRows.length === 0) {
      return;
    }
    if (delegationSummary) {
      const firstThinkingRow = pendingThinkingRows[0];
      if (firstThinkingRow) {
        rawRows.push({
          ...firstThinkingRow,
          summary: delegationSummary,
          content: "",
        });
      }
    } else {
      rawRows.push(...pendingThinkingRows);
    }
    pendingThinkingRows = [];
  };

  for (const item of messages) {
    if (item.kind === "message") {
      if (item.role !== "assistant") {
        flushPendingThinkingRows();
      }
      const role = item.role;
      const showHeader = !(role === "assistant" && previousWasAssistantContent);
      previousWasAssistantContent = role === "assistant";
      const messageRow: UnifiedTimelineRenderRow = {
        id: item.id,
        kind: "message",
        role,
        label: role === "user" ? "User" : "Claude",
        timestamp: item.timestamp,
        showHeader,
        copyText: role === "user" ? item.content : undefined,
        sections: item.content || (isStreaming && role === "assistant")
          ? [{ id: `${item.id}:content`, type: "text", content: item.content || "\u2588" }]
          : [],
      };
      rawRows.push(messageRow);
      if (role === "assistant") {
        flushPendingThinkingRows();
      }
      continue;
    }

    previousWasAssistantContent = true;

    if (item.kind === "thinking") {
      pendingThinkingRows.push({ id: item.id, kind: "thinking", summary: item.summary, content: item.content });
      continue;
    }
    flushPendingThinkingRows();
    if (item.kind === "status") {
      rawRows.push({ id: item.id, kind: "status", label: item.label });
      continue;
    }
    if (item.kind === "tool") {
      if (item.source === "delegated") {
        continue;
      }
      rawRows.push({
        id: item.id,
        kind: "tool",
        title: item.title,
        status: item.status,
        command: item.command,
        output: item.output,
        error: item.error,
        defaultExpanded: false,
      });
      continue;
    }
    if (item.kind === "explore") {
      if (item.source === "delegated") {
        continue;
      }
      rawRows.push({
        id: item.id,
        kind: "explore",
        item: {
          id: item.id,
          status: item.status,
          entries: item.entries,
          timestamp: item.timestamp,
        },
      });
      continue;
    }
    if (item.kind === "notice") {
      rawRows.push({
        id: item.id,
        kind: "notice",
        label: item.label,
        detail: item.detail,
        tone: item.tone,
        timestamp: item.timestamp,
      });
    }
  }

  flushPendingThinkingRows();

  return {
    provider: "claude-chat",
    rows: groupAdjacentTimelineExplorationRows(
      groupAdjacentToolCallRows(groupChangedFileRows(rawRows, { enabled: !isStreaming }), { enabled: isStreaming }),
    ),
  };
}

export function projectClaudeChatProjectedSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
  subagents: ClaudeChatSubagentState[] = [],
): UnifiedProjectedSessionPresentation {
  const presentation = projectClaudeChatSessionPresentation(messages, isStreaming, subagents);
  return {
    ...presentation,
    latestActivity: null,
    placeholderTimestamp: messages.at(-1)?.timestamp ?? 0,
  };
}
