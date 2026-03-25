import { type ReactNode, useState, useCallback } from "react";
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
    default:
      return null;
  }
}
