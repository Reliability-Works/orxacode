import { useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import type { WorkspaceContextFile } from "@shared/ipc";
import { timeAgo } from "~/lib/format";

type WorkspaceContextDraftInput = {
  id?: string;
  filename?: string;
  title?: string;
  content: string;
};

type Props = {
  open: boolean;
  files: WorkspaceContextFile[];
  onClose: () => void;
  onRefresh?: () => void;
  onCreate?: () => void;
  onSave: (input: WorkspaceContextDraftInput) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
};

function contextLabel(item: WorkspaceContextFile) {
  const title = item.title?.trim();
  if (title && title.length > 0) {
    return title;
  }
  const filename = item.filename?.trim();
  if (filename && filename.length > 0) {
    return filename;
  }
  return item.id;
}

export function WorkspaceContextManager({ open, files, onClose, onRefresh, onCreate, onSave, onDelete }: Props) {
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingID, setDeletingID] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const selected = useMemo(
    () => files.find((item) => item.id === selectedID) ?? null,
    [files, selectedID],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    if (selectedID && files.some((item) => item.id === selectedID)) {
      return;
    }
    const next = files[0] ?? null;
    setSelectedID(next?.id ?? null);
    setDraftTitle(next?.title ?? "");
    setDraftContent(next?.content ?? "");
  }, [files, open, selectedID]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    setDraftTitle(selected.title ?? "");
    setDraftContent(selected.content ?? "");
  }, [selected]);

  if (!open) {
    return null;
  }

  const runSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        id: selected?.id,
        filename: selected?.filename,
        title: draftTitle.trim(),
        content: draftContent,
      });
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  const runDelete = async () => {
    if (!selected || deletingID) {
      return;
    }
    setDeletingID(selected.id);
    setError(undefined);
    try {
      await onDelete(selected.id);
      setSelectedID(null);
      setDraftTitle("");
      setDraftContent("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setDeletingID(null);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <section
        className="modal workspace-context-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace Context"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>Workspace Context</h2>
            <small className="workspace-context-subtitle">Curate reusable context files for this workspace.</small>
          </div>
          <div className="workspace-context-header-actions">
            <button type="button" className="dashboard-icon-btn" onClick={onRefresh} disabled={!onRefresh} title="Refresh context">
              <RotateCcw size={14} />
            </button>
            <button type="button" className="dashboard-icon-btn" onClick={onClose} title="Close context manager">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="workspace-context-layout">
          <aside className="workspace-context-list-pane" aria-label="Workspace context files">
            <div className="workspace-context-list-header">
              <strong>{files.length} files</strong>
              <button type="button" onClick={onCreate}>
                <Plus size={14} />
                <span>Add</span>
              </button>
            </div>
            <div className="workspace-context-list">
              {files.map((item) => {
                const isActive = item.id === selectedID;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`workspace-context-item ${isActive ? "active" : ""}`.trim()}
                    onClick={() => {
                      setSelectedID(item.id);
                      setDraftTitle(item.title ?? "");
                      setDraftContent(item.content ?? "");
                    }}
                  >
                    <strong>{contextLabel(item)}</strong>
                    <small>{item.filename}</small>
                    <small>Updated {timeAgo(item.updatedAt)}</small>
                  </button>
                );
              })}
              {files.length === 0 ? <p className="dashboard-empty">No workspace context files yet.</p> : null}
            </div>
          </aside>

          <section className="workspace-context-editor-pane" aria-label="Workspace context editor">
            <label>
              <span>Title</span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="Architecture decisions"
              />
            </label>
            <label>
              <span>Content</span>
              <textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="Capture stable context that should be reused in sessions."
              />
            </label>
            <div className="workspace-context-editor-actions">
              <button
                type="button"
                className="workspace-context-save-btn"
                onClick={() => void runSave()}
                disabled={saving || draftContent.trim().length === 0}
              >
                <Save size={14} />
                <span>{saving ? "Saving..." : "Save context"}</span>
              </button>
              {selected ? (
                <button
                  type="button"
                  className="workspace-context-delete-btn"
                  onClick={() => void runDelete()}
                  disabled={Boolean(deletingID)}
                >
                  <Trash2 size={14} />
                  <span>{deletingID ? "Deleting..." : "Delete"}</span>
                </button>
              ) : null}
            </div>
            {error ? <p className="dashboard-error">{error}</p> : null}
          </section>
        </div>
      </section>
    </div>
  );
}
