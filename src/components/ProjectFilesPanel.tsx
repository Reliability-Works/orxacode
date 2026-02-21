import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFileDocument, ProjectFileEntry } from "@shared/ipc";
import { Check, ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen, Plus } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/themes/prism-tomorrow.css";
import { IconButton } from "./IconButton";

type Props = {
  directory: string;
  onAddToChatPath: (path: string) => void;
  onStatus: (message: string) => void;
};

type TreeState = {
  [relativePath: string]: ProjectFileEntry[];
};

type LineSelection = {
  startLine: number;
  endLine: number;
  top: number;
  left: number;
};

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  if (index < 0 || index === name.length - 1) {
    return "file";
  }
  return name.slice(index + 1).toLowerCase();
}

function languageFromPath(relativePath: string) {
  const ext = extensionOf(relativePath);
  if (ext === "ts" || ext === "tsx") {
    return "typescript";
  }
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return "javascript";
  }
  if (ext === "json" || ext === "jsonc") {
    return "json";
  }
  if (ext === "md" || ext === "mdx") {
    return "markdown";
  }
  if (ext === "css" || ext === "scss") {
    return "css";
  }
  if (ext === "sh" || ext === "bash" || ext === "zsh") {
    return "bash";
  }
  if (ext === "sql") {
    return "sql";
  }
  return "none";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sortEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") {
      return -1;
    }
    if (a.type !== "directory" && b.type === "directory") {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function lineFromNode(node: Node | null): number | undefined {
  if (!node) {
    return undefined;
  }

  if (node instanceof Element) {
    const holder = node.closest<HTMLElement>("[data-line-number]");
    if (!holder) {
      return undefined;
    }
    const value = Number.parseInt(holder.dataset.lineNumber ?? "", 10);
    return Number.isFinite(value) ? value : undefined;
  }

  return lineFromNode(node.parentElement);
}

export function ProjectFilesPanel({ directory, onAddToChatPath, onStatus }: Props) {
  const [nodesByPath, setNodesByPath] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<ProjectFileDocument | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);

  const previewLanguage = useMemo(() => (preview ? languageFromPath(preview.relativePath) : "none"), [preview]);
  const previewHtmlLines = useMemo(() => {
    if (!preview) {
      return [];
    }

    const source = preview.content ?? "";
    if (preview.binary || previewLanguage === "none") {
      return escapeHtml(source).split("\n");
    }

    const grammar = Prism.languages[previewLanguage];
    if (!grammar) {
      return escapeHtml(source).split("\n");
    }

    return Prism.highlight(source, grammar, previewLanguage).split("\n");
  }, [preview, previewLanguage]);

  const rootNodes = useMemo(() => sortEntries(nodesByPath[""] ?? []), [nodesByPath]);

  const loadFolder = useCallback(
    async (relativePath = "") => {
      setLoading((current) => ({ ...current, [relativePath]: true }));
      try {
        const entries = await window.orxa.opencode.listFiles(directory, relativePath);
        setNodesByPath((current) => ({
          ...current,
          [relativePath]: sortEntries(entries),
        }));
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading((current) => ({ ...current, [relativePath]: false }));
      }
    },
    [directory, onStatus],
  );

  useEffect(() => {
    setNodesByPath({});
    setExpanded({});
    setPreview(null);
    setSelection(null);
    void loadFolder("");
  }, [directory, loadFolder]);

  const toggleDirectory = useCallback(
    (entry: ProjectFileEntry) => {
      setExpanded((current) => {
        const next = !current[entry.relativePath];
        if (next) {
          void loadFolder(entry.relativePath);
        }
        return {
          ...current,
          [entry.relativePath]: next,
        };
      });
    },
    [loadFolder],
  );

  const openFile = useCallback(
    async (entry: ProjectFileEntry) => {
      try {
        const doc = await window.orxa.opencode.readProjectFile(directory, entry.relativePath);
        setPreview(doc);
        setSelection(null);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [directory, onStatus],
  );

  const captureSelection = useCallback(() => {
    const root = previewScrollerRef.current;
    const activePreview = preview;
    if (!root || !activePreview) {
      return;
    }

    const browserSelection = window.getSelection();
    if (!browserSelection || browserSelection.rangeCount === 0 || browserSelection.isCollapsed) {
      setSelection(null);
      return;
    }

    const range = browserSelection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const start = lineFromNode(browserSelection.anchorNode);
    const end = lineFromNode(browserSelection.focusNode);
    if (!start || !end) {
      setSelection(null);
      return;
    }

    const bounds = range.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    const top = bounds.top - rootBounds.top + root.scrollTop - 40;
    const left = bounds.right - rootBounds.left + root.scrollLeft + 8;

    setSelection({
      startLine: Math.min(start, end),
      endLine: Math.max(start, end),
      top: Math.max(8, top),
      left: Math.max(8, left),
    });
  }, [preview]);

  const renderRows = useCallback(
    (entries: ProjectFileEntry[], depth: number) => {
      return entries.map((entry) => {
        const isDir = entry.type === "directory";
        const children = nodesByPath[entry.relativePath] ?? [];
        const isOpen = !!expanded[entry.relativePath];
        const isLoading = !!loading[entry.relativePath];
        return (
          <div key={entry.relativePath} className="file-tree-row-wrap">
            <button
              type="button"
              className={`file-tree-row file-tree-${entry.type}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              onClick={() => (isDir ? toggleDirectory(entry) : void openFile(entry))}
              title={entry.path}
            >
              <span className="file-tree-caret" aria-hidden="true">
                {isDir ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="file-tree-caret-dot" />}
              </span>
              <span className="file-tree-icon" aria-hidden="true">
                {isDir ? (isOpen ? <FolderOpen size={14} /> : <Folder size={14} />) : <FileCode2 size={14} />}
              </span>
              <span className="file-tree-label">{entry.name}</span>
            </button>
            {isDir && isOpen ? (
              <div className="file-tree-children">
                {isLoading ? <p className="file-tree-loading">Loading...</p> : null}
                {!isLoading ? renderRows(children, depth + 1) : null}
              </div>
            ) : null}
          </div>
        );
      });
    },
    [expanded, loading, nodesByPath, openFile, toggleDirectory],
  );

  return (
    <section className="ops-section ops-section-fill files-panel">
      <div className="files-panel-header">
        <h3>Files</h3>
        <IconButton icon="refresh" label="Refresh files" onClick={() => void loadFolder("")} />
      </div>
      <div className="file-tree-scroll">
        {rootNodes.length === 0 ? <p className="file-tree-loading">No files found.</p> : renderRows(rootNodes, 0)}
      </div>

      {preview ? (
        <div className="overlay file-preview-overlay" onMouseDown={() => setSelection(null)}>
          <div className="modal file-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header className="file-preview-header">
              <div>
                <strong>{preview.relativePath}</strong>
                {preview.truncated ? <small>Preview truncated</small> : null}
              </div>
              <div className="file-preview-actions">
                <button
                  type="button"
                  onClick={() => {
                    onAddToChatPath(preview.path);
                    onStatus(`Added path to composer: ${preview.path}`);
                  }}
                >
                  Add to chat
                </button>
                <button type="button" onClick={() => setPreview(null)}>
                  X
                </button>
              </div>
            </header>
            <div
              ref={previewScrollerRef}
              className={`file-preview-content language-${previewLanguage}`}
              onMouseUp={captureSelection}
              onScroll={() => setSelection(null)}
            >
              {preview.binary ? (
                <div className="file-preview-line" data-line-number={1}>
                  <span className="file-preview-line-number">1</span>
                  <span className="file-preview-line-code">{preview.content}</span>
                </div>
              ) : (
                previewHtmlLines.map((line, index) => (
                  <div key={`${preview.relativePath}-line-${index + 1}`} className="file-preview-line" data-line-number={index + 1}>
                    <span className="file-preview-line-number">{index + 1}</span>
                    <span
                      className="file-preview-line-code"
                      data-line-number={index + 1}
                      dangerouslySetInnerHTML={{ __html: line.length > 0 ? line : " " }}
                    />
                  </div>
                ))
              )}

              {selection ? (
                <div className="file-preview-selection-popover" style={{ top: `${selection.top}px`, left: `${selection.left}px` }}>
                  <small>
                    {selection.startLine === selection.endLine
                      ? `Line ${selection.startLine}`
                      : `Lines ${selection.startLine}-${selection.endLine}`}
                  </small>
                  <button
                    type="button"
                    onClick={() => {
                      const lineRef =
                        selection.startLine === selection.endLine
                          ? `${preview.path}:${selection.startLine}`
                          : `${preview.path}:${selection.startLine}-${selection.endLine}`;
                      onAddToChatPath(lineRef);
                      onStatus(`Added selection to composer: ${lineRef}`);
                      setSelection(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                  >
                    <Plus size={12} aria-hidden="true" />
                    Add selection
                  </button>
                  <button type="button" onClick={() => setSelection(null)} aria-label="Close selection actions">
                    <Check size={12} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
            <footer className="file-preview-footer">
              <FileText size={13} aria-hidden="true" />
              <span>Select text to add path and line range into chat.</span>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
