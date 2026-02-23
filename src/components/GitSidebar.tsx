import type { GitBranchState } from "@shared/ipc";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconButton } from "./IconButton";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { Plus, Eye, RotateCcw, Minus, List, AlignJustify, Columns2 } from "lucide-react";
import type { GitDiffViewMode } from "../hooks/useGitPanel";

export type BranchState = GitBranchState;

type SidebarPanelTab = "git" | "files";
type GitPanelTab = "diff" | "log" | "issues" | "prs";
type GitDiffSection = "unstaged" | "staged";
type GitFileStatus = "modified" | "added" | "deleted" | "renamed";

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
  onAddToChatPath: (filePath: string) => void;
  onStatusChange: (message: string) => void;
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
    onAddToChatPath,
    onStatusChange,
  } = props;

  const [selectedDiffKey, setSelectedDiffKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedUnchangedRows, setExpandedUnchangedRows] = useState<Record<string, boolean>>({});

  const parsedDiff = useMemo(() => parseGitDiffOutput(gitPanelOutput), [gitPanelOutput]);
  const hasUnstagedFiles = useMemo(() => parsedDiff.files.some((file) => file.hasUnstaged), [parsedDiff.files]);

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

  const selectedDiffFile = parsedDiff.files.find((file) => file.key === selectedDiffKey) ?? parsedDiff.files[0] ?? null;
  const diffSections = useMemo(() => toDiffSections(selectedDiffFile), [selectedDiffFile]);
  const parsedSections = useMemo(
    () => diffSections.map((section) => ({ section, hunks: parseDiffHunks(section) })),
    [diffSections],
  );

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

  const renderFileRows = (compact = false) => {
    return (
      <div className="git-file-list" role="list" aria-label="Changed files">
        {parsedDiff.files.map((file) => {
          const statusTag = inferStatusTag(file.status);
          const fileName = file.path.split("/").pop() ?? file.path;
          const oldFileName = file.oldPath ? file.oldPath.split("/").pop() : undefined;
          return (
            <div
              key={file.key}
              role="listitem"
              className={`git-file-row ${selectedDiffFile?.key === file.key ? "active" : ""} ${compact ? "compact" : ""}`.trim()}
              onClick={() => setSelectedDiffKey(file.key)}
            >
              <span className={`git-file-status git-file-status-${file.status}`}>{statusTag}</span>
              <span className="git-file-main">
                {file.status === "renamed" && oldFileName ? (
                  <span className="git-file-path" title={`${file.oldPath} -> ${file.path}`}>
                    {oldFileName} -&gt; {fileName}
                  </span>
                ) : (
                  <span className="git-file-path" title={file.path}>
                    {fileName}
                  </span>
                )}
                <span className="git-file-stage-state">
                  {file.hasStaged && file.hasUnstaged ? "staged + unstaged" : file.hasStaged ? "staged" : "unstaged"}
                </span>
              </span>
              <span className="git-file-meta">
                <span className="git-file-stats">
                  <span className="added">+{file.added}</span>
                  <span className="removed">-{file.removed}</span>
                </span>
                {!compact ? (
                  <span className="git-file-actions" onClick={(event) => event.stopPropagation()}>
                    {file.hasUnstaged ? (
                      <button
                        type="button"
                        className="git-file-action-btn"
                        onClick={() => {
                          if (!onStageFile) {
                            return;
                          }
                          void runFileAction(`stage:${file.key}`, () => onStageFile(file.path), `Staged ${file.path}`);
                        }}
                        disabled={pendingAction === `stage:${file.key}` || !onStageFile}
                        aria-label={`Stage ${fileName}`}
                        title="Stage"
                      >
                        <Plus size={14} />
                      </button>
                    ) : null}
                    {file.hasUnstaged ? (
                      <button
                        type="button"
                        className="git-file-action-btn"
                        onClick={() => {
                          if (!onRestoreFile) {
                            return;
                          }
                          void runFileAction(`restore:${file.key}`, () => onRestoreFile(file.path), `Restored ${file.path}`);
                        }}
                        disabled={pendingAction === `restore:${file.key}` || !onRestoreFile}
                        aria-label={`Restore ${fileName}`}
                        title="Restore"
                      >
                        <RotateCcw size={14} />
                      </button>
                    ) : null}
                    {file.hasStaged ? (
                      <button
                        type="button"
                        className="git-file-action-btn"
                        onClick={() => {
                          if (!onUnstageFile) {
                            return;
                          }
                          void runFileAction(`unstage:${file.key}`, () => onUnstageFile(file.path), `Unstaged ${file.path}`);
                        }}
                        disabled={pendingAction === `unstage:${file.key}` || !onUnstageFile}
                        aria-label={`Unstage ${fileName}`}
                        title="Unstage"
                      >
                        <Minus size={14} />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    );
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

    return <div className="git-diff-hunk-body">{rows}</div>;
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

    return <div className="git-diff-hunk-body split">{rows}</div>;
  };

  return (
    <aside className="sidebar ops-pane">
      <section className="ops-toolbar ops-tabs">
        <IconButton
          icon="git"
          label="Git"
          className={`tab-icon ops-tab ${sidebarPanelTab === "git" ? "active" : ""}`.trim()}
          onClick={() => setSidebarPanelTab("git")}
        />
        <IconButton
          icon="files"
          label="Files"
          className={`tab-icon ops-tab ${sidebarPanelTab === "files" ? "active" : ""}`.trim()}
          onClick={() => setSidebarPanelTab("files")}
        />
      </section>

      {sidebarPanelTab === "git" ? (
        <section className="ops-section ops-section-fill">
          <h3>Git</h3>
          <div className="ops-icon-row ops-icon-tabs">
            <IconButton
              icon="diff"
              label="Diff"
              className={gitPanelTab === "diff" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("diff");
                void onLoadGitDiff();
              }}
            />
            <IconButton
              icon="log"
              label="Log"
              className={gitPanelTab === "log" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("log");
                void onLoadGitLog();
              }}
            />
            <IconButton
              icon="issues"
              label="Issues"
              className={gitPanelTab === "issues" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("issues");
                void onLoadGitIssues();
              }}
            />
            <IconButton
              icon="pulls"
              label="Pull requests"
              className={gitPanelTab === "prs" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("prs");
                void onLoadGitPrs();
              }}
            />
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
                    if (!selectedDiffFile) {
                      return;
                    }
                    setSelectedDiffKey(selectedDiffFile.key);
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
                <div className={`git-diff-layout git-diff-layout-${gitDiffViewMode}`.trim()}>
                  <div className="git-files-heading">
                    <p className="git-files-count">Files ({parsedDiff.files.length})</p>
                    <div className="git-diff-mode-toggle" role="group" aria-label="Git diff view mode">
                      <button
                        type="button"
                        className={`git-action-icon-btn ${gitDiffViewMode === "list" ? "active" : ""}`.trim()}
                        aria-label="List view"
                        title="List view"
                        onClick={() => setGitDiffViewMode("list")}
                      >
                        <List size={15} />
                      </button>
                      <button
                        type="button"
                        className={`git-action-icon-btn ${gitDiffViewMode === "unified" ? "active" : ""}`.trim()}
                        aria-label="Unified view"
                        title="Unified view"
                        onClick={() => setGitDiffViewMode("unified")}
                      >
                        <AlignJustify size={15} />
                      </button>
                      <button
                        type="button"
                        className={`git-action-icon-btn ${gitDiffViewMode === "split" ? "active" : ""}`.trim()}
                        aria-label="Split view"
                        title="Split view"
                        onClick={() => setGitDiffViewMode("split")}
                      >
                        <Columns2 size={15} />
                      </button>
                    </div>
                  </div>

                  {gitDiffViewMode === "list" ? (
                    <div className="git-file-list-pane">{renderFileRows(false)}</div>
                  ) : (
                    <>
                      <div className="git-diff-main-pane" aria-label="Selected file diff">
                        {!selectedDiffFile ? (
                          <p className="git-diff-empty">Select a file to view diff</p>
                        ) : (
                          <div className="git-selected-file-header">
                            <span className="git-selected-file-title" title={selectedDiffFile.path}>
                              {selectedDiffFile.path}
                            </span>
                            <span className="git-selected-file-stats">
                              <span className="added">+{selectedDiffFile.added}</span>
                              <span className="removed">-{selectedDiffFile.removed}</span>
                            </span>
                          </div>
                        )}
                        {parsedSections.length === 0 ? (
                          <p className="git-diff-empty">Select a file to view diff</p>
                        ) : (
                          parsedSections.map(({ section, hunks }) => (
                            <div key={section.key} className="git-diff-section">
                              {parsedSections.length > 1 ? <div className="git-diff-section-label">{section.label}</div> : null}
                              {hunks.map((hunk) => (
                                <div key={hunk.key} className="git-diff-hunk">
                                  <div className="git-diff-hunk-header">{hunk.header}</div>
                                  {gitDiffViewMode === "split"
                                    ? renderSplitHunk(hunk, section.key)
                                    : renderUnifiedHunk(hunk, section.key)}
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="git-file-tree-pane">{renderFileRows(true)}</div>
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
    </aside>
  );
}
