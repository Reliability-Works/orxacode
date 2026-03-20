import { memo } from "react";
import { DiffBlock } from "./DiffBlock";

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
  return (
    <section className="changed-files-cluster" aria-label={title}>
      <header className="changed-files-cluster-header">
        <span className="changed-files-cluster-title">{title}</span>
        <span className="changed-files-cluster-count">{files.length}</span>
      </header>
      <div className="changed-files-cluster-list">
        {files.map((file) => (
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
    </section>
  );
});
