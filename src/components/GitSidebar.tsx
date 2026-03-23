import type { ChangeProvenanceRecord, GitBranchState } from "@shared/ipc";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import {
  AlignJustify,
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
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type { GitDiffViewMode } from "../hooks/useGitPanel";
import {
  inferStatusTag,
  lineNumber,
  parseDiffHunks,
  parseHunkHeader,
  parseGitDiffOutput,
  toDiffSections,
  type GitDiffFile,
  type ParsedHunk,
  type ParsedHunkLine,
} from "../lib/git-diff";
import { buildFileTree, filterTreeNodes, type FileTreeNode } from "../lib/git-file-tree";

export type BranchState = GitBranchState;

type SidebarPanelTab = "git" | "files";
type GitPanelTab = "diff" | "log" | "issues" | "prs";

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

  const renderTreeNodes = (nodes: Array<FileTreeNode<GitDiffFile>>, depth = 0): ReactNode[] => {
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
