import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ProjectFileDocument, ProjectFileEntry } from "@shared/ipc";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Plus, Send, X } from "lucide-react";
import { getFileIcon } from "../lib/file-icons";
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

function FileEntryIcon({ name }: { name: string }) {
  const { icon, color } = getFileIcon(name);
  return <span style={{ color, display: "inline-flex", flexShrink: 0 }}>{icon}</span>;
}

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
  anchorTop: number;
  anchorBottom: number;
  clamped: boolean;
};

type EditablePreviewState = {
  content: string;
  savedContent: string;
  dirty: boolean;
  saving: boolean;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [projectFileCount, setProjectFileCount] = useState<number | null>(null);
  const [projectFileCountError, setProjectFileCountError] = useState(false);
  const [preview, setPreview] = useState<ProjectFileDocument | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editorState, setEditorState] = useState<EditablePreviewState | null>(null);
  const previewScrollerRef = useRef<HTMLDivElement | null>(null);
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const nodesByPathRef = useRef<TreeState>({});
  const folderRequestsRef = useRef<Record<string, Promise<ProjectFileEntry[]>>>({});

  useEffect(() => {
    nodesByPathRef.current = nodesByPath;
  }, [nodesByPath]);

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
  const searchTerm = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const searchActive = searchTerm.length > 0;

  const loadFolder = useCallback(
    async (relativePath = "") => {
      const activeRequest = folderRequestsRef.current[relativePath];
      if (activeRequest) {
        return activeRequest;
      }

      const request = (async () => {
        setLoading((current) => ({ ...current, [relativePath]: true }));
        try {
          const entries = await window.orxa.opencode.listFiles(directory, relativePath);
          const sortedEntries = sortEntries(entries);
          setNodesByPath((current) => ({
            ...current,
            [relativePath]: sortedEntries,
          }));
          return sortedEntries;
        } catch (error) {
          onStatus(error instanceof Error ? error.message : String(error));
          return [];
        } finally {
          setLoading((current) => ({ ...current, [relativePath]: false }));
          delete folderRequestsRef.current[relativePath];
        }
      })();

      folderRequestsRef.current[relativePath] = request;
      return request;
    },
    [directory, onStatus],
  );

  const loadAllFolders = useCallback(async () => {
    const pending = [""];
    const visited = new Set<string>();
    const discoveredDirectories = new Set<string>();

    while (pending.length > 0) {
      const currentPath = pending.shift();
      if (currentPath === undefined || visited.has(currentPath)) {
        continue;
      }
      visited.add(currentPath);

      const cachedEntries = nodesByPathRef.current[currentPath];
      const entries = cachedEntries ?? (await loadFolder(currentPath));
      for (const entry of entries) {
        if (entry.type !== "directory") {
          continue;
        }
        discoveredDirectories.add(entry.relativePath);
        if (entry.hasChildren !== false) {
          pending.push(entry.relativePath);
        }
      }
    }

    return discoveredDirectories;
  }, [loadFolder]);

  useEffect(() => {
    let cancelled = false;
    setProjectFileCount(null);
    setProjectFileCountError(false);
    void window.orxa.opencode.countProjectFiles(directory)
      .then((count) => {
        if (!cancelled) {
          setProjectFileCount(count);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onStatus(error instanceof Error ? error.message : String(error));
          setProjectFileCountError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [directory, onStatus]);

  useEffect(() => {
    setNodesByPath({});
    nodesByPathRef.current = {};
    folderRequestsRef.current = {};
    setExpanded({});
    setSearchQuery("");
    setSearchLoading(false);
    setPreview(null);
    setSelection(null);
    setIsEditing(false);
    setEditorState(null);
    void loadFolder("");
  }, [directory, loadFolder]);

  useEffect(() => {
    if (!preview) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        if (!isEditing) {
          setPreview(null);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditing, preview]);

  useEffect(() => {
    if (!searchActive) {
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setSearchLoading(true);
      await loadAllFolders();
      if (!cancelled) {
        setSearchLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [searchActive, loadAllFolders]);

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
        setIsEditing(false);
        setEditorState({
          content: doc.content ?? "",
          savedContent: doc.content ?? "",
          dirty: false,
          saving: false,
        });
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [directory, onStatus],
  );

  const expandAll = useCallback(async () => {
    const directories = await loadAllFolders();
    setExpanded(() => {
      const next: Record<string, boolean> = {};
      for (const path of directories) {
        next[path] = true;
      }
      return next;
    });
  }, [loadAllFolders]);

  const collapseAll = useCallback(() => {
    setExpanded({});
  }, []);

  const captureSelection = useCallback((event?: ReactMouseEvent<HTMLDivElement>) => {
    const target = event?.target;
    if (target instanceof Element && target.closest(".file-preview-selection-popover")) {
      return;
    }

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
    const anchorTop = bounds.top - rootBounds.top + root.scrollTop;
    const anchorBottom = bounds.bottom - rootBounds.top + root.scrollTop;
    const top = anchorTop - 40;
    const left = bounds.right - rootBounds.left + root.scrollLeft + 8;

    setSelection({
      startLine: Math.min(start, end),
      endLine: Math.max(start, end),
      top: Math.max(8, top),
      left: Math.max(8, left),
      anchorTop,
      anchorBottom,
      clamped: false,
    });
  }, [preview]);

  useEffect(() => {
    if (!preview || isEditing) {
      return;
    }

    let frameId: number | null = null;
    const scheduleSelectionCapture = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        captureSelection();
      });
    };

    document.addEventListener("selectionchange", scheduleSelectionCapture);
    return () => {
      document.removeEventListener("selectionchange", scheduleSelectionCapture);
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [captureSelection, isEditing, preview]);

  useLayoutEffect(() => {
    if (!selection || selection.clamped) {
      return;
    }

    const root = previewScrollerRef.current;
    const popover = selectionPopoverRef.current;
    if (!root || !popover) {
      return;
    }

    const minLeft = root.scrollLeft + 8;
    const minTop = root.scrollTop + 8;
    const maxLeft = root.scrollLeft + root.clientWidth - popover.offsetWidth - 8;
    const maxTop = root.scrollTop + root.clientHeight - popover.offsetHeight - 8;

    const preferredTop = selection.anchorTop - popover.offsetHeight - 8;
    const fallbackTop = selection.anchorBottom + 8;
    const preferredInView = preferredTop >= minTop;
    const targetTop = preferredInView ? preferredTop : fallbackTop;

    const clampedLeft = Math.min(Math.max(selection.left, minLeft), Math.max(minLeft, maxLeft));
    const clampedTop = Math.min(Math.max(targetTop, minTop), Math.max(minTop, maxTop));

    setSelection((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        left: clampedLeft,
        top: clampedTop,
        clamped: true,
      };
    });
  }, [selection]);

  const totalFileCount = useMemo(() => {
    const paths = new Set<string>();
    for (const entries of Object.values(nodesByPath)) {
      for (const entry of entries) {
        if (entry.type === "file") {
          paths.add(entry.relativePath);
        }
      }
    }
    return paths.size;
  }, [nodesByPath]);

  const effectiveTotalFileCount = projectFileCount ?? totalFileCount;
  const canEditPreview = Boolean(preview && !preview.binary && !preview.truncated);

  const savePreview = useCallback(async () => {
    if (!preview || !editorState || editorState.saving || !editorState.dirty) {
      return;
    }
    setEditorState((current) => current ? { ...current, saving: true } : current);
    try {
      await window.orxa.app.writeTextFile(preview.path, editorState.content);
      setPreview((current) => current ? { ...current, content: editorState.content, truncated: false, binary: false } : current);
      setEditorState({
        content: editorState.content,
        savedContent: editorState.content,
        dirty: false,
        saving: false,
      });
      onStatus(`Saved ${preview.relativePath}`);
    } catch (error) {
      setEditorState((current) => current ? { ...current, saving: false } : current);
      onStatus(error instanceof Error ? error.message : String(error));
    }
  }, [editorState, onStatus, preview]);

  const undoPreviewChanges = useCallback(() => {
    setEditorState((current) => current ? {
      ...current,
      content: current.savedContent,
      dirty: false,
    } : current);
    editorRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!preview || !isEditing) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (isSave) {
        event.preventDefault();
        void savePreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditing, preview, savePreview]);

  const filteredView = useMemo(() => {
    if (!searchActive) {
      return {
        nodes: nodesByPath,
        root: rootNodes,
        matchedFiles: effectiveTotalFileCount,
      };
    }

    const filteredNodes: TreeState = {};
    let matchedFiles = 0;

    const filterPath = (relativePath: string): ProjectFileEntry[] => {
      const entries = sortEntries(nodesByPath[relativePath] ?? []);
      const visibleEntries: ProjectFileEntry[] = [];

      for (const entry of entries) {
        if (entry.type === "file") {
          if (entry.name.toLowerCase().includes(searchTerm)) {
            visibleEntries.push(entry);
            matchedFiles += 1;
          }
          continue;
        }

        const childMatches = filterPath(entry.relativePath);
        const folderNameMatch = entry.name.toLowerCase().includes(searchTerm);
        if (folderNameMatch || childMatches.length > 0) {
          visibleEntries.push(entry);
          filteredNodes[entry.relativePath] = childMatches;
        }
      }

      return visibleEntries;
    };

    const filteredRoot = filterPath("");
    filteredNodes[""] = filteredRoot;

    return {
      nodes: filteredNodes,
      root: filteredRoot,
      matchedFiles,
    };
  }, [effectiveTotalFileCount, nodesByPath, rootNodes, searchActive, searchTerm]);

  const fileCountLabel = useMemo(() => {
    const format = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;
    if (!searchActive) {
      if (projectFileCountError) {
        return "File count unavailable";
      }
      return projectFileCount === null ? "Counting files..." : format(effectiveTotalFileCount);
    }
    if (projectFileCountError) {
      return `${filteredView.matchedFiles} matches`;
    }
    return projectFileCount === null
      ? `${filteredView.matchedFiles}/... files`
      : `${filteredView.matchedFiles}/${effectiveTotalFileCount} files`;
  }, [effectiveTotalFileCount, filteredView.matchedFiles, projectFileCount, projectFileCountError, searchActive]);

  const renderLabel = useCallback((value: string) => {
    if (!searchActive) {
      return value;
    }

    const index = value.toLowerCase().indexOf(searchTerm);
    if (index < 0) {
      return value;
    }

    const end = index + searchTerm.length;
    return (
      <>
        {value.slice(0, index)}
        <mark className="file-tree-label-match">{value.slice(index, end)}</mark>
        {value.slice(end)}
      </>
    );
  }, [searchActive, searchTerm]);

  const renderRows = useCallback(
    (entries: ProjectFileEntry[], depth: number, tree: TreeState) => {
      return entries.map((entry) => {
        const isDir = entry.type === "directory";
        const children = tree[entry.relativePath] ?? [];
        const isOpen = searchActive || !!expanded[entry.relativePath];
        const isLoading = !!loading[entry.relativePath];
        return (
          <div key={entry.relativePath} className="file-tree-row-wrap">
            <button
              type="button"
              className={`file-tree-row file-tree-${entry.type}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              onClick={() => {
                if (isDir) {
                  if (!searchActive) {
                    toggleDirectory(entry);
                  }
                  return;
                }
                void openFile(entry);
              }}
              title={entry.path}
            >
              <span className="file-tree-caret" aria-hidden="true">
                {isDir ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="file-tree-caret-dot" />}
              </span>
              <span className="file-tree-icon" aria-hidden="true">
                {isDir
                  ? (isOpen ? <FolderOpen size={14} /> : <Folder size={14} />)
                  : <FileEntryIcon name={entry.name} />}
              </span>
              <span className="file-tree-label">{renderLabel(entry.name)}</span>
            </button>
            {isDir && isOpen ? (
              <div className="file-tree-children">
                {isLoading ? <p className="file-tree-loading">Loading...</p> : null}
                {!isLoading ? renderRows(children, depth + 1, tree) : null}
              </div>
            ) : null}
          </div>
        );
      });
    },
    [expanded, loading, openFile, renderLabel, searchActive, toggleDirectory],
  );

  return (
    <section className="ops-section ops-section-fill files-panel">
      <div className="files-panel-header">
        <div className="files-panel-search-row">
          <input
            type="search"
            className="files-panel-search"
            placeholder="Search files"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search project files"
          />
        </div>
        <div className="files-panel-actions-row">
          <span className="files-panel-count">{fileCountLabel}</span>
          <div className="files-panel-actions">
            <button
              type="button"
              className="files-panel-icon-action"
              onClick={() => void expandAll()}
              title="Expand all"
              aria-label="Expand all folders"
            >
              <FolderOpen size={14} />
            </button>
            <button
              type="button"
              className="files-panel-icon-action"
              onClick={collapseAll}
              title="Collapse all"
              aria-label="Collapse all folders"
            >
              <Folder size={14} />
            </button>
          </div>
        </div>
      </div>
      <div className="file-tree-scroll">
        {searchActive && searchLoading ? <p className="file-tree-loading">Searching files...</p> : null}
        {filteredView.root.length === 0 ? (
          <p className="file-tree-loading">{searchActive ? "No matching files." : "No files found."}</p>
        ) : (
          renderRows(filteredView.root, 0, filteredView.nodes)
        )}
      </div>

      {preview ? (
        <div className="overlay file-preview-overlay" onMouseDown={() => setSelection(null)}>
          <div className="modal file-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header className="file-preview-header">
              <div className="file-preview-title-row">
                <strong title={preview.relativePath}>{preview.relativePath}</strong>
                <div className="file-preview-actions">
                  <button
                    type="button"
                    className="file-preview-icon-action"
                    onClick={() => {
                      onAddToChatPath(preview.path);
                      onStatus(`Added path to composer: ${preview.path}`);
                    }}
                    aria-label="Add file path to chat"
                  >
                    <Send size={14} aria-hidden="true" />
                  </button>
                  {canEditPreview ? (
                    <button
                      type="button"
                      className="file-preview-icon-action"
                      onClick={() => {
                        setIsEditing((current) => !current);
                        setSelection(null);
                      }}
                      aria-label={isEditing ? "Preview file" : "Edit file"}
                      title={isEditing ? "Preview file" : "Edit file"}
                    >
                      <FileText size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button type="button" className="file-preview-icon-action" onClick={() => setPreview(null)} aria-label="Close preview">
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {isEditing && editorState ? (
                <div className="file-preview-edit-actions">
                  <button
                    type="button"
                    className="file-preview-primary-action"
                    onClick={() => void savePreview()}
                    disabled={!editorState.dirty || editorState.saving}
                  >
                    {editorState.saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="file-preview-secondary-action"
                    onClick={undoPreviewChanges}
                    disabled={!editorState.dirty || editorState.saving}
                  >
                    Undo
                  </button>
                  <small className="file-preview-shortcut-hint">Cmd/Ctrl+S to save. Native undo/redo works while editing.</small>
                </div>
              ) : null}
              {preview.truncated ? <small>Preview truncated</small> : null}
            </header>
            <div
              ref={previewScrollerRef}
              className={`file-preview-content language-${previewLanguage}`}
              onMouseUp={captureSelection}
              onScroll={() => setSelection(null)}
            >
              {isEditing && editorState ? (
                <textarea
                  ref={editorRef}
                  className="file-preview-editor"
                  value={editorState.content}
                  onChange={(event) => {
                    const nextContent = event.target.value;
                    setEditorState((current) => current ? {
                      ...current,
                      content: nextContent,
                      dirty: nextContent !== current.savedContent,
                    } : current);
                  }}
                  spellCheck={false}
                />
              ) : preview.binary ? (
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

              {selection && !isEditing ? (
                <div
                  ref={selectionPopoverRef}
                  className="file-preview-selection-popover"
                  style={{ top: `${selection.top}px`, left: `${selection.left}px` }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                >
                  <small className="file-preview-selection-label">
                    {selection.startLine === selection.endLine
                      ? `Line ${selection.startLine}`
                      : `Lines ${selection.startLine}-${selection.endLine}`}
                  </small>
                  <div className="file-preview-selection-actions">
                    <button
                      type="button"
                      className="file-preview-selection-add"
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
                    <button type="button" className="file-preview-selection-close" onClick={() => setSelection(null)} aria-label="Close selection actions">
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <footer className="file-preview-footer">
              <FileText size={13} aria-hidden="true" />
              <span>{isEditing ? "Edit the file, then save or undo your changes." : "Select text to add path and line range into chat."}</span>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
