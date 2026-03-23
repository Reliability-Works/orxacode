import type { UnifiedProjectedSessionPresentation, UnifiedSessionPresentation } from "./session-presentation";
import type { UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";
import type { ClaudeChatMessageItem } from "../hooks/useClaudeChatSession";
import {
  groupAdjacentExploreRows,
  groupAdjacentTimelineExplorationRows,
  groupAdjacentToolCallRows,
  groupChangedFileRows,
} from "./session-presentation";

export function projectClaudeChatSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
): UnifiedSessionPresentation {
  const rawRows: UnifiedTimelineRenderRow[] = [];
  let previousWasAssistantContent = false;

  for (const item of messages) {
    if (item.kind === "message") {
      const role = item.role;
      const showHeader = !(role === "assistant" && previousWasAssistantContent);
      previousWasAssistantContent = role === "assistant";
      rawRows.push({
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
      });
      continue;
    }

    previousWasAssistantContent = true;

    if (item.kind === "thinking") {
      rawRows.push({ id: item.id, kind: "thinking", summary: item.summary, content: item.content });
      continue;
    }
    if (item.kind === "status") {
      rawRows.push({ id: item.id, kind: "status", label: item.label });
      continue;
    }
    if (item.kind === "tool") {
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

  return {
    provider: "claude-chat",
    rows: groupAdjacentExploreRows(
      groupAdjacentTimelineExplorationRows(
        groupAdjacentToolCallRows(groupChangedFileRows(rawRows, { enabled: !isStreaming }), { enabled: isStreaming }),
      ),
    ),
  };
}

export function projectClaudeChatProjectedSessionPresentation(
  messages: ClaudeChatMessageItem[],
  isStreaming: boolean,
): UnifiedProjectedSessionPresentation {
  const presentation = projectClaudeChatSessionPresentation(messages, isStreaming);
  return {
    ...presentation,
    latestActivity: null,
    placeholderTimestamp: messages.at(-1)?.timestamp ?? 0,
  };
}
