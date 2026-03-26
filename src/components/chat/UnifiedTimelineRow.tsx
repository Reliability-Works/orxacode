import { type ReactNode, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ToolCallCard } from "./ToolCallCard";
import { CommandOutput } from "./CommandOutput";
import { DiffBlock } from "./DiffBlock";
import { ChangedFilesCluster } from "./ChangedFilesCluster";
import { MessageCardFrame } from "./MessageCardFrame";
import { TextPart } from "./TextPart";
import { ContextToolGroup } from "./ContextToolGroup";
import { ExploreRow } from "./ExploreRow";
import { ToolGroup } from "./ToolGroup";
import { ThinkingRow } from "./ThinkingRow";
import { MessageTurn } from "./MessageTurn";
import { MessageTimelineBlocks } from "../message-feed/TimelineBlocks";
import type { UnifiedMessageSection, UnifiedTimelineRenderRow } from "./unified-timeline-model";

function renderMessageSection(
  section: UnifiedMessageSection,
  role: "user" | "assistant",
  onOpenFileReference?: (reference: string) => void,
): ReactNode {
  if (section.type === "text") {
    return (
      <TextPart
        content={section.content}
        role={role}
        showCopy={false}
        onOpenFileReference={onOpenFileReference}
      />
    );
  }

  if (section.type === "image") {
    return <ClickableImage url={section.url} label={section.label} />;
  }

  return <div className="part-file">Attached file: {section.label}</div>;
}

function ClickableImage({ url, label }: { url: string; label: string }) {
  const [enlarged, setEnlarged] = useState(false);
  const close = useCallback(() => setEnlarged(false), []);

  return (
    <>
      <div className="part-image" role="button" tabIndex={0} onClick={() => setEnlarged(true)} onKeyDown={(e) => { if (e.key === "Enter") setEnlarged(true); }}>
        <img src={url} alt={label} loading="lazy" />
      </div>
      {enlarged ? (
        <div className="image-lightbox" onClick={close} onKeyDown={(e) => { if (e.key === "Escape") close(); }} role="dialog" aria-label="Enlarged image">
          <img src={url} alt={label} className="image-lightbox-img" />
        </div>
      ) : null}
    </>
  );
}

const PLAN_CARD_COLLAPSED_MAX_HEIGHT_PX = 320;

function PlanCardBubble({
  content,
  onOpenFileReference,
}: {
  content: string;
  onOpenFileReference?: (reference: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hasRenderableMarkdown = useMemo(
    () => content.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0,
    [content],
  );

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const measureOverflow = () => {
      setIsOverflowing(body.scrollHeight > PLAN_CARD_COLLAPSED_MAX_HEIGHT_PX + 1);
    };

    measureOverflow();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureOverflow);
      return () => window.removeEventListener("resize", measureOverflow);
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(body);
    return () => observer.disconnect();
  }, [content, hasRenderableMarkdown]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plan.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content]);

  return (
    <article
      className={`plan-card-bubble${expanded ? " plan-card-bubble--expanded" : ""}${isOverflowing ? " plan-card-bubble--collapsible" : ""}`}
    >
      <div className="plan-card-bubble-header">
        <span className="plan-card-bubble-label">Plan</span>
        <div className="plan-card-bubble-actions">
          <button
            type="button"
            className="plan-card-bubble-action-btn"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy plan"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
          </button>
          <button
            type="button"
            className="plan-card-bubble-action-btn"
            onClick={handleDownload}
            aria-label="Download plan"
            title="Download"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          </button>
        </div>
      </div>
      <div ref={bodyRef} className="plan-card-bubble-body">
        {hasRenderableMarkdown ? (
          <TextPart
            content={content}
            role="assistant"
            showCopy={false}
            onOpenFileReference={onOpenFileReference}
          />
        ) : (
          <pre className="plan-card-bubble-fallback">{content}</pre>
        )}
      </div>
      {isOverflowing ? (
        <button
          type="button"
          className="plan-card-bubble-toggle"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? "Collapse plan" : "Expand plan"}
          <svg
            className={`plan-card-bubble-chevron${expanded ? " plan-card-bubble-chevron--up" : ""}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      ) : null}
    </article>
  );
}

export function UnifiedTimelineRowView({
  row,
  onOpenFileReference,
}: {
  row: UnifiedTimelineRenderRow;
  onOpenFileReference?: (reference: string) => void;
}) {
  switch (row.kind) {
    case "message":
      return (
        <MessageTurn>
          <MessageCardFrame
            role={row.role}
            label={row.label}
            timestamp={row.timestamp}
            showHeader={row.showHeader}
            copyText={row.copyText}
            copyLabel={row.copyLabel}
          >
            {row.sections.map((section) =>
              section.type === "image" ? (
                <div key={section.id} className="message-part-image">
                  {renderMessageSection(section, row.role, onOpenFileReference)}
                </div>
              ) : (
                <section key={section.id} className="message-part">
                  {renderMessageSection(section, row.role, onOpenFileReference)}
                </section>
              )
            )}
          </MessageCardFrame>
        </MessageTurn>
      );
    case "thinking":
      return <ThinkingRow summary={row.summary} content={row.content} />;
    case "tool":
      {
        const normalizedTitle = row.title.trim();
        const normalizedCommand = row.command?.trim() ?? "";
        const hideDuplicateCommandPrompt =
          normalizedCommand.length > 0 &&
          normalizedTitle.length > 0 &&
          normalizedTitle === normalizedCommand;
        const hasCommandBodyContent = Boolean(row.output ?? row.error);
        return (
          <article className="message-card message-assistant">
            <ToolCallCard
              title={row.title}
              expandedTitle={row.expandedTitle}
              subtitle={row.subtitle}
              status={row.status}
              defaultExpanded={row.defaultExpanded}
            >
              {row.command !== undefined && (!hideDuplicateCommandPrompt || hasCommandBodyContent) ? (
                <CommandOutput
                  command={row.command}
                  output={row.output ?? row.error ?? ""}
                  exitCode={row.status === "error" ? 1 : 0}
                  hidePrompt={hideDuplicateCommandPrompt}
                />
              ) : row.output ? (
                <pre className="tool-call-card-output">{row.output}</pre>
              ) : row.error ? (
                <pre className="tool-call-card-output">{row.error}</pre>
              ) : null}
            </ToolCallCard>
          </article>
        );
      }
    case "diff":
      return (
        <article className="message-card message-assistant">
          <DiffBlock
            path={row.path}
            type={row.type}
            diff={row.diff}
            insertions={row.insertions}
            deletions={row.deletions}
            onOpenPath={onOpenFileReference}
          />
        </article>
      );
    case "diff-group":
      return (
        <article className="message-card message-assistant">
          <ChangedFilesCluster title={row.title} files={row.files} onOpenFileReference={onOpenFileReference} />
        </article>
      );
    case "tool-group":
      {
        const toolGroupItems = [
          ...row.files.map((file) => (
            <DiffBlock
              key={file.id}
              path={file.path}
              type={file.type}
              diff={file.diff}
              insertions={file.insertions}
              deletions={file.deletions}
              onOpenPath={onOpenFileReference}
            />
          )),
          ...(row.tools ?? []).map((tool) => (
            <ToolCallCard
              key={tool.id}
              title={tool.title}
              expandedTitle={tool.expandedTitle}
              subtitle={tool.subtitle}
              status={tool.status}
              defaultExpanded={tool.defaultExpanded}
            >
              {tool.command !== undefined ? (
                <CommandOutput
                  command={tool.command}
                  output={tool.output ?? tool.error ?? ""}
                  exitCode={tool.status === "error" ? 1 : 0}
                />
              ) : tool.output ? (
                <pre className="tool-call-card-output">{tool.output}</pre>
              ) : tool.error ? (
                <pre className="tool-call-card-output">{tool.error}</pre>
              ) : null}
            </ToolCallCard>
          )),
        ];
        return (
          <article className="message-card message-assistant">
            <ToolGroup
              label={row.title}
              count={toolGroupItems.length}
              items={toolGroupItems}
            />
          </article>
        );
      }
    case "context":
      return (
        <article className="message-card message-assistant">
          <ContextToolGroup items={row.items} />
        </article>
      );
    case "explore":
      return <ExploreRow item={row.item} />;
    case "timeline":
      return (
        <section className="message-timeline">
          <MessageTimelineBlocks blocks={row.blocks} onOpenFileReference={onOpenFileReference} />
        </section>
      );
    case "notice":
      return (
        <article
          className={`message-card message-system${row.tone === "error" ? " message-system-error" : ""}`.trim()}
          data-message-row-id={`notice:${row.id}`}
        >
          <header className="message-header">
            <span className="message-role">System</span>
            {row.timestamp ? <span className="message-time">{new Date(row.timestamp).toLocaleTimeString()}</span> : null}
          </header>
          <div className="message-parts">
            <section className="message-timeline">
              <div className="message-timeline-row">
                <span className="message-timeline-row-label">{row.label}</span>
                {row.detail ? <small className="message-timeline-row-error">Reason: {row.detail}</small> : null}
              </div>
            </section>
          </div>
        </article>
      );
    case "status":
      return <div className="codex-status-line">{row.label}</div>;
    case "compaction":
      return (
        <div className="compaction-divider" role="separator" aria-label="context compacted">
          <span className="compaction-divider-line" />
          <span className="compaction-divider-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            context compacted
          </span>
          <span className="compaction-divider-line" />
        </div>
      );
    case "turn-divider": {
      const timeLabel = row.timestamp
        ? new Date(row.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : undefined;
      const durationLabel = row.durationSeconds !== undefined && row.durationSeconds > 0
        ? row.durationSeconds < 60
          ? `${row.durationSeconds}s`
          : `${Math.floor(row.durationSeconds / 60)}m ${row.durationSeconds % 60}s`
        : undefined;
      const badge = [timeLabel, durationLabel].filter(Boolean).join(" \u00B7 ");
      return (
        <div className="turn-divider" role="separator">
          {badge ? <span className="turn-divider-badge">{badge}</span> : null}
        </div>
      );
    }
    case "plan-card":
      return (
        <article className="message-card message-assistant">
          <PlanCardBubble content={row.content} onOpenFileReference={onOpenFileReference} />
        </article>
      );
    default:
      return null;
  }
}
