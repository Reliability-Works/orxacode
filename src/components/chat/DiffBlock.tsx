import { useState } from "react";

interface DiffBlockProps {
  path: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
  type?: string;
}

function renderDiffLines(diff: string) {
  return diff.split("\n").map((line, i) => {
    let cls = "diff-block-line";
    if (line.startsWith("+") && !line.startsWith("+++")) cls += " diff-line-add";
    else if (line.startsWith("-") && !line.startsWith("---")) cls += " diff-line-del";
    else if (line.startsWith("@@")) cls += " diff-line-hunk";
    return (
      <div key={i} className={cls}>
        {line}
      </div>
    );
  });
}

export function DiffBlock({ path, diff, insertions, deletions, type }: DiffBlockProps) {
  // Auto-collapse if diff is long (more than 30 lines)
  const lineCount = diff ? diff.split("\n").length : 0;
  const [expanded, setExpanded] = useState(lineCount <= 30);

  const hasContent = !!diff;

  return (
    <div className="diff-block">
      <button
        type="button"
        className="diff-block-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasContent}
      >
        <span className="diff-block-path">{path}</span>
        {type ? <span className="diff-block-type">{type}</span> : null}
        {insertions !== undefined ? <span className="diff-block-stat diff-block-stat--add">+{insertions}</span> : null}
        {deletions !== undefined ? <span className="diff-block-stat diff-block-stat--del">-{deletions}</span> : null}
        {hasContent ? (
          <span className="diff-block-chevron" aria-hidden="true">
            {expanded ? "▾" : "›"}
          </span>
        ) : null}
      </button>

      {expanded && diff ? (
        <div className="diff-block-body">
          <code className="diff-block-code">{renderDiffLines(diff)}</code>
        </div>
      ) : null}
    </div>
  );
}
