import type { ChangeProvenanceRecord, GitBranchState } from "@shared/ipc";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import {
  AlignJustify,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Columns2,
  Eye,
  FileText,
  Folder,
  List,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import type { GitDiffViewMode } from "../hooks/useGitPanel";

export type BranchState = GitBranchState;

type SidebarPanelTab = "git" | "files" | "browser";
type GitPanelTab = "diff" | "log" | "issues" | "prs";
type GitDiffSection = "unstaged" | "staged";
type GitFileStatus = "modified" | "added" | "deleted" | "renamed";

export type BrowserControlOwner = "agent" | "human";

export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
};

export type BrowserHistoryEntry = {
  id: string;
  label: string;
  url: string;
};

export type BrowserSidebarState = {
  modeEnabled: boolean;
  controlOwner: BrowserControlOwner;
  tabs: BrowserTabState[];
  activeTabID: string | null;
  activeUrl: string;
  history: BrowserHistoryEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  actionRunning: boolean;
  canStop?: boolean;
};

type ParsedDiffChunk = {
  section: GitDiffSection;
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  added: number;
  removed: number;
  lines: string[];
};

type GitDiffFile = {
  key: string;
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  added: number;
  removed: number;
  hasUnstaged: boolean;
  hasStaged: boolean;
  diffLines: string[];
  unstagedDiffLines?: string[];
  stagedDiffLines?: string[];
};

type GitDiffViewSection = {
  key: string;
  label: string;
  data: {
    oldFile: { fileName: string; content?: string };
    newFile: { fileName: string; content?: string };
    hunks: string[];
  };
};

type ParsedHunkLine = {
  id: string;
  type: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

type ParsedHunk = {
  key: string;
  header: string;
  lines: ParsedHunkLine[];
};

function mergeDiffLines(existing: string[] | undefined, next: string[]) {
  if (!existing || existing.length === 0) {
    return [...next];
  }
  if (next.length === 0) {
    return [...existing];
  }
  if (existing[existing.length - 1] === "" || next[0] === "") {
    return [...existing, ...next];
  }
  return [...existing, "", ...next];
}

function normalizeDiffPath(rawPath: string | undefined, fallback: string) {
  if (!rawPath) {
    return fallback;
  }
  const value = rawPath.trim().split(/\s+/)[0] ?? fallback;
  if (value === "/dev/null") {
    return fallback;
  }
  return value.replace(/^[ab]\//, "");
}

function buildDiffViewData(file: GitDiffFile, hunks: string[]) {
  const oldHeader = hunks.find((line) => line.startsWith("--- "));
  const newHeader = hunks.find((line) => line.startsWith("+++ "));
  const oldFileName = normalizeDiffPath(oldHeader?.slice(4), file.oldPath ?? file.path);
  const newFileName = normalizeDiffPath(newHeader?.slice(4), file.path);

  return {
    oldFile: { fileName: oldFileName },
    newFile: { fileName: newFileName },
    hunks,
  };
}

function statusPriority(status: GitFileStatus) {
  if (status === "renamed") {
    return 4;
  }
  if (status === "deleted") {
    return 3;
  }
  if (status === "added") {
    return 2;
  }
  return 1;
}

function inferStatusTag(status: GitFileStatus) {
  if (status === "added") {
    return "A";
  }
  if (status === "deleted") {
    return "D";
  }
  if (status === "renamed") {
    return "R";
  }
  return "M";
}

type FileTreeNode = {
  name: string;
  fullPath: string;
  type: "file" | "folder";
  children: FileTreeNode[];
  file?: GitDiffFile;
};

function buildFileTree(files: GitDiffFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let siblings = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isFile = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let node = siblings.find((n) => n.name === name && n.type === (isFile ? "file" : "folder"));
      if (!node) {
        node = { name, fullPath, type: isFile ? "file" : "folder", children: [], file: isFile ? file : undefined };
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(root);
  return root;
}

function filterTreeNodes(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query.trim()) {
    return nodes;
  }
  const lower = query.toLowerCase();
  const result: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (node.name.toLowerCase().includes(lower) || node.fullPath.toLowerCase().includes(lower)) {
        result.push(node);
      }
    } else {
      const filtered = filterTreeNodes(node.children, query);
      if (filtered.length > 0) {
        result.push({ ...node, children: filtered });
      }
    }
  }
  return result;
}

function parseGitDiffOutput(output: string): { files: GitDiffFile[]; message?: string } {
  if (!output.trim()) {
    return { files: [], message: "No local changes." };
  }
  if (output.startsWith("Loading diff")) {
    return { files: [], message: "Loading diff..." };
  }
  if (output === "No local changes." || output === "Not a git repository.") {
    return { files: [], message: output };
  }

  const lines = output.split(/\r?\n/);
  const chunks: ParsedDiffChunk[] = [];
  let section: GitDiffSection = "unstaged";
  let current: ParsedDiffChunk | null = null;

  const flushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line === "## Unstaged") {
      flushCurrent();
      section = "unstaged";
      continue;
    }
    if (line === "## Staged") {
      flushCurrent();
      section = "staged";
      continue;
    }
    if (line === "## Untracked") {
      flushCurrent();
      section = "unstaged";
      continue;
    }

    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      flushCurrent();
      current = {
        section,
        path: diffMatch[2] ?? diffMatch[1] ?? "",
        oldPath: undefined,
        status: "modified",
        added: 0,
        removed: 0,
        lines: [line],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(line);

    if (line.startsWith("new file mode ")) {
      current.status = "added";
    } else if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
    } else if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.replace("rename from ", "").trim();
    } else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.replace("rename to ", "").trim();
    } else if (line.startsWith("--- /dev/null")) {
      current.status = "added";
    } else if (line.startsWith("+++ /dev/null")) {
      current.status = "deleted";
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
    }
  }
  flushCurrent();

  if (chunks.length === 0) {
    return { files: [], message: output.trim() };
  }

  const grouped = new Map<string, GitDiffFile>();
  for (const chunk of chunks) {
    const key = chunk.oldPath ? `${chunk.oldPath}->${chunk.path}` : chunk.path;
    const existing = grouped.get(key);
    const chunkLines = [...chunk.lines];
    const nextDiffLines = mergeDiffLines(existing?.diffLines, chunkLines);

    if (!existing) {
      grouped.set(key, {
        key,
        path: chunk.path,
        oldPath: chunk.oldPath,
        status: chunk.status,
        added: chunk.added,
        removed: chunk.removed,
        hasUnstaged: chunk.section === "unstaged",
        hasStaged: chunk.section === "staged",
        diffLines: nextDiffLines,
        unstagedDiffLines: chunk.section === "unstaged" ? [...chunkLines] : undefined,
        stagedDiffLines: chunk.section === "staged" ? [...chunkLines] : undefined,
      });
      continue;
    }

    existing.added += chunk.added;
    existing.removed += chunk.removed;
    existing.hasUnstaged = existing.hasUnstaged || chunk.section === "unstaged";
    existing.hasStaged = existing.hasStaged || chunk.section === "staged";
    existing.diffLines = nextDiffLines;
    if (chunk.section === "unstaged") {
      existing.unstagedDiffLines = mergeDiffLines(existing.unstagedDiffLines, chunkLines);
    }
    if (chunk.section === "staged") {
      existing.stagedDiffLines = mergeDiffLines(existing.stagedDiffLines, chunkLines);
    }

    if (statusPriority(chunk.status) > statusPriority(existing.status)) {
      existing.status = chunk.status;
    }
    if (!existing.oldPath && chunk.oldPath) {
      existing.oldPath = chunk.oldPath;
    }
    existing.path = chunk.path;
  }

  const files = Array.from(grouped.values()).sort((left, right) => left.path.localeCompare(right.path));
  return { files };
}

function toDiffSections(file: GitDiffFile | null): GitDiffViewSection[] {
  if (!file) {
    return [];
  }
  const sections: GitDiffViewSection[] = [];
  if (file.unstagedDiffLines && file.unstagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:unstaged`,
      label: "Unstaged",
      data: buildDiffViewData(file, file.unstagedDiffLines),
    });
  }
  if (file.stagedDiffLines && file.stagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:staged`,
      label: "Staged",
      data: buildDiffViewData(file, file.stagedDiffLines),
    });
  }
  if (sections.length === 0 && file.diffLines.length > 0) {
    sections.push({
      key: `${file.key}:diff`,
      label: "Changes",
      data: buildDiffViewData(file, file.diffLines),
    });
  }
  return sections;
}

function parseHunkHeader(line: string) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) {
    return { oldStart: 0, newStart: 0 };
  }
  return {
    oldStart: Number(match[1] ?? "0"),
    newStart: Number(match[3] ?? "0"),
  };
}

function parseDiffHunks(section: GitDiffViewSection): ParsedHunk[] {
  const lines = section.data.hunks;
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      flush();
      const start = parseHunkHeader(line);
      oldLine = start.oldStart;
      newLine = start.newStart;
      current = {
        key: `${section.key}:${hunks.length}`,
        header: line,
        lines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push({
        id: `${current.key}:n${newLine}`,
        type: "add",
        text: line.slice(1),
        oldLine: null,
        newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.lines.push({
        id: `${current.key}:o${oldLine}`,
        type: "remove",
        text: line.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      current.lines.push({
        id: `${current.key}:c${oldLine}:${newLine}`,
        type: "context",
        text: line.slice(1),
        oldLine,
        newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  flush();
  return hunks;
}

function lineNumber(value: number | null) {
  if (value === null) {
    return "";
  }
  return String(value);
}

export type GitSidebarProps = {
  sidebarPanelTab: SidebarPanelTab;
  setSidebarPanelTab: (tab: SidebarPanelTab) => void;
  gitPanelTab: GitPanelTab;
  setGitPanelTab: (tab: GitPanelTab) => void;
  gitPanelOutput: string;
  branchState: BranchState | null;
  branchQuery: string;
  setBranchQuery: (query: string) => void;
  activeProjectDir: string | null | undefined;
  onLoadGitDiff: () => Promise<void>;
  onLoadGitLog: () => Promise<void>;
  onLoadGitIssues: () => Promise<void>;
  onLoadGitPrs: () => Promise<void>;
  gitDiffViewMode: GitDiffViewMode;
  setGitDiffViewMode: (mode: GitDiffViewMode) => void;
  onStageAllChanges?: () => Promise<void>;
  onDiscardAllChanges?: () => Promise<void>;
  onStageFile?: (filePath: string) => Promise<void>;
  onRestoreFile?: (filePath: string) => Promise<void>;
  onUnstageFile?: (filePath: string) => Promise<void>;
  fileProvenanceByPath?: Record<string, ChangeProvenanceRecord>;
  onAddToChatPath: (filePath: string) => void;
  onStatusChange: (message: string) => void;
  onCollapse?: () => void;
  browserState: BrowserSidebarState;
  onBrowserOpenTab?: () => Promise<void> | void;
  onBrowserCloseTab?: (tabID: string) => Promise<void> | void;
  onBrowserNavigate: (url: string) => Promise<void> | void;
  onBrowserGoBack: () => Promise<void> | void;
  onBrowserGoForward: () => Promise<void> | void;
  onBrowserReload: () => Promise<void> | void;
  onBrowserSelectTab: (tabID: string) => Promise<void> | void;
  onBrowserSelectHistory: (url: string) => Promise<void> | void;
  onBrowserReportViewportBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void> | void;
  onBrowserTakeControl: () => Promise<void> | void;
  onBrowserHandBack: () => Promise<void> | void;
  onBrowserStop: () => Promise<void> | void;
};

export function GitSidebar(props: GitSidebarProps) {
  const {
    sidebarPanelTab,
    setSidebarPanelTab,
    gitPanelTab,
    setGitPanelTab,
    gitPanelOutput,
    activeProjectDir,
    onLoadGitDiff,
    onLoadGitLog,
    onLoadGitIssues,
    onLoadGitPrs,
    gitDiffViewMode,
    setGitDiffViewMode,
    onStageAllChanges,
    onDiscardAllChanges,
    onStageFile,
    onRestoreFile,
    onUnstageFile,
    fileProvenanceByPath,
    onAddToChatPath,
    onStatusChange,
    onCollapse,
    browserState,
    onBrowserOpenTab,
    onBrowserCloseTab,
    onBrowserNavigate,
    onBrowserGoBack,
    onBrowserGoForward,
    onBrowserReload,
    onBrowserSelectTab,
    onBrowserSelectHistory,
    onBrowserReportViewportBounds,
    onBrowserTakeControl,
    onBrowserHandBack,
    onBrowserStop,
  } = props;

  const [selectedDiffKey, setSelectedDiffKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedUnchangedRows, setExpandedUnchangedRows] = useState<Record<string, boolean>>({});
  const [treeFilter, setTreeFilter] = useState("");
  const [showFileTree, setShowFileTree] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [collapsedFileSections, setCollapsedFileSections] = useState<Record<string, boolean>>({});
  const [listViewFocusKey, setListViewFocusKey] = useState<string | null>(null);
  const [browserUrlInput, setBrowserUrlInput] = useState("");
  const [browserHistoryValue, setBrowserHistoryValue] = useState("");
  const browserViewportHostRef = useRef<HTMLDivElement | null>(null);

  const resolveProvenance = (file: Pick<GitDiffFile, "path" | "oldPath">): ChangeProvenanceRecord | null => {
    const direct = fileProvenanceByPath?.[file.path];
    if (direct) {
      return direct;
    }
    if (file.oldPath) {
      return fileProvenanceByPath?.[file.oldPath] ?? null;
    }
    return null;
  };

  const formatProvenanceLabel = (record: ChangeProvenanceRecord | null) => {
    if (!record) {
      return "Unknown provenance";
    }
    const actor = record.actorName?.trim().length ? record.actorName : record.actorType;
    const reason = record.reason?.trim();
    return reason ? `${actor} • ${reason}` : `${actor} • ${record.operation}`;
  };

  const parsedDiff = useMemo(() => parseGitDiffOutput(gitPanelOutput), [gitPanelOutput]);
  const hasUnstagedFiles = useMemo(() => parsedDiff.files.some((file) => file.hasUnstaged), [parsedDiff.files]);
  const fileTree = useMemo(() => buildFileTree(parsedDiff.files), [parsedDiff.files]);
  const filteredTree = useMemo(() => filterTreeNodes(fileTree, treeFilter), [fileTree, treeFilter]);

  const listViewFocusFile = useMemo(
    () => parsedDiff.files.find((f) => f.key === listViewFocusKey) ?? null,
    [parsedDiff.files, listViewFocusKey],
  );
  const listViewFocusSections = useMemo(() => toDiffSections(listViewFocusFile), [listViewFocusFile]);
  const listViewFocusParsed = useMemo(
    () => listViewFocusSections.map((section) => ({ section, hunks: parseDiffHunks(section) })),
    [listViewFocusSections],
  );

  const allFileSections = useMemo(
    () =>
      parsedDiff.files
        .map((file) => {
          const sections = toDiffSections(file);
          const parsed = sections.map((section) => ({ section, hunks: parseDiffHunks(section) }));
          return { file, sections: parsed };
        })
        .filter(({ sections }) => sections.some(({ hunks }) => hunks.length > 0)),
    [parsedDiff.files],
  );

  useEffect(() => {
    if (gitPanelTab !== "diff") {
      return;
    }
    if (parsedDiff.files.length === 0) {
      setSelectedDiffKey(null);
      return;
    }
    const existing = parsedDiff.files.some((file) => file.key === selectedDiffKey);
    if (!existing) {
      setSelectedDiffKey(parsedDiff.files[0]?.key ?? null);
    }
  }, [gitPanelTab, parsedDiff.files, selectedDiffKey]);

  const runFileAction = async (actionKey: string, action: () => Promise<void>, successMessage: string) => {
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await action();
      onStatusChange(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      onStatusChange(message);
    } finally {
      setPendingAction(null);
    }
  };

  const runBrowserAction = (action: () => void | Promise<void>) => {
    void Promise.resolve(action()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(message);
    });
  };

  useEffect(() => {
    setBrowserUrlInput(browserState.activeUrl);
  }, [browserState.activeUrl]);

  useEffect(() => {
    setBrowserHistoryValue("");
  }, [browserState.history, browserState.activeTabID]);

  useLayoutEffect(() => {
    if (sidebarPanelTab !== "browser") {
      return;
    }
    const host = browserViewportHostRef.current;
    if (!host) {
      return;
    }
    let frameID: number | null = null;
    const report = () => {
      const rect = host.getBoundingClientRect();
      void onBrowserReportViewportBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    const schedule = () => {
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID);
      }
      frameID = window.requestAnimationFrame(() => {
        frameID = null;
        report();
      });
    };

    report();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        schedule();
      });
      observer.observe(host);
    }
    return () => {
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID);
      }
    };
  }, [onBrowserReportViewportBounds, sidebarPanelTab, browserState.activeTabID, browserState.activeUrl]);

  const renderListView = () => (
    <div className="git-list-view">
      <div className="git-list-files">
        {parsedDiff.files.map((file) => {
          const statusTag = inferStatusTag(file.status);
          const fileName = file.path.split("/").pop() ?? file.path;
          const dirPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
          const isActive = listViewFocusKey === file.key;
          const provenance = resolveProvenance(file);
          return (
            <div
              key={file.key}
              className={`git-list-card${isActive ? " active" : ""}`}
              onClick={() => setListViewFocusKey(isActive ? null : file.key)}
              role="button"
              tabIndex={0}
            >
              <span className={`git-list-status git-file-status-${file.status}`}>{statusTag}</span>
              <span className="git-list-info">
                <span className="git-list-filename">{fileName}</span>
                {dirPath ? <span className="git-list-dir">{dirPath}</span> : null}
                <span className={`git-list-provenance ${provenance ? "" : "unknown"}`.trim()}>{formatProvenanceLabel(provenance)}</span>
              </span>
              <span className="git-list-meta">
                <span className="git-list-stats">
                  <span className="added">+{file.added}</span>
                  <span className="git-list-stats-sep">/</span>
                  <span className="removed">-{file.removed}</span>
                </span>
                <span className="git-list-actions" onClick={(e) => e.stopPropagation()}>
                  {file.hasUnstaged && onRestoreFile ? (
                    <button
                      type="button"
                      className="git-file-action-btn"
                      onClick={() =>
                        void runFileAction(`restore:${file.key}`, () => onRestoreFile(file.path), `Restored ${file.path}`)
                      }
                      disabled={pendingAction === `restore:${file.key}`}
                      title="Restore"
                    >
                      <RotateCcw size={14} />
                    </button>
                  ) : null}
                  {file.hasUnstaged && onStageFile ? (
                    <button
                      type="button"
                      className="git-file-action-btn"
                      onClick={() =>
                        void runFileAction(`stage:${file.key}`, () => onStageFile(file.path), `Staged ${file.path}`)
                      }
                      disabled={pendingAction === `stage:${file.key}`}
                      title="Stage"
                    >
                      <Plus size={14} />
                    </button>
                  ) : null}
                  {file.hasStaged && onUnstageFile ? (
                    <button
                      type="button"
                      className="git-file-action-btn"
                      onClick={() =>
                        void runFileAction(`unstage:${file.key}`, () => onUnstageFile(file.path), `Unstaged ${file.path}`)
                      }
                      disabled={pendingAction === `unstage:${file.key}`}
                      title="Unstage"
                    >
                      <Minus size={14} />
                    </button>
                  ) : null}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderTreeNodes = (nodes: FileTreeNode[], depth = 0): ReactNode[] => {
    return nodes.map((node) => {
      if (node.type === "folder") {
        const isExpanded = expandedFolders[node.fullPath] !== false;
        return (
          <div key={node.fullPath} className="git-tree-group">
            <button
              type="button"
              className="git-tree-folder"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => setExpandedFolders((prev) => ({ ...prev, [node.fullPath]: !isExpanded }))}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={14} />
              <span className="git-tree-name">{node.name}</span>
            </button>
            {isExpanded ? renderTreeNodes(node.children, depth + 1) : null}
          </div>
        );
      }
      return (
        <button
          key={node.fullPath}
          type="button"
          className={`git-tree-file ${node.file && selectedDiffKey === node.file.key ? "active" : ""}`.trim()}
          style={{ paddingLeft: `${depth * 16 + 22}px` }}
          onClick={() => {
            if (node.file) {
              setSelectedDiffKey(node.file.key);
              const idx = parsedDiff.files.findIndex((f) => f.key === node.file!.key);
              if (idx >= 0) {
                document.getElementById(`diff-file-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }
            }
          }}
        >
          <FileText size={14} />
          <span className="git-tree-name">{node.name}</span>
        </button>
      );
    });
  };

  const renderTreePanel = () => (
    <>
      <div className="git-tree-filter-wrap">
        <Search size={13} className="git-tree-filter-icon" />
        <input
          type="text"
          className="git-tree-filter"
          placeholder="Filter files..."
          value={treeFilter}
          onChange={(e) => setTreeFilter(e.target.value)}
        />
      </div>
      <div className="git-tree-scroll">{renderTreeNodes(filteredTree)}</div>
    </>
  );

  const renderFileHunks = (hunks: ParsedHunk[], sectionKey: string): ReactNode => {
    const allRows: ReactNode[] = [];
    for (let i = 0; i < hunks.length; i++) {
      const hunk = hunks[i]!;
      const hunkStart = parseHunkHeader(hunk.header);
      if (i === 0 && hunkStart.oldStart > 1) {
        const count = hunkStart.oldStart - 1;
        allRows.push(
          <div key={`${sectionKey}:leading`} className="git-diff-collapsed-lines">
            {count} unmodified {count === 1 ? "line" : "lines"}
          </div>,
        );
      } else if (i > 0) {
        const prev = hunks[i - 1]!;
        let prevEnd = 0;
        for (let j = prev.lines.length - 1; j >= 0; j--) {
          if (prev.lines[j]!.oldLine !== null) {
            prevEnd = prev.lines[j]!.oldLine!;
            break;
          }
        }
        const gap = hunkStart.oldStart - prevEnd - 1;
        if (gap > 0) {
          allRows.push(
            <div key={`${sectionKey}:gap:${i}`} className="git-diff-collapsed-lines">
              {gap} unmodified {gap === 1 ? "line" : "lines"}
            </div>,
          );
        }
      }
      const rows = gitDiffViewMode === "split" ? renderSplitHunk(hunk, sectionKey) : renderUnifiedHunk(hunk, sectionKey);
      allRows.push(...rows);
    }
    return <div className="git-diff-rows-wrapper">{allRows}</div>;
  };

  const renderUnifiedHunk = (hunk: ParsedHunk, sectionKey: string) => {
    const rows: ReactNode[] = [];
    let index = 0;
    while (index < hunk.lines.length) {
      const line = hunk.lines[index]!;
      if (line.type !== "context") {
        rows.push(
          <div key={line.id} className={`git-diff-row git-diff-row-${line.type}`}>
            <span className="git-diff-ln">{lineNumber(line.oldLine)}</span>
            <span className="git-diff-ln">{lineNumber(line.newLine)}</span>
            <span className="git-diff-code">{line.text}</span>
          </div>,
        );
        index += 1;
        continue;
      }

      const start = index;
      while (index < hunk.lines.length && hunk.lines[index]!.type === "context") {
        index += 1;
      }
      const run = hunk.lines.slice(start, index);
      if (run.length <= 10) {
        for (const contextLine of run) {
          rows.push(
            <div key={contextLine.id} className="git-diff-row git-diff-row-context">
              <span className="git-diff-ln">{lineNumber(contextLine.oldLine)}</span>
              <span className="git-diff-ln">{lineNumber(contextLine.newLine)}</span>
              <span className="git-diff-code">{contextLine.text}</span>
            </div>,
          );
        }
        continue;
      }

      const collapseKey = `${sectionKey}:${hunk.key}:${start}`;
      const expanded = Boolean(expandedUnchangedRows[collapseKey]);
      if (expanded) {
        for (const contextLine of run) {
          rows.push(
            <div key={contextLine.id} className="git-diff-row git-diff-row-context">
              <span className="git-diff-ln">{lineNumber(contextLine.oldLine)}</span>
              <span className="git-diff-ln">{lineNumber(contextLine.newLine)}</span>
              <span className="git-diff-code">{contextLine.text}</span>
            </div>,
          );
        }
      } else {
        for (const contextLine of run.slice(0, 3)) {
          rows.push(
            <div key={contextLine.id} className="git-diff-row git-diff-row-context">
              <span className="git-diff-ln">{lineNumber(contextLine.oldLine)}</span>
              <span className="git-diff-ln">{lineNumber(contextLine.newLine)}</span>
              <span className="git-diff-code">{contextLine.text}</span>
            </div>,
          );
        }
        rows.push(
          <button
            key={`${collapseKey}:expand`}
            type="button"
            className="git-diff-collapsed-lines"
            onClick={() => setExpandedUnchangedRows((current) => ({ ...current, [collapseKey]: true }))}
          >
            {run.length - 6} unmodified lines
          </button>,
        );
        for (const contextLine of run.slice(-3)) {
          rows.push(
            <div key={contextLine.id} className="git-diff-row git-diff-row-context">
              <span className="git-diff-ln">{lineNumber(contextLine.oldLine)}</span>
              <span className="git-diff-ln">{lineNumber(contextLine.newLine)}</span>
              <span className="git-diff-code">{contextLine.text}</span>
            </div>,
          );
        }
      }
    }

    return rows;
  };

  const renderSplitHunk = (hunk: ParsedHunk, sectionKey: string) => {
    const rows: ReactNode[] = [];
    let index = 0;

    while (index < hunk.lines.length) {
      const line = hunk.lines[index]!;
      if (line.type === "context") {
        const start = index;
        while (index < hunk.lines.length && hunk.lines[index]!.type === "context") {
          index += 1;
        }
        const run = hunk.lines.slice(start, index);
        const collapseKey = `${sectionKey}:${hunk.key}:${start}`;
        const expanded = Boolean(expandedUnchangedRows[collapseKey]);
        const visible = run.length > 10 && !expanded ? [...run.slice(0, 3), ...run.slice(-3)] : run;
        visible.forEach((contextLine, contextIndex) => {
          if (run.length > 10 && !expanded && contextIndex === 3) {
            rows.push(
              <button
                key={`${collapseKey}:expand`}
                type="button"
                className="git-diff-collapsed-lines split"
                onClick={() => setExpandedUnchangedRows((current) => ({ ...current, [collapseKey]: true }))}
              >
                {run.length - 6} unmodified lines
              </button>,
            );
          }
          rows.push(
            <div key={contextLine.id} className="git-diff-split-row git-diff-split-context">
              <span className="git-diff-cell git-diff-cell-left">
                <span className="git-diff-ln">{lineNumber(contextLine.oldLine)}</span>
                <span className="git-diff-code">{contextLine.text}</span>
              </span>
              <span className="git-diff-cell git-diff-cell-right">
                <span className="git-diff-ln">{lineNumber(contextLine.newLine)}</span>
                <span className="git-diff-code">{contextLine.text}</span>
              </span>
            </div>,
          );
        });
        continue;
      }

      const removed: ParsedHunkLine[] = [];
      const added: ParsedHunkLine[] = [];
      while (index < hunk.lines.length && hunk.lines[index]!.type === "remove") {
        removed.push(hunk.lines[index]!);
        index += 1;
      }
      while (index < hunk.lines.length && hunk.lines[index]!.type === "add") {
        added.push(hunk.lines[index]!);
        index += 1;
      }

      const maxRows = Math.max(removed.length, added.length);
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const left = removed[rowIndex] ?? null;
        const right = added[rowIndex] ?? null;
        rows.push(
          <div key={`${hunk.key}:split:${rowIndex}:${left?.id ?? "none"}:${right?.id ?? "none"}`} className="git-diff-split-row">
            <span className={`git-diff-cell git-diff-cell-left ${left ? "git-diff-row-remove" : "git-diff-row-empty"}`.trim()}>
              <span className="git-diff-ln">{lineNumber(left?.oldLine ?? null)}</span>
              <span className="git-diff-code">{left?.text ?? ""}</span>
            </span>
            <span className={`git-diff-cell git-diff-cell-right ${right ? "git-diff-row-add" : "git-diff-row-empty"}`.trim()}>
              <span className="git-diff-ln">{lineNumber(right?.newLine ?? null)}</span>
              <span className="git-diff-code">{right?.text ?? ""}</span>
            </span>
          </div>,
        );
      }
    }

    return rows;
  };

  const submitBrowserNavigation = () => {
    const rawValue = browserUrlInput.trim();
    if (!rawValue) {
      return;
    }
    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    setBrowserUrlInput(normalized);
    runBrowserAction(() => onBrowserNavigate(normalized));
  };

  const renderBrowserPane = () => (
    <section className="ops-section ops-section-fill browser-pane">
      <h3>Browser</h3>
      <div className="browser-tab-strip" role="tablist" aria-label="Browser tabs">
        {browserState.tabs.length === 0 ? (
          <span className="browser-tab-empty">No tabs</span>
        ) : (
          browserState.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.isActive}
              className={`browser-tab ${tab.isActive ? "active" : ""}`.trim()}
              onClick={() => runBrowserAction(() => onBrowserSelectTab(tab.id))}
              title={tab.url || tab.title}
            >
              <span className="browser-tab-title">{tab.title || tab.url || "Untitled"}</span>
              {onBrowserCloseTab ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="browser-tab-close"
                  aria-label={`Close ${tab.title || tab.url || "tab"}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    runBrowserAction(() => onBrowserCloseTab(tab.id));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      runBrowserAction(() => onBrowserCloseTab(tab.id));
                    }
                  }}
                >
                  <X size={11} />
                </span>
              ) : null}
            </button>
          ))
        )}
        {onBrowserOpenTab ? (
          <button
            type="button"
            className="browser-tab browser-tab-add"
            onClick={() => runBrowserAction(onBrowserOpenTab)}
            title="Open new tab"
            aria-label="Open new tab"
          >
            <Plus size={12} />
            <span>New tab</span>
          </button>
        ) : null}
      </div>

      <div className="browser-nav-row">
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserGoBack)}
          disabled={!browserState.canGoBack}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserGoForward)}
          disabled={!browserState.canGoForward}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserReload)}
          aria-label="Reload"
          title={browserState.isLoading ? "Loading..." : "Reload"}
        >
          <RefreshCw size={14} className={browserState.isLoading ? "spin" : ""} />
        </button>
        <form
          className="browser-url-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitBrowserNavigation();
          }}
        >
          <input
            type="text"
            className="browser-url-input"
            value={browserUrlInput}
            placeholder="Enter URL"
            onChange={(event) => setBrowserUrlInput(event.target.value)}
            aria-label="Browser URL"
          />
          <button type="submit" className="browser-url-go">Go</button>
        </form>
      </div>

      <div className="browser-history-row">
        <select
          className="browser-history-select"
          value={browserHistoryValue}
          onChange={(event) => {
            const selected = event.target.value;
            setBrowserHistoryValue(selected);
            if (selected) {
              runBrowserAction(() => onBrowserSelectHistory(selected));
            }
          }}
          aria-label="Browser history"
        >
          <option value="">History</option>
          {browserState.history.map((entry) => (
            <option key={entry.id} value={entry.url}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className="browser-viewport-pane">
        <div ref={browserViewportHostRef} className="browser-viewport-host">
          <span className="browser-viewport-label">Renderer viewport host</span>
          <span className="browser-viewport-url">{browserState.activeUrl || "No active URL"}</span>
        </div>
      </div>

      {!browserState.modeEnabled ? (
        <p className="browser-mode-note">Browser mode is disabled. Enable Browser mode to allow agent actions.</p>
      ) : null}

      <div className="browser-control-strip">
        <span className={`browser-owner-chip owner-${browserState.controlOwner}`.trim()}>
          Control: {browserState.controlOwner === "human" ? "Human" : "Agent"}
        </span>
        <div className="browser-control-actions">
          <button
            type="button"
            className="browser-control-btn"
            onClick={() => runBrowserAction(browserState.controlOwner === "human" ? onBrowserHandBack : onBrowserTakeControl)}
          >
            {browserState.controlOwner === "human" ? "Hand back to agent" : "Take control"}
          </button>
          <button
            type="button"
            className="browser-control-btn danger"
            onClick={() => runBrowserAction(onBrowserStop)}
            disabled={!(browserState.canStop ?? browserState.actionRunning)}
          >
            <Square size={12} />
            Stop
          </button>
        </div>
      </div>
    </section>
  );

  return (
    <aside className="sidebar ops-pane">
      <div className="ops-panel-tabs">
        <button
          type="button"
          className={`ops-panel-tab ${sidebarPanelTab === "git" ? "active" : ""}`.trim()}
          onClick={() => setSidebarPanelTab("git")}
          aria-label="Git"
        >
          <span className="ops-panel-tab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={13} height={13}>
              <circle cx="7" cy="6" r="2.2" />
              <circle cx="17" cy="12" r="2.2" />
              <circle cx="7" cy="18" r="2.2" />
              <path d="M8.9 7.3 15 10.7" />
              <path d="M8.9 16.7 15 13.3" />
            </svg>
          </span>
          <span className="ops-panel-tab-label">Git</span>
        </button>
        <button
          type="button"
          className={`ops-panel-tab ${sidebarPanelTab === "files" ? "active" : ""}`.trim()}
          onClick={() => setSidebarPanelTab("files")}
          aria-label="Files"
        >
          <span className="ops-panel-tab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={13} height={13}>
              <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 20H6A2.5 2.5 0 0 1 3.5 17.5z" />
            </svg>
          </span>
          <span className="ops-panel-tab-label">Files</span>
        </button>
        <button
          type="button"
          className={`ops-panel-tab ${sidebarPanelTab === "browser" ? "active" : ""}`.trim()}
          onClick={() => setSidebarPanelTab("browser")}
          aria-label="Browser"
        >
          <span className="ops-panel-tab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={13} height={13}>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a15 15 0 0 1 0 18" />
              <path d="M12 3a15 15 0 0 0 0 18" />
            </svg>
          </span>
          <span className="ops-panel-tab-label">Browser</span>
        </button>
        {onCollapse ? (
          <button
            type="button"
            className="ops-panel-collapse"
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelRightClose size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {sidebarPanelTab === "git" ? (
        <section className="ops-section ops-section-fill">
          <div className="ops-git-sub-tabs">
            <button
              type="button"
              className={`ops-git-sub-tab ${gitPanelTab === "diff" ? "active" : ""}`.trim()}
              onClick={() => {
                setGitPanelTab("diff");
                void onLoadGitDiff();
              }}
            >
              Diff
            </button>
            <button
              type="button"
              className={`ops-git-sub-tab ${gitPanelTab === "log" ? "active" : ""}`.trim()}
              onClick={() => {
                setGitPanelTab("log");
                void onLoadGitLog();
              }}
            >
              Log
            </button>
            <button
              type="button"
              className={`ops-git-sub-tab ${gitPanelTab === "issues" ? "active" : ""}`.trim()}
              onClick={() => {
                setGitPanelTab("issues");
                void onLoadGitIssues();
              }}
            >
              Issues
            </button>
            <button
              type="button"
              className={`ops-git-sub-tab ${gitPanelTab === "prs" ? "active" : ""}`.trim()}
              onClick={() => {
                setGitPanelTab("prs");
                void onLoadGitPrs();
              }}
            >
              PRs
            </button>
            <div className="ops-git-view-modes">
              <button
                type="button"
                className={`git-action-icon-btn ${gitDiffViewMode === "list" ? "active" : ""}`.trim()}
                aria-label="List view"
                title="List view"
                onClick={() => setGitDiffViewMode("list")}
              >
                <List size={13} />
              </button>
              <button
                type="button"
                className={`git-action-icon-btn ${gitDiffViewMode === "unified" ? "active" : ""}`.trim()}
                aria-label="Unified view"
                title="Unified view"
                onClick={() => setGitDiffViewMode("unified")}
              >
                <AlignJustify size={13} />
              </button>
              <button
                type="button"
                className={`git-action-icon-btn ${gitDiffViewMode === "split" ? "active" : ""}`.trim()}
                aria-label="Split view"
                title="Split view"
                onClick={() => setGitDiffViewMode("split")}
              >
                <Columns2 size={13} />
              </button>
            </div>
          </div>
          {gitPanelTab === "diff" ? (
            <div className="git-files-panel">
              <div className="git-files-actions">
                <button
                  type="button"
                  className="git-action-icon-btn"
                  onClick={() => {
                    if (!onStageAllChanges) {
                      return;
                    }
                    void runFileAction("stage-all", onStageAllChanges, "Staged all local changes.");
                  }}
                  disabled={pendingAction === "stage-all" || !onStageAllChanges || parsedDiff.files.length === 0}
                  aria-label="Stage all changes"
                  title="Stage all changes"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="git-action-icon-btn"
                  onClick={() => {
                    if (!onDiscardAllChanges) {
                      return;
                    }
                    void runFileAction("discard-all", onDiscardAllChanges, "Discarded all unstaged changes.");
                  }}
                  disabled={pendingAction === "discard-all" || !onDiscardAllChanges || !hasUnstagedFiles}
                  aria-label="Discard changes"
                  title="Discard changes"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  className="git-action-icon-btn"
                  onClick={() => {
                    const first = parsedDiff.files[0];
                    if (!first) {
                      return;
                    }
                    setSelectedDiffKey(first.key);
                    if (gitDiffViewMode !== "list") {
                      setGitDiffViewMode("unified");
                    }
                    document.getElementById("diff-file-0")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  disabled={parsedDiff.files.length === 0}
                  aria-label="Review changes"
                  title="Review changes"
                >
                  <Eye size={16} />
                </button>
              </div>

              {actionError ? <p className="git-files-error">{actionError}</p> : null}

              {parsedDiff.message === "Loading diff..." ? (
                <p className="git-files-empty">Loading changes...</p>
              ) : parsedDiff.files.length === 0 ? (
                <p className="git-files-empty">{parsedDiff.message ?? "No local changes."}</p>
              ) : (
                <div className={`git-diff-layout git-diff-layout-${gitDiffViewMode}${gitDiffViewMode !== "list" && !showFileTree ? " tree-hidden" : ""}`.trim()}>
                  <div className="git-files-heading">
                    <p className="git-files-count">Files ({parsedDiff.files.length})</p>
                    {gitDiffViewMode !== "list" ? (
                      <button
                        type="button"
                        className="git-action-icon-btn"
                        aria-label={showFileTree ? "Hide file tree" : "Show file tree"}
                        title={showFileTree ? "Hide file tree" : "Show file tree"}
                        onClick={() => setShowFileTree((v) => !v)}
                      >
                        {showFileTree ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                      </button>
                    ) : null}
                  </div>

                  {gitDiffViewMode === "list" ? (
                    <div className="git-list-view-pane">{renderListView()}</div>
                  ) : (
                    <>
                      <div className="git-diff-multi-pane">
                        {allFileSections.map(({ file, sections }, idx) => {
                          const isCollapsed = collapsedFileSections[file.key] === true;
                          const provenance = resolveProvenance(file);
                          return (
                            <div key={file.key} id={`diff-file-${idx}`} className="git-diff-file-section">
                              <div className="git-diff-file-header">
                                <button
                                  type="button"
                                  className="git-diff-file-toggle"
                                  onClick={() =>
                                    setCollapsedFileSections((prev) => ({ ...prev, [file.key]: !isCollapsed }))
                                  }
                                >
                                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </button>
                                <span className="git-diff-file-path" title={file.path}>
                                  {file.path}
                                </span>
                                <span className="git-diff-file-stats">
                                  <span className="added">+{file.added}</span>
                                  <span className="removed">-{file.removed}</span>
                                </span>
                                <span className={`git-diff-provenance-chip ${provenance ? "" : "unknown"}`.trim()}>
                                  Why this changed: {formatProvenanceLabel(provenance)}
                                </span>
                                <span
                                  className="git-diff-file-actions"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {file.hasUnstaged && onRestoreFile ? (
                                    <button
                                      type="button"
                                      className="git-file-action-btn"
                                      onClick={() =>
                                        void runFileAction(
                                          `restore:${file.key}`,
                                          () => onRestoreFile(file.path),
                                          `Restored ${file.path}`,
                                        )
                                      }
                                      disabled={pendingAction === `restore:${file.key}`}
                                      title="Restore"
                                    >
                                      <RotateCcw size={14} />
                                    </button>
                                  ) : null}
                                  {file.hasUnstaged && onStageFile ? (
                                    <button
                                      type="button"
                                      className="git-file-action-btn"
                                      onClick={() =>
                                        void runFileAction(
                                          `stage:${file.key}`,
                                          () => onStageFile(file.path),
                                          `Staged ${file.path}`,
                                        )
                                      }
                                      disabled={pendingAction === `stage:${file.key}`}
                                      title="Stage"
                                    >
                                      <Plus size={14} />
                                    </button>
                                  ) : null}
                                  {file.hasStaged && onUnstageFile ? (
                                    <button
                                      type="button"
                                      className="git-file-action-btn"
                                      onClick={() =>
                                        void runFileAction(
                                          `unstage:${file.key}`,
                                          () => onUnstageFile(file.path),
                                          `Unstaged ${file.path}`,
                                        )
                                      }
                                      disabled={pendingAction === `unstage:${file.key}`}
                                      title="Unstage"
                                    >
                                      <Minus size={14} />
                                    </button>
                                  ) : null}
                                </span>
                              </div>
                              {!isCollapsed ? (
                                <div className="git-diff-file-body">
                                  {sections.map(({ section, hunks }) => (
                                    <div key={section.key} className="git-diff-section">
                                      {sections.length > 1 ? (
                                        <div className="git-diff-section-label">{section.label}</div>
                                      ) : null}
                                      <div
                                        className={`git-diff-hunk-body${gitDiffViewMode === "split" ? " split" : ""}`}
                                      >
                                        {renderFileHunks(hunks, section.key)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {showFileTree ? <div className="git-file-tree-pane">{renderTreePanel()}</div> : null}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <pre className="ops-console">{gitPanelOutput}</pre>
          )}
        </section>
      ) : null}

      {sidebarPanelTab === "files" ? (
        <ProjectFilesPanel directory={activeProjectDir ?? ""} onAddToChatPath={onAddToChatPath} onStatus={onStatusChange} />
      ) : null}

      {sidebarPanelTab === "browser" ? renderBrowserPane() : null}

      {sidebarPanelTab === "git" && gitDiffViewMode === "list" && listViewFocusFile ? (
        <div className="git-list-diff-overlay">
          <div className="git-diff-file-header">
            <button
              type="button"
              className="git-diff-file-toggle"
              onClick={() => setListViewFocusKey(null)}
              title="Close"
            >
              <X size={14} />
            </button>
            <span className="git-diff-file-path" title={listViewFocusFile.path}>
              {listViewFocusFile.path}
            </span>
            <span className="git-diff-file-stats">
              <span className="added">+{listViewFocusFile.added}</span>
              <span className="removed">-{listViewFocusFile.removed}</span>
            </span>
            <span className={`git-diff-provenance-chip ${resolveProvenance(listViewFocusFile) ? "" : "unknown"}`.trim()}>
              Why this changed: {formatProvenanceLabel(resolveProvenance(listViewFocusFile))}
            </span>
          </div>
          <div className="git-list-diff-body">
            {listViewFocusParsed.map(({ section, hunks }) => (
              <div key={section.key} className="git-diff-section">
                {listViewFocusParsed.length > 1 ? (
                  <div className="git-diff-section-label">{section.label}</div>
                ) : null}
                <div className="git-diff-hunk-body">
                  {renderFileHunks(hunks, section.key)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
