import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
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
}: Props) {
  const messageFeedRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
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

  useEffect(() => {
    const el = messageFeedRef.current;
    if (!el) {
      return;
    }
    const handleScroll = () => {
      isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!isAtBottomRef.current) {
      return;
    }
    const el = messageFeedRef.current;
    if (!el) {
      return;
    }
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, renderedRows.length, sessionNotices.length, showAssistantPlaceholder]);

  return (
    <VirtualizedTimeline
      rows={feedRows}
      scrollRef={messageFeedRef}
      className="messages-scroll"
      onScroll={undefined}
      style={messageFeedStyle}
      virtualize={false}
      emptyState={
        renderedRows.length === 0 && !(showAssistantPlaceholder && messages.length > 0)
          ? <div className="messages-empty">No messages yet. Start by sending a prompt.</div>
          : undefined
      }
      estimateSize={estimateUnifiedTimelineRowHeight}
      renderRow={(row) => <UnifiedTimelineRowView key={row.id} row={row} onOpenFileReference={onOpenFileReference} />}
      footer={
        showAssistantPlaceholder && (messages.length > 0 || renderedRows.length > 0) ? (
          <>
            <MessageCardFrame role="assistant" label={assistantLabel} timestamp={placeholderTimestamp}>
              <div className="message-parts">
                <section className="message-part thinking-panel">
                  <div className="message-thinking">
                    <ThinkingRow summary={latestActivity?.label ?? "Thinking"} content={latestActivityContent ?? ""} />
                  </div>
                </section>
              </div>
            </MessageCardFrame>
            <WorkingIndicator active startTimestamp={placeholderTimestamp || undefined} />
          </>
        ) : undefined
      }
    />
  );
});
