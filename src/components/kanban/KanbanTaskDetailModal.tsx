import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, FileCode, FileDiff, FileMinus, FilePlus, FolderOpen, GitBranch, GitPullRequest, MessageSquare, Pencil, Play, Plus, RotateCcw, Square, Terminal, Trash2 } from "lucide-react";
import type {
  KanbanCheckpointDiff,
  KanbanDiffFile,
  KanbanRegenerateTaskField,
  KanbanReviewComment,
  KanbanSettings,
  KanbanTask,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
  KanbanScriptShortcutResult,
  KanbanTaskProviderConfig,
} from "@shared/ipc";
import { providerLabel, shipStatusLabel, statusLabel } from "./kanban-utils";
import { KanbanTaskTerminal } from "./KanbanTaskTerminal";
import { KanbanTaskProviderConfigFields } from "./KanbanTaskProviderConfigFields";
import { buildRunAgentCliOptions, buildTaskFieldRegenerationPrompt, extractGeneratedFieldText } from "./kanban-task-generation";

type DetailTab = "overview" | "diff" | "review" | "checkpoints" | "transcript";

type Props = {
  detail: KanbanTaskDetail;
  snapshot: { tasks: KanbanTask[]; dependencies: Array<{ fromTaskId: string; toTaskId: string }> };
  workspaceDir: string;
  onClose: () => void;
  onRefresh: () => void;
};

function fileStatusIcon(status: string) {
  switch (status) {
    case "added": return <FilePlus size={13} aria-hidden="true" />;
    case "deleted": return <FileMinus size={13} aria-hidden="true" />;
    case "renamed": return <FileCode size={13} aria-hidden="true" />;
    default: return <FileDiff size={13} aria-hidden="true" />;
  }
}

function DiffFileViewer({
  file,
  reviewComments,
  onAddComment,
}: {
  file: KanbanDiffFile;
  reviewComments: KanbanReviewComment[];
  onAddComment: (filePath: string, line: number, body: string) => void;
}) {
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const filePath = file.newPath || file.oldPath;
  const fileComments = reviewComments.filter((c) => c.filePath === filePath);
  const commentsByLine = new Map<number, KanbanReviewComment[]>();
  for (const comment of fileComments) {
    const current = commentsByLine.get(comment.line) ?? [];
    current.push(comment);
    commentsByLine.set(comment.line, current);
  }

  return (
    <div className="kanban-diff-file-viewer">
      <div className="kanban-diff-file-path">
        {fileStatusIcon(file.status)}
        <span>{file.status === "renamed" ? `${file.oldPath} → ${file.newPath}` : filePath}</span>
      </div>
      {file.hunks.map((hunk, hunkIndex) => (
        <div key={hunkIndex} className="kanban-diff-hunk">
          <div className="kanban-diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, lineIndex) => {
            const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0;
            const lineComments = commentsByLine.get(lineNum);
            return (
              <div key={lineIndex}>
                <div className={`kanban-diff-line kanban-diff-line--${line.type}`}>
                  <span className="kanban-diff-line-num">{line.oldLineNumber ?? ""}</span>
                  <span className="kanban-diff-line-num">{line.newLineNumber ?? ""}</span>
                  <button
                    type="button"
                    className="kanban-diff-line-comment-btn"
                    onClick={(e) => { e.stopPropagation(); setCommentLine(commentLine === lineNum ? null : lineNum); setCommentBody(""); }}
                    title="Add review comment"
                  >
                    <Plus size={10} />
                  </button>
                  <span className="kanban-diff-line-content">{line.content}</span>
                </div>
                {lineComments?.map((comment) => (
                  <div key={comment.id} className="kanban-diff-inline-comment">
                    <strong>{comment.body}</strong>
                    <small>{new Date(comment.createdAt).toLocaleString()}</small>
                  </div>
                ))}
                {commentLine === lineNum ? (
                  <div className="kanban-diff-inline-comment kanban-diff-inline-comment--input">
                    <textarea
                      rows={2}
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Add a review comment…"
                      autoFocus
                    />
                    <div className="kanban-diff-inline-comment-actions">
                      <button type="button" className="kanban-filter-toggle" onClick={() => setCommentLine(null)}>Cancel</button>
                      <button
                        type="button"
                        className="kanban-primary-btn"
                        onClick={() => {
                          if (commentBody.trim()) {
                            onAddComment(filePath, lineNum, commentBody.trim());
                            setCommentLine(null);
                            setCommentBody("");
                          }
                        }}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function KanbanTaskDetailModal({ detail, snapshot, workspaceDir, onClose, onRefresh }: Props) {
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("overview");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [checkpoints, setCheckpoints] = useState<KanbanTaskCheckpoint[]>(detail.checkpoints);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState<string | null>(null);
  const [checkpointDiff, setCheckpointDiff] = useState<KanbanCheckpointDiff | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [reviewFilePath, setReviewFilePath] = useState("");
  const [reviewLine, setReviewLine] = useState("1");
  const [reviewBody, setReviewBody] = useState("");
  const [settings, setSettings] = useState<KanbanSettings | null>(null);
  const [shortcutResult, setShortcutResult] = useState<KanbanScriptShortcutResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(detail.task.title);
  const [editDescription, setEditDescription] = useState(detail.task.description);
  const [editPrompt, setEditPrompt] = useState(detail.task.prompt);
  const [editProvider, setEditProvider] = useState(detail.task.provider);
  const [editProviderConfig, setEditProviderConfig] = useState<KanbanTaskProviderConfig | undefined>(detail.task.providerConfig);
  const [regeneratingField, setRegeneratingField] = useState<KanbanRegenerateTaskField | null>(null);

  const task = detail.task;
  const runtime = detail.runtime;
  const diffFiles = activeDetailTab === "checkpoints" && checkpointDiff ? checkpointDiff.files : detail.structuredDiff;
  const shipLabel = shipStatusLabel(task.shipStatus);

  const dependencyTitles = useMemo(() => {
    const depTaskIds = snapshot.dependencies
      .filter((d) => d.toTaskId === task.id)
      .map((d) => d.fromTaskId);
    return depTaskIds.map((id) => {
      const t = snapshot.tasks.find((t) => t.id === id);
      return { id, title: t?.title ?? id };
    });
  }, [snapshot.dependencies, snapshot.tasks, task.id]);

  const loadCheckpoints = useCallback(async () => {
    try {
      const next = await window.orxa.kanban.listCheckpoints(workspaceDir, task.id);
      setCheckpoints(next);
    } catch { /* ignore */ }
  }, [workspaceDir, task.id]);

  const loadCheckpointDiff = useCallback(async (checkpointId: string) => {
    try {
      const next = await window.orxa.kanban.getCheckpointDiff(workspaceDir, task.id, checkpointId);
      setCheckpointDiff(next);
      setSelectedFileIndex(0);
    } catch { /* ignore */ }
  }, [workspaceDir, task.id]);

  useEffect(() => {
    if (activeDetailTab === "checkpoints") {
      void loadCheckpoints();
    }
  }, [activeDetailTab, loadCheckpoints]);

  useEffect(() => {
    void window.orxa.kanban.getSettings(workspaceDir).then(setSettings).catch(() => undefined);
  }, [workspaceDir]);

  useEffect(() => {
    setCheckpoints(detail.checkpoints);
    if (!editing) {
      setEditTitle(detail.task.title);
      setEditDescription(detail.task.description);
      setEditPrompt(detail.task.prompt);
      setEditProvider(detail.task.provider);
      setEditProviderConfig(detail.task.providerConfig);
    }
  }, [detail.checkpoints, detail.task.description, detail.task.prompt, detail.task.provider, detail.task.providerConfig, detail.task.title, editing]);

  const handleAddComment = useCallback(async (filePath: string, line: number, body: string) => {
    await window.orxa.kanban.addReviewComment(workspaceDir, task.id, filePath, line, body);
    onRefresh();
  }, [workspaceDir, task.id, onRefresh]);

  const handleSendFeedback = useCallback(async () => {
    const text = feedbackDraft.trim();
    if (!text) return;
    try {
      setActionError(null);
      await window.orxa.kanban.sendReviewFeedback(workspaceDir, task.id, text);
      setFeedbackDraft("");
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [feedbackDraft, workspaceDir, task.id, onRefresh]);

  const handleManualComment = useCallback(async () => {
    const line = Number(reviewLine);
    if (!reviewFilePath.trim() || !reviewBody.trim() || !Number.isFinite(line)) return;
    try {
      setActionError(null);
      await window.orxa.kanban.addReviewComment(workspaceDir, task.id, reviewFilePath.trim(), line, reviewBody.trim());
      setReviewBody("");
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [reviewFilePath, reviewLine, reviewBody, workspaceDir, task.id, onRefresh]);

  const handleSaveEdit = useCallback(async () => {
    try {
      setActionError(null);
      await window.orxa.kanban.updateTask({
        id: task.id,
        workspaceDir,
        title: editTitle,
        description: editDescription,
        prompt: editPrompt,
        provider: editProvider,
        providerConfig: editProviderConfig,
      });
      setEditing(false);
      onRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [editDescription, editPrompt, editProvider, editProviderConfig, editTitle, onRefresh, task.id, workspaceDir]);

  const regenerateField = useCallback(async (field: KanbanRegenerateTaskField) => {
    setRegeneratingField(field);
    try {
      setActionError(null);
      const prompt = buildTaskFieldRegenerationPrompt({
        workspaceDir,
        provider: editProvider,
        field,
        title: editTitle,
        description: editDescription,
        prompt: editPrompt,
      });
      const result = await window.orxa.app.runAgentCli(
        buildRunAgentCliOptions({
          provider: editProvider,
          providerConfig: editProviderConfig,
          workspaceDir,
          prompt,
        }),
      );
      const text = extractGeneratedFieldText(result.output);
      if (!result.ok || !text) {
        throw new Error(result.output.trim() || "Field regeneration failed");
      }
      if (field === "title") setEditTitle(text);
      if (field === "description") setEditDescription(text);
      if (field === "prompt") setEditPrompt(text);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRegeneratingField(null);
    }
  }, [editDescription, editPrompt, editProvider, editProviderConfig, editTitle, workspaceDir]);

  return (
    <div className="kanban-pane-overlay" onClick={onClose}>
      <section className="modal kanban-detail-modal kanban-sheet-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="kanban-detail-header-left">
            <h2>{task.title}</h2>
            <div className="kanban-task-detail-meta">
              <span className="kanban-task-pill kanban-task-pill--provider">{providerLabel(task.provider)}</span>
              <span className={`kanban-task-pill kanban-task-pill--status${task.blocked ? " is-blocked" : ""}`.trim()}>{statusLabel(task)}</span>
              {task.taskBranch ? <span className="kanban-task-pill kanban-task-pill--branch"><GitBranch size={10} />{task.taskBranch}</span> : null}
              {shipLabel ? <span className="kanban-task-pill kanban-task-pill--ship">{shipLabel}</span> : null}
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>X</button>
        </header>

        <nav className="kanban-detail-tabs">
          {(["overview", "diff", "review", "checkpoints", "transcript"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`kanban-tab${activeDetailTab === tab ? " active" : ""}`}
              onClick={() => setActiveDetailTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>

        <div className="kanban-detail-body">
          {/* Overview tab */}
          {activeDetailTab === "overview" ? (
            <div className="kanban-detail-overview">
              <div className="kanban-task-detail-actions">
                <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.startTask(workspaceDir, task.id).then(onRefresh)}>
                  <Play size={12} /> Start
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.resumeTask(workspaceDir, task.id).then(onRefresh)}>
                  <Play size={12} /> Resume
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.stopTask(workspaceDir, task.id).then(onRefresh)}>
                  <Square size={12} /> Stop
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.commitTask(workspaceDir, task.id).then(onRefresh)}>
                  <Check size={12} /> Commit
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.openTaskPr(workspaceDir, task.id).then(onRefresh)}>
                  <GitPullRequest size={12} /> Open PR
                </button>
                {detail.worktree ? (
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.openWorktree(workspaceDir, detail.worktree!.id)}>
                    <FolderOpen size={12} /> Open worktree
                  </button>
                ) : null}
                <button type="button" className="kanban-filter-toggle" onClick={() => setTerminalOpen(!terminalOpen)}>
                  <Terminal size={12} /> Terminal
                </button>
                <button type="button" className="kanban-filter-toggle" onClick={() => setEditing(!editing)}>
                  <Pencil size={12} /> {editing ? "Cancel edit" : "Edit"}
                </button>
                {task.trashStatus === "trashed" ? (
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.restoreTask(workspaceDir, task.id).then(onRefresh)}>
                    <RotateCcw size={12} /> Restore
                  </button>
                ) : (
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.trashTask(workspaceDir, task.id).then(() => { onRefresh(); onClose(); })}>
                    <Trash2 size={12} /> Trash
                  </button>
                )}
                {detail.worktree && detail.worktree.mergeStatus === "conflicted" ? (
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.resolveMergeWithAgent(workspaceDir, detail.worktree!.id).then(onRefresh)}>
                    Resolve merge
                  </button>
                ) : null}
                {detail.worktree && detail.worktree.mergeStatus !== "merged" ? (
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.mergeWorktree(workspaceDir, detail.worktree!.id).then(onRefresh)}>
                    Merge
                  </button>
                ) : null}
                {settings?.scriptShortcuts.map((shortcut) => (
                  <button key={shortcut.id} type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.runScriptShortcut(workspaceDir, task.id, shortcut.id).then(setShortcutResult)}>
                    {shortcut.name || "Shortcut"}
                  </button>
                ))}
              </div>

              {runtime ? (
                <section className="kanban-task-detail-section">
                  <h3>Runtime</h3>
                  <div className="kanban-detail-runtime-grid">
                    <span>Status</span><span>{runtime.status}</span>
                    <span>Provider</span><span>{providerLabel(runtime.provider)}</span>
                    {runtime.worktreePath ? <><span>Worktree</span><span className="kanban-detail-mono">{runtime.worktreePath}</span></> : null}
                    {runtime.taskBranch ? <><span>Branch</span><span className="kanban-detail-mono">{runtime.taskBranch}</span></> : null}
                    {runtime.lastEventSummary ? <><span>Last event</span><span>{runtime.lastEventSummary}</span></> : null}
                    {runtime.latestPreview ? <><span>Latest preview</span><span>{runtime.latestPreview}</span></> : null}
                    {runtime.mergeStatus ? <><span>Merge status</span><span>{runtime.mergeStatus}</span></> : null}
                  </div>
                </section>
              ) : null}

              {shortcutResult ? (
                <section className="kanban-task-detail-section">
                  <h3>Shortcut output</h3>
                  <pre className="kanban-diff-preview">{shortcutResult.output || (shortcutResult.ok ? "Completed successfully" : "Command failed")}</pre>
                </section>
              ) : null}

              {actionError ? (
                <section className="kanban-task-detail-section">
                  <p className="skills-error">{actionError}</p>
                </section>
              ) : null}

              {editing ? (
                <section className="kanban-task-detail-section">
                  <h3>Title</h3>
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="kanban-edit-input" />
                  <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "title"} onClick={() => void regenerateField("title")}>
                    {regeneratingField === "title" ? "Regenerating..." : "Regenerate with AI"}
                  </button>
                </section>
              ) : null}

              {editing ? (
                <section className="kanban-task-detail-section">
                  <h3>Description</h3>
                  <textarea rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Task description…" />
                  <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "description"} onClick={() => void regenerateField("description")}>
                    {regeneratingField === "description" ? "Regenerating..." : "Regenerate with AI"}
                  </button>
                </section>
              ) : task.description ? (
                <section className="kanban-task-detail-section">
                  <h3>Description</h3>
                  <p className="kanban-detail-text">{task.description}</p>
                </section>
              ) : null}

              {editing ? (
                <section className="kanban-task-detail-section">
                  <h3>Prompt</h3>
                  <textarea rows={5} value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} />
                  <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "prompt"} onClick={() => void regenerateField("prompt")}>
                    {regeneratingField === "prompt" ? "Regenerating..." : "Regenerate with AI"}
                  </button>
                </section>
              ) : (
                <section className="kanban-task-detail-section">
                  <h3>Prompt</h3>
                  <pre className="kanban-diff-preview">{task.prompt}</pre>
                </section>
              )}

              {editing ? (
                <section className="kanban-task-detail-section">
                  <h3>Provider config</h3>
                  <label className="kanban-field">
                    <span>Provider</span>
                    <div className="kanban-segmented-control">
                      {(["opencode", "codex", "claude"] as const).map((provider) => (
                        <button key={provider} type="button" className={editProvider === provider ? "active" : ""} onClick={() => setEditProvider(provider)}>
                          {providerLabel(provider)}
                        </button>
                      ))}
                    </div>
                  </label>
                  <KanbanTaskProviderConfigFields
                    workspaceDir={workspaceDir}
                    provider={editProvider}
                    providerConfig={editProviderConfig}
                    onChange={setEditProviderConfig}
                  />
                  <div className="kanban-task-detail-actions" style={{ paddingTop: 4 }}>
                    <button type="button" className="kanban-filter-toggle" onClick={() => setEditing(false)}>Cancel</button>
                    <button type="button" className="kanban-primary-btn" onClick={() => void handleSaveEdit()}>Save changes</button>
                  </div>
                </section>
              ) : null}

              {dependencyTitles.length > 0 ? (
                <section className="kanban-task-detail-section">
                  <h3>Depends on</h3>
                  <div className="kanban-dependency-list">
                    {dependencyTitles.map((dep) => (
                      <span key={dep.id} className="kanban-task-pill">{dep.title}</span>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {/* Diff tab */}
          {activeDetailTab === "diff" || (activeDetailTab === "checkpoints" && checkpointDiff) ? (
            <div className="kanban-diff-viewer">
              {diffFiles.length > 0 ? (
                <>
                  <div className="kanban-diff-file-list">
                    {diffFiles.map((file, index) => (
                      <button
                        key={`${file.oldPath}-${file.newPath}`}
                        type="button"
                        className={`kanban-diff-file-item kanban-diff-file-item--${file.status}${index === selectedFileIndex ? " active" : ""}`}
                        onClick={() => setSelectedFileIndex(index)}
                      >
                        {fileStatusIcon(file.status)}
                        <span>{file.newPath || file.oldPath}</span>
                      </button>
                    ))}
                  </div>
                  <div className="kanban-diff-hunk-view">
                    {diffFiles[selectedFileIndex] ? (
                      <DiffFileViewer
                        file={diffFiles[selectedFileIndex]}
                        reviewComments={detail.reviewComments}
                        onAddComment={(fp, ln, body) => void handleAddComment(fp, ln, body)}
                      />
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="kanban-empty-state">No changes</div>
              )}
            </div>
          ) : null}

          {/* Review tab */}
          {activeDetailTab === "review" ? (
            <div className="kanban-detail-review">
              <section className="kanban-task-detail-section">
                <h3>Feedback</h3>
                <textarea rows={3} value={feedbackDraft} onChange={(e) => setFeedbackDraft(e.target.value)} placeholder="Ask the task to revise or continue…" />
                <button type="button" className="kanban-filter-toggle" onClick={() => void handleSendFeedback()}>
                  <MessageSquare size={12} /> Send feedback
                </button>
              </section>

              <section className="kanban-task-detail-section">
                <h3>Add comment</h3>
                <div className="kanban-inline-row">
                  <input value={reviewFilePath} onChange={(e) => setReviewFilePath(e.target.value)} placeholder="src/file.ts" />
                  <input value={reviewLine} onChange={(e) => setReviewLine(e.target.value)} placeholder="line" style={{ width: 60 }} />
                </div>
                <textarea rows={2} value={reviewBody} onChange={(e) => setReviewBody(e.target.value)} placeholder="Explain the issue…" />
                <button type="button" className="kanban-filter-toggle" onClick={() => void handleManualComment()}>Add comment</button>
              </section>

              <section className="kanban-task-detail-section">
                <h3>Comments ({detail.reviewComments.length})</h3>
                <div className="kanban-review-comment-list">
                  {detail.reviewComments.map((comment) => (
                    <article key={comment.id} className="kanban-list-card">
                      <header className="kanban-list-card-header">
                        <strong className="kanban-detail-mono">{comment.filePath}:{comment.line}</strong>
                        <small>{new Date(comment.createdAt).toLocaleString()}</small>
                      </header>
                      <p className="kanban-list-card-desc">{comment.body}</p>
                    </article>
                  ))}
                  {detail.reviewComments.length === 0 ? <div className="kanban-empty-state">No comments yet</div> : null}
                </div>
              </section>
            </div>
          ) : null}

          {/* Checkpoints tab */}
          {activeDetailTab === "checkpoints" && !checkpointDiff ? (
            <div className="kanban-detail-checkpoints">
              <div className="kanban-checkpoint-list">
                {checkpoints.map((cp) => (
                  <button
                    key={cp.id}
                    type="button"
                    className={`kanban-checkpoint-item${selectedCheckpointId === cp.id ? " active" : ""}`}
                    onClick={() => {
                      setSelectedCheckpointId(cp.id);
                      void loadCheckpointDiff(cp.id);
                    }}
                  >
                    <div className="kanban-checkpoint-item-header">
                      <strong>{cp.label || "Checkpoint"}</strong>
                      <span className="kanban-task-pill">{cp.source}</span>
                    </div>
                    <div className="kanban-checkpoint-item-meta">
                      {cp.gitRevision ? <span className="kanban-detail-mono">{cp.gitRevision.slice(0, 8)}</span> : null}
                      <span>{new Date(cp.createdAt).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
                {checkpoints.length === 0 ? <div className="kanban-empty-state">No checkpoints yet</div> : null}
              </div>
            </div>
          ) : null}

          {activeDetailTab === "checkpoints" && checkpointDiff ? (
            <div>
              <button type="button" className="kanban-filter-toggle" style={{ marginBottom: 8 }} onClick={() => { setCheckpointDiff(null); setSelectedCheckpointId(null); }}>
                <ChevronRight size={12} style={{ transform: "rotate(180deg)" }} /> Back to checkpoints
              </button>
            </div>
          ) : null}

          {/* Transcript tab */}
          {activeDetailTab === "transcript" ? (
            <div className="kanban-transcript">
              {detail.transcript.map((item) => (
                <article key={item.id} className={`kanban-transcript-item is-${item.role}`.trim()}>
                  <header>
                    <strong>{item.role}</strong>
                    <small>{new Date(item.timestamp).toLocaleString()}</small>
                  </header>
                  <pre>{item.content}</pre>
                </article>
              ))}
              {detail.transcript.length === 0 ? <div className="kanban-empty-state">No transcript entries</div> : null}
            </div>
          ) : null}
        </div>
        {terminalOpen ? (
          <KanbanTaskTerminal
            workspaceDir={workspaceDir}
            taskId={task.id}
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />
        ) : null}
      </section>
    </div>
  );
}
