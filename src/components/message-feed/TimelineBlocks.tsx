import type { DelegationEventBlock, TimelineBlock } from "../../lib/message-feed-timeline";

function renderLabelWithDiff(label: string) {
  const match = label.match(/^(.*?)(\+\d+)\s*\|\s*(-\d+)(.*)$/);
  if (!match) {
    return label;
  }
  const prefix = match[1] ?? "";
  const additions = match[2] ?? "";
  const deletions = match[3] ?? "";
  const suffix = match[4] ?? "";
  return (
    <>
      {prefix}
      <span className="message-diff-add">{additions}</span>
      {" | "}
      <span className="message-diff-del">{deletions}</span>
      {suffix}
    </>
  );
}

export function MessageTimelineBlocks({ blocks }: { blocks: TimelineBlock[] }) {
  return (
    <>
      {blocks.map((block) =>
        block.type === "exploration" ? (
          <details key={block.id} className="message-exploration">
            <summary className="message-exploration-summary">{block.summary}</summary>
            <div className="message-exploration-entries">
              {block.entries.map((entry) => (
                <span key={entry.id} className="message-exploration-entry">
                  {renderLabelWithDiff(entry.label)}
                </span>
              ))}
            </div>
          </details>
        ) : (
          <div key={block.id} className="message-timeline-row">
            <span className="message-timeline-row-label">{renderLabelWithDiff(block.entry.label)}</span>
            {block.entry.command ? <small className="message-timeline-row-command">Command: {block.entry.command}</small> : null}
            {block.entry.failure ? <small className="message-timeline-row-error">Error: {block.entry.failure}</small> : null}
            {block.entry.reason ? <small className="message-timeline-row-reason">{block.entry.reason}</small> : null}
          </div>
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
                  {renderLabelWithDiff(entry.summary)}
                </span>
              ))}
            </div>
          </details>
        ) : (
          <div key={`${block.id}:${blockIndex}`} className="delegation-modal-event-row">
            <span className="delegation-modal-event-label">{renderLabelWithDiff(block.entry.summary)}</span>
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
