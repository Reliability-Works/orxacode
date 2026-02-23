import type { GitBranchState } from "@shared/ipc";
import { useEffect, useMemo, useState } from "react";
import { IconButton } from "./IconButton";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { Plus, Eye, RotateCcw, Minus } from "lucide-react";

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
  diffText: string;
};

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
    const chunkText = chunk.lines.join("\n").trimEnd();
    const nextDiffText = existing
      ? [existing.diffText, `## ${chunk.section === "unstaged" ? "Unstaged" : "Staged"}\n`, chunkText].join("\n\n")
      : [`## ${chunk.section === "unstaged" ? "Unstaged" : "Staged"}\n`, chunkText].join("\n");

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
        diffText: nextDiffText,
      });
      continue;
    }

    existing.added += chunk.added;
    existing.removed += chunk.removed;
    existing.hasUnstaged = existing.hasUnstaged || chunk.section === "unstaged";
    existing.hasStaged = existing.hasStaged || chunk.section === "staged";
    existing.diffText = nextDiffText;

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
                <>
                  <div className="git-file-list" role="list" aria-label="Changed files">
                    {parsedDiff.files.map((file) => {
                      const statusTag = inferStatusTag(file.status);
                      const fileName = file.path.split("/").pop() ?? file.path;
                      const oldFileName = file.oldPath ? file.oldPath.split("/").pop() : undefined;
                      return (
                        <div
                          key={file.key}
                          role="listitem"
                          className={`git-file-row ${selectedDiffFile?.key === file.key ? "active" : ""}`.trim()}
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
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
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
