import type { DelegationEventBlock, TimelineBlock } from "../../lib/message-feed-timeline";
import { parseFileReference } from "../../lib/markdown";

function renderActivityLabel(label: string, onOpenFileReference?: (reference: string) => void) {
  const diffMatch = label.match(/^(.*?)(\+\d+)\s*\|\s*(-\d+)(.*)$/);
  const baseLabel = diffMatch ? `${diffMatch[1] ?? ""}${diffMatch[4] ?? ""}`.trimEnd() : label;
  const activityMatch = baseLabel.match(/^(Edited|Created|Deleted|Editing|Creating|Deleting|Reading|Read|Writing|Wrote|Moved|Copied)\s+(.+)$/);
  const rawTarget = activityMatch?.[2]?.trim();
  const parsedTarget = rawTarget ? parseFileReference(rawTarget) : null;

  const content = (
    <>
      {activityMatch ? `${activityMatch[1]} ` : ""}
      {parsedTarget ? (
        <span
          role={onOpenFileReference ? "button" : undefined}
          tabIndex={onOpenFileReference ? 0 : undefined}
          className={`message-file-link${onOpenFileReference ? " interactive" : ""}`}
          title={parsedTarget.raw}
          onClick={(event) => {
            if (!onOpenFileReference) {
              return;
            }
            event.stopPropagation();
            onOpenFileReference(parsedTarget.raw);
          }}
          onKeyDown={(event) => {
            if (!onOpenFileReference) {
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onOpenFileReference(parsedTarget.raw);
            }
          }}
        >
          <span className="message-file-link-name">{parsedTarget.path}</span>
          {parsedTarget.lineLabel ? <span className="message-file-link-line">{parsedTarget.lineLabel}</span> : null}
        </span>
      ) : (
        activityMatch?.[2] ?? baseLabel
      )}
      {diffMatch ? (
        <>
          {" "}
          <span className="message-diff-add">{diffMatch[2] ?? ""}</span>
          {" | "}
          <span className="message-diff-del">{diffMatch[3] ?? ""}</span>
        </>
      ) : null}
    </>
  );

  if (parsedTarget || diffMatch) {
    return content;
  }
  return label;
}

function EventDetails({
  command,
  output,
  failure,
  reason,
}: {
  command?: string;
  output?: string;
  failure?: string;
  reason?: string;
}) {
  return (
    <>
      {command ? <small className="message-timeline-row-command">Command: {command}</small> : null}
      {output ? <pre className="message-timeline-row-output">{output}</pre> : null}
      {failure ? <pre className="message-timeline-row-error-block">{failure}</pre> : null}
      {reason ? <small className="message-timeline-row-reason">{reason}</small> : null}
    </>
  );
}

export function MessageTimelineBlocks({
  blocks,
  onOpenFileReference,
}: {
  blocks: TimelineBlock[];
  onOpenFileReference?: (reference: string) => void;
}) {
  return (
    <>
      {blocks.map((block) =>
        block.type === "exploration" ? (
          <details key={block.id} className="message-exploration">
            <summary className="message-exploration-summary">{block.summary}</summary>
              <div className="message-exploration-entries">
              {block.entries.map((entry) => (
                <span key={entry.id} className="message-exploration-entry">
                  {renderActivityLabel(entry.label, onOpenFileReference)}
                </span>
              ))}
            </div>
          </details>
        ) : (
          block.entry.output || block.entry.failure ? (
            <details key={block.id} className="message-timeline-disclosure" open={Boolean(block.entry.failure)}>
              <summary className="message-timeline-disclosure-summary">
                <span className="message-timeline-row-label">{renderActivityLabel(block.entry.label, onOpenFileReference)}</span>
              </summary>
              <div className="message-timeline-disclosure-body">
                <EventDetails
                  command={block.entry.command}
                  output={block.entry.output}
                  failure={block.entry.failure}
                  reason={block.entry.reason}
                />
              </div>
            </details>
          ) : (
            <div key={block.id} className="message-timeline-row">
              <span className="message-timeline-row-label">{renderActivityLabel(block.entry.label, onOpenFileReference)}</span>
              <EventDetails command={block.entry.command} reason={block.entry.reason} />
            </div>
          )
        ),
      )}
    </>
  );
}

export function DelegationEventBlocks({ blocks }: { blocks: DelegationEventBlock[] }) {
  return (
    <>
      {blocks.map((block, blockIndex) =>
        block.type === "exploration" ? (
          <details key={`${block.id}:${blockIndex}`} className="message-exploration delegation-event-exploration">
            <summary className="message-exploration-summary">{block.summary}</summary>
            <div className="message-exploration-entries">
              {block.entries.map((entry, entryIndex) => (
                <span key={`${entry.id}:${entryIndex}`} className="message-exploration-entry">
                  {renderActivityLabel(entry.summary)}
                </span>
              ))}
            </div>
          </details>
        ) : (
          <div key={`${block.id}:${blockIndex}`} className="delegation-modal-event-row">
            <span className="delegation-modal-event-label">{renderActivityLabel(block.entry.summary)}</span>
            {block.entry.command ? <small className="delegation-modal-event-command">Command: {block.entry.command}</small> : null}
            {block.entry.failure ? <small className="delegation-modal-event-error">Error: {block.entry.failure}</small> : null}
            {block.entry.details && !block.entry.failure ? (
              <small className="delegation-event-details">{block.entry.details}</small>
            ) : null}
          </div>
        ),
      )}
    </>
  );
}
