import { memo, useMemo, useState } from "react";
import { parseFileReference } from "../../lib/markdown";

interface DiffBlockProps {
  path?: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
  type?: string;
  onOpenPath?: (path: string) => void;
}

function parseHunkStart(line: string) {
  const match = line.match(/^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/);
  if (!match) {
    return null;
  }
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[3]),
  };
}

function isMetadataLine(line: string) {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("*** Begin Patch") ||
    line.startsWith("*** End Patch") ||
    line.startsWith("*** Update File:") ||
    line.startsWith("*** Add File:") ||
    line.startsWith("*** Delete File:")
  );
}

function renderDiffLines(diff: string) {
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  return diff
    .split("\n")
    .flatMap((line, index) => {
      if (isMetadataLine(line)) {
        return [];
      }

      const hunkStart = parseHunkStart(line);
      if (hunkStart) {
        oldLineNumber = hunkStart.oldLine;
        newLineNumber = hunkStart.newLine;
        return [];
      }

      let className = "diff-block-line";
      let oldLabel = "";
      let newLabel = "";

      if (line.startsWith("+") && !line.startsWith("+++")) {
        className += " diff-line-add";
        newLabel = newLineNumber === null ? "" : String(newLineNumber);
        if (newLineNumber !== null) {
          newLineNumber += 1;
        }
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        className += " diff-line-del";
        oldLabel = oldLineNumber === null ? "" : String(oldLineNumber);
        if (oldLineNumber !== null) {
          oldLineNumber += 1;
        }
      } else if (line.length > 0) {
        oldLabel = oldLineNumber === null ? "" : String(oldLineNumber);
        newLabel = newLineNumber === null ? "" : String(newLineNumber);
        if (oldLineNumber !== null) {
          oldLineNumber += 1;
        }
        if (newLineNumber !== null) {
          newLineNumber += 1;
        }
      }

      return (
        <div key={`${index}:${oldLabel}:${newLabel}:${line}`} className={className}>
          <span className="diff-block-line-number diff-block-line-number--old" aria-hidden="true">{oldLabel}</span>
          <span className="diff-block-line-number diff-block-line-number--new" aria-hidden="true">{newLabel}</span>
          <span className="diff-block-line-content">{line}</span>
        </div>
      );
    });
}

function deriveDiffStats(diff: string | undefined, insertions?: number, deletions?: number) {
  if (insertions !== undefined || deletions !== undefined) {
    return { insertions, deletions };
  }
  if (!diff) {
    return { insertions: undefined, deletions: undefined };
  }
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@ ") || line.startsWith("diff --git ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  return {
    insertions: added > 0 ? added : undefined,
    deletions: removed > 0 ? removed : undefined,
  };
}

function diffVerb(type: string | undefined) {
  switch ((type ?? "").toLowerCase()) {
    case "added":
      return "Created";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    default:
      return "Edited";
  }
}

export const DiffBlock = memo(function DiffBlock({ path, diff, insertions, deletions, type, onOpenPath }: DiffBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const safePath = path?.trim() ? path : "(unknown file)";
  const parsedPath = useMemo(() => parseFileReference(safePath), [safePath]);
  const normalizedPath = useMemo(() => safePath.replace(/\\/g, "/"), [safePath]);
  const displayName = useMemo(
    () => parsedPath
      ? (parsedPath.path.startsWith("/") ? parsedPath.basename : parsedPath.path)
      : normalizedPath,
    [normalizedPath, parsedPath],
  );

  const hasContent = !!diff;
  const verb = diffVerb(type);
  const stats = useMemo(() => deriveDiffStats(diff, insertions, deletions), [deletions, diff, insertions]);
  const renderedDiffLines = useMemo(() => (diff ? renderDiffLines(diff) : null), [diff]);

  return (
    <div className={`diff-block${expanded && hasContent ? " diff-block--expanded" : ""}${hasContent ? " diff-block--collapsible" : ""}`}>
      <button
        type="button"
        className="diff-block-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasContent}
      >
        <span className="diff-block-verb">{verb}</span>
        {onOpenPath ? (
          <span
            role="button"
            tabIndex={0}
            className="diff-block-path message-file-link"
            title={safePath}
            onClick={(event) => {
              event.stopPropagation();
              onOpenPath(safePath);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onOpenPath(safePath);
              }
            }}
          >
            <span className="message-file-link-name">{displayName}</span>
          </span>
        ) : (
          <span className="diff-block-path">{displayName}</span>
        )}
        {stats.insertions !== undefined ? <span className="diff-block-stat diff-block-stat--add">+{stats.insertions}</span> : null}
        {stats.deletions !== undefined ? <span className="diff-block-stat diff-block-stat--del">-{stats.deletions}</span> : null}
        {hasContent ? (
          <span className="diff-block-chevron" aria-hidden="true">
            {expanded ? "▾" : "›"}
          </span>
        ) : null}
      </button>

      {expanded && diff ? (
        <div className="diff-block-body">
          <div className="diff-block-topbar">
            {onOpenPath ? (
              <span
                role="button"
                tabIndex={0}
                className="diff-block-topbar-path message-file-link"
                title={safePath}
                onClick={() => onOpenPath(safePath)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenPath(safePath);
                  }
                }}
              >
                <span className="message-file-link-name">{displayName}</span>
              </span>
            ) : (
              <span className="diff-block-topbar-path">{displayName}</span>
            )}
            {stats.insertions !== undefined ? <span className="diff-block-stat diff-block-stat--add">+{stats.insertions}</span> : null}
            {stats.deletions !== undefined ? <span className="diff-block-stat diff-block-stat--del">-{stats.deletions}</span> : null}
          </div>
          <code className="diff-block-code">{renderedDiffLines}</code>
        </div>
      ) : null}
    </div>
  );
});
