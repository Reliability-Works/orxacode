import { memo, useMemo, useRef, type CSSProperties } from "react";
import type { SessionMessageBundle } from "@shared/ipc";
import { MessageCardFrame } from "./chat/MessageCardFrame";
import { ThinkingRow } from "./chat/ThinkingRow";
import { WorkingIndicator } from "./chat/WorkingIndicator";
import { VirtualizedTimeline } from "./chat/VirtualizedTimeline";
import { UnifiedTimelineRowView } from "./chat/UnifiedTimelineRow";
import { estimateUnifiedTimelineRowHeight, type UnifiedTimelineRenderRow } from "./chat/unified-timeline-model";
import { projectOpencodeSessionPresentation } from "../lib/opencode-session-presentation";
import type { UnifiedProjectedSessionPresentation } from "../lib/session-presentation";

type Props = {
  messages?: SessionMessageBundle[];
  presentation?: UnifiedProjectedSessionPresentation | null;
  sessionNotices?: SessionFeedNotice[];
  showAssistantPlaceholder?: boolean;
  assistantLabel?: string;
  workspaceDirectory?: string | null;
  bottomClearance?: number;
  onOpenFileReference?: (reference: string) => void;
  sessionId?: string;
};

type SessionFeedNotice = {
  id: string;
  time: number;
  label: string;
  detail?: string;
  tone?: "info" | "error";
};

export const MessageFeed = memo(function MessageFeed({
  messages = [],
  presentation,
  sessionNotices = [],
  showAssistantPlaceholder = false,
  assistantLabel = "Orxa",
  workspaceDirectory,
  bottomClearance = 24,
  onOpenFileReference,
  sessionId,
}: Props) {
  const messageFeedRef = useRef<HTMLDivElement | null>(null);
  const messageFeedStyle = useMemo(
    () =>
      ({
        "--message-feed-bottom-clearance": `${Math.max(24, Math.round(bottomClearance))}px`,
      }) as CSSProperties,
    [bottomClearance],
  );
  const computedPresentation = useMemo(
    () => presentation ?? projectOpencodeSessionPresentation({ messages, assistantLabel, workspaceDirectory }),
    [assistantLabel, messages, presentation, workspaceDirectory],
  );
  const { rows: renderedRows, latestActivity, latestActivityContent, placeholderTimestamp } = computedPresentation;
  const feedRows = useMemo<UnifiedTimelineRenderRow[]>(() => {
    if (sessionNotices.length === 0) return renderedRows;

    const noticeRows: Array<{ time: number; row: UnifiedTimelineRenderRow }> = sessionNotices.map((notice) => ({
      time: notice.time,
      row: {
        id: `notice:${notice.id}`,
        kind: "notice" as const,
        label: notice.label,
        detail: notice.detail,
        tone: notice.tone,
        timestamp: notice.time,
      },
    }));

    // Merge notices into rendered rows at the correct chronological position.
    const result = [...renderedRows];
    for (const { time, row: noticeRow } of noticeRows) {
      let insertAt = result.length;
      for (let i = result.length - 1; i >= 0; i--) {
        const row = result[i]!;
        const rowTime = "timestamp" in row ? ((row as { timestamp?: number }).timestamp ?? 0) : 0;
        if (rowTime <= time) {
          insertAt = i + 1;
          break;
        }
        if (i === 0) insertAt = 0;
      }
      result.splice(insertAt, 0, noticeRow);
    }
    return result;
  }, [renderedRows, sessionNotices]);

  // Scroll-snap on session switch and auto-scroll on new messages are now
  // handled universally inside VirtualizedTimeline via the sessionId prop.

  return (
    <VirtualizedTimeline
      rows={feedRows}
      scrollRef={messageFeedRef}
      className="messages-scroll"
      onScroll={undefined}
      style={messageFeedStyle}
      virtualize={false}
      sessionId={sessionId}
      emptyState={
        renderedRows.length === 0 && !(showAssistantPlaceholder && messages.length > 0)
          ? (
            <div className="center-pane-rail">
              <div className="messages-empty">No messages yet. Start by sending a prompt.</div>
            </div>
          )
          : undefined
      }
      estimateSize={estimateUnifiedTimelineRowHeight}
      renderRow={(row) => (
        <div className="center-pane-rail center-pane-rail--row">
          <UnifiedTimelineRowView key={row.id} row={row} onOpenFileReference={onOpenFileReference} />
        </div>
      )}
      footer={
        showAssistantPlaceholder && (messages.length > 0 || renderedRows.length > 0) ? (
          <>
            <div className="center-pane-rail center-pane-rail--row">
              <MessageCardFrame role="assistant" label={assistantLabel} timestamp={placeholderTimestamp}>
                <div className="message-parts">
                  <section className="message-part thinking-panel">
                    <div className="message-thinking">
                      <ThinkingRow summary={latestActivity?.label ?? "Thinking"} content={latestActivityContent ?? ""} />
                    </div>
                  </section>
                </div>
              </MessageCardFrame>
            </div>
            <div className="center-pane-rail center-pane-rail--row">
              <WorkingIndicator active startTimestamp={placeholderTimestamp || undefined} />
            </div>
          </>
        ) : undefined
      }
    />
  );
});
