import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { getFileIcon } from "../../lib/file-icons";
import type { ProjectFileEntry } from "@shared/ipc";
import { CanvasTileComponent } from "../CanvasTile";
import { tilePathBasename, type CanvasTileComponentProps } from "./tile-shared";

type FileEditorTileProps = CanvasTileComponentProps;

const PLACEHOLDER = "// Select a file from the tree to begin editing.";

function FileEntryIcon({ name }: { name: string }) {
  const { icon, color } = getFileIcon(name);
  return <span style={{ color, display: "inline-flex", flexShrink: 0 }}>{icon}</span>;
}

function sortEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });
}

type TreeState = Record<string, ProjectFileEntry[]>;

export function FileEditorTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: FileEditorTileProps) {
  const directory =
    typeof tile.meta.directory === "string" ? tile.meta.directory : "";
  const filePath =
    typeof tile.meta.filePath === "string" ? tile.meta.filePath : "";

  const [content, setContent] = useState<string>("");
  const [lineCount, setLineCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const prevFilePathRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  // File tree state
  const [nodesByPath, setNodesByPath] = useState<TreeState>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [treeLoading, setTreeLoading] = useState<Record<string, boolean>>({});
  const folderRequestsRef = useRef<Record<string, Promise<ProjectFileEntry[]>>>({});

  const hasIpc = useMemo(() => {
    return !!(window as Window & typeof globalThis & { orxa?: { opencode?: { listFiles?: unknown } } }).orxa?.opencode?.listFiles;
  }, []);

  // Load a folder's contents from IPC
  const loadFolder = useCallback(
    async (relativePath = "") => {
      if (!hasIpc || !directory) return [];

      const existing = folderRequestsRef.current[relativePath];
      if (existing) return existing;

      const request = (async () => {
        setTreeLoading((c) => ({ ...c, [relativePath]: true }));
        try {
          const entries = await window.orxa.opencode.listFiles(directory, relativePath);
          const sorted = sortEntries(entries);
          setNodesByPath((c) => ({ ...c, [relativePath]: sorted }));
          return sorted;
        } catch {
          return [];
        } finally {
          setTreeLoading((c) => ({ ...c, [relativePath]: false }));
          delete folderRequestsRef.current[relativePath];
        }
      })();

      folderRequestsRef.current[relativePath] = request;
      return request;
    },
    [directory, hasIpc],
  );

  // Load root folder on mount / directory change
  useEffect(() => {
    if (!directory || !hasIpc) return;
    setNodesByPath({});
    setExpanded({});
    folderRequestsRef.current = {};
    void loadFolder("");
  }, [directory, hasIpc, loadFolder]);

  const toggleDirectory = useCallback(
    (entry: ProjectFileEntry) => {
      setExpanded((c) => {
        const next = !c[entry.relativePath];
        if (next) void loadFolder(entry.relativePath);
        return { ...c, [entry.relativePath]: next };
      });
    },
    [loadFolder],
  );

  const selectFile = useCallback(
    (entry: ProjectFileEntry) => {
      const newPath = entry.path;
      onUpdate(tile.id, { meta: { ...tile.meta, filePath: newPath } });
    },
    [tile.id, tile.meta, onUpdate],
  );

  // Load file content via IPC when filePath changes
  useEffect(() => {
    if (!filePath || filePath === prevFilePathRef.current) return;
    prevFilePathRef.current = filePath;

    const orxa = (window as Window & typeof globalThis & { orxa?: { opencode?: { readProjectFile?: (dir: string, rel: string) => Promise<{ content: string; binary?: boolean; truncated?: boolean }> } } }).orxa;
    if (!orxa?.opencode?.readProjectFile || !directory) {
      // Fallback to fs.read if available
      const fsOrxa = (window as Window & typeof globalThis & { orxa?: { fs?: { read?: (path: string) => Promise<string> } } }).orxa;
      if (!fsOrxa?.fs?.read) {
        setContent(PLACEHOLDER);
        setLineCount(PLACEHOLDER.split("\n").length);
        return;
      }
      setLoading(true);
      setLoadError(null);
      fsOrxa.fs.read(filePath)
        .then((text: string) => {
          setContent(text);
          setLineCount(text.split("\n").length);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setLoadError(`Failed to load: ${message}`);
          setContent("");
          setLineCount(1);
        })
        .finally(() => setLoading(false));
      return;
    }

    // Compute relative path from directory
    const relative = filePath.startsWith(directory)
      ? filePath.slice(directory.length).replace(/^\//, "")
      : filePath;

    setLoading(true);
    setLoadError(null);

    orxa.opencode.readProjectFile(directory, relative)
      .then((doc) => {
        setContent(doc.content ?? "");
        setLineCount((doc.content ?? "").split("\n").length);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setLoadError(`Failed to load: ${message}`);
        setContent("");
        setLineCount(1);
      })
      .finally(() => setLoading(false));
  }, [filePath, directory]);

  // Initialise placeholder when no filePath is set
  useEffect(() => {
    if (!filePath && content === "") {
      setContent(PLACEHOLDER);
      setLineCount(PLACEHOLDER.split("\n").length);
    }
  }, [filePath, content]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setContent(value);
      setLineCount(value.split("\n").length);
      onUpdate(tile.id, { meta: { ...tile.meta, content: value } });
    },
    [tile.id, tile.meta, onUpdate],
  );

  const handleScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const fileName = tilePathBasename(filePath, "untitled");
  const metaLabel = filePath ? fileName : "untitled";

  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const rootEntries = useMemo(() => sortEntries(nodesByPath[""] ?? []), [nodesByPath]);

  const renderTreeRows = useCallback(
    (entries: ProjectFileEntry[], depth: number): React.ReactNode => {
      return entries.map((entry) => {
        const isDir = entry.type === "directory";
        const isOpen = !!expanded[entry.relativePath];
        const children = nodesByPath[entry.relativePath] ?? [];
        const isTreeLoading = !!treeLoading[entry.relativePath];
        const isActive = entry.path === filePath;

        return (
          <div key={entry.relativePath} className="file-editor-tree-row-wrap">
            <button
              type="button"
              className={`file-editor-tree-row${isActive ? " active" : ""}`}
              style={{ paddingLeft: `${6 + depth * 12}px` }}
              onClick={() => {
                if (isDir) {
                  toggleDirectory(entry);
                } else {
                  selectFile(entry);
                }
              }}
              title={entry.path}
            >
              <span className="file-editor-tree-caret" aria-hidden="true">
                {isDir ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <span style={{ width: 11, display: "inline-block" }} />}
              </span>
              <span className="file-editor-tree-icon" aria-hidden="true">
                {isDir ? (isOpen ? <FolderOpen size={12} /> : <Folder size={12} />) : <FileEntryIcon name={entry.name} />}
              </span>
              <span className="file-editor-tree-label">{entry.name}</span>
            </button>
            {isDir && isOpen && (
              <div className="file-editor-tree-children">
                {isTreeLoading ? (
                  <div className="file-editor-tree-loading" style={{ paddingLeft: `${6 + (depth + 1) * 12}px` }}>Loading...</div>
                ) : (
                  renderTreeRows(children, depth + 1)
                )}
              </div>
            )}
          </div>
        );
      });
    },
    [expanded, filePath, nodesByPath, selectFile, toggleDirectory, treeLoading],
  );

  const showTree = directory && hasIpc;

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<FileText size={12} />}
      label="file editor"
      iconColor="#F59E0B"
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="file-editor-tile-body">
        {showTree && (
          <div className="file-editor-tile-tree" data-testid="file-editor-tree">
            <div className="file-editor-tile-tree-scroll">
              {rootEntries.length === 0 && !treeLoading[""] ? (
                <div className="file-editor-tree-loading">No files found.</div>
              ) : null}
              {treeLoading[""] ? (
                <div className="file-editor-tree-loading">Loading...</div>
              ) : (
                renderTreeRows(rootEntries, 0)
              )}
            </div>
          </div>
        )}
        <div className="file-editor-tile-editor-area">
          {loading && (
            <div className="file-editor-tile-loading">Loading...</div>
          )}
          {loadError && (
            <div className="file-editor-tile-error">{loadError}</div>
          )}
          {!loading && !loadError && (
            <div className="file-editor-tile-editor">
              <div
                className="file-editor-tile-gutter"
                ref={gutterRef}
                aria-hidden="true"
              >
                {lineNumbers.map((n) => (
                  <span key={n} className="file-editor-tile-line-num">
                    {n}
                  </span>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                className="file-editor-tile-textarea"
                value={content}
                onChange={handleChange}
                onScroll={handleScroll}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={`File editor: ${metaLabel}`}
              />
            </div>
          )}
        </div>
      </div>
    </CanvasTileComponent>
  );
}
