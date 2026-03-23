import { memo, useMemo, useState } from "react";
import { DiffBlock } from "./DiffBlock";

const COLLAPSED_FILE_LIMIT = 5;

type ChangedFileEntry = {
  id: string;
  path: string;
  type: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
};

export const ChangedFilesCluster = memo(function ChangedFilesCluster({
  title,
  files,
  onOpenFileReference,
}: {
  title: string;
  files: ChangedFileEntry[];
  onOpenFileReference?: (reference: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleFiles = useMemo(
    () => (expanded ? files : files.slice(0, COLLAPSED_FILE_LIMIT)),
    [expanded, files],
  );
  const hiddenCount = Math.max(0, files.length - COLLAPSED_FILE_LIMIT);

  return (
    <section className="changed-files-cluster" aria-label={title}>
      <header className="changed-files-cluster-header">
        <span className="changed-files-cluster-title">{title}</span>
        <span className="changed-files-cluster-count">{files.length}</span>
      </header>
      <div className="changed-files-cluster-list">
        {visibleFiles.map((file) => (
          <DiffBlock
            key={file.id}
            path={file.path}
            type={file.type}
            diff={file.diff}
            insertions={file.insertions}
            deletions={file.deletions}
            onOpenPath={onOpenFileReference}
          />
        ))}
      </div>
      {files.length > COLLAPSED_FILE_LIMIT ? (
        <button
          type="button"
          className="changed-files-cluster-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "hide" : `show all${hiddenCount > 0 ? ` (${hiddenCount} more)` : ""}`}
        </button>
      ) : null}
    </section>
  );
});
