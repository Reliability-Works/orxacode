import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { PermissionRequest, QuestionAnswer, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client";
import type {
  ProjectListItem,
  RuntimeDependencyReport,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  SessionMessageBundle,
  SkillEntry,
} from "@shared/ipc";
import { JobEditorModal, type JobRecord, type JobRunRecord } from "./JobsBoard";
import { MessageFeed } from "./MessageFeed";
import { ProfileModal } from "./ProfileModal";
import type { CommitNextStep } from "../hooks/useGitPanel";
import type { PermissionMode } from "../types/app";

type SkillUseModalState = { skill: SkillEntry; projectDir: string } | null;
export type SkillPromptTarget = "current" | "new";

type CommitSummary = {
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  repoRoot: string;
} | null;

type CommitFlowState = {
  phase: "running" | "success" | "error";
  nextStep: CommitNextStep;
  message: string;
} | null;

export type GlobalModalsHostProps = {
  activeProjectDir?: string;
  permissionMode: PermissionMode;
  dependencyReport: RuntimeDependencyReport | null;
  dependencyModalOpen: boolean;
  setDependencyModalOpen: Dispatch<SetStateAction<boolean>>;
  onCheckDependencies: () => void | Promise<void>;
  permissionRequest: PermissionRequest | null;
  permissionDecisionInFlight: boolean;
  replyPermission: (decision: "once" | "always" | "reject") => void | Promise<void>;
  questionRequest: QuestionRequest | null;
  replyQuestion: (answers: QuestionAnswer[]) => void | Promise<void>;
  rejectQuestion: () => void | Promise<void>;
  allSessionsModalOpen: boolean;
  setAllSessionsModalOpen: Dispatch<SetStateAction<boolean>>;
  sessions: Session[];
  getSessionStatusType: (sessionID: string, directory?: string) => string;
  activeSessionID?: string;
  openSession: (directory: string, sessionID: string) => void | Promise<void>;
  jobRunViewer: JobRunRecord | null;
  closeJobRunViewer: () => void;
  projects: ProjectListItem[];
  jobRunViewerLoading: boolean;
  jobRunViewerMessages: SessionMessageBundle[];
  branchCreateModalOpen: boolean;
  setBranchCreateModalOpen: Dispatch<SetStateAction<boolean>>;
  branchCreateName: string;
  setBranchCreateName: Dispatch<SetStateAction<string>>;
  branchCreateError: string | null;
  setBranchCreateError: Dispatch<SetStateAction<string | null>>;
  submitBranchCreate: () => Promise<void>;
  branchSwitching: boolean;
  commitModalOpen: boolean;
  setCommitModalOpen: Dispatch<SetStateAction<boolean>>;
  commitSummary: CommitSummary;
  commitSummaryLoading: boolean;
  commitIncludeUnstaged: boolean;
  setCommitIncludeUnstaged: Dispatch<SetStateAction<boolean>>;
  commitMessageDraft: string;
  setCommitMessageDraft: Dispatch<SetStateAction<string>>;
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>;
  commitNextStep: CommitNextStep;
  setCommitNextStep: Dispatch<SetStateAction<CommitNextStep>>;
  commitSubmitting: boolean;
  commitBaseBranch: string;
  setCommitBaseBranch: Dispatch<SetStateAction<string>>;
  commitBaseBranchOptions: string[];
  commitBaseBranchLoading: boolean;
  commitFlowState: CommitFlowState;
  dismissCommitFlowState: () => void;
  submitCommit: () => Promise<void>;
  jobEditorOpen: boolean;
  jobDraft: JobRecord;
  closeJobEditor: () => void;
  updateJobEditor: (next: JobRecord) => void;
  saveJobEditor: () => Promise<void>;
  addProjectDirectory: (options?: { select?: boolean }) => Promise<string | undefined>;
  skillUseModal: SkillUseModalState;
  setSkillUseModal: Dispatch<SetStateAction<SkillUseModalState>>;
  applySkillToProject: (skill: SkillEntry, targetProjectDir: string, sessionTarget: SkillPromptTarget) => Promise<void>;
  profileModalOpen: boolean;
  setProfileModalOpen: Dispatch<SetStateAction<boolean>>;
  profiles: RuntimeProfile[];
  runtime: RuntimeState;
  onSaveProfile: (profile: RuntimeProfileInput) => Promise<void>;
  onDeleteProfile: (profileID: string) => Promise<void>;
  onAttachProfile: (profileID: string) => Promise<void>;
  onStartLocalProfile: (profileID: string) => Promise<void>;
  onStopLocalProfile: () => Promise<void>;
};

function formatCommitStepLabel(step: CommitNextStep) {
  if (step === "commit_and_push") {
    return "Committing changes and pushing";
  }
  if (step === "commit_and_create_pr") {
    return "Creating Pull Request";
  }
  return "Committing changes";
}

export function GlobalModalsHost({
  activeProjectDir,
  dependencyReport,
  dependencyModalOpen,
  setDependencyModalOpen,
  onCheckDependencies,
  allSessionsModalOpen,
  setAllSessionsModalOpen,
  sessions,
  getSessionStatusType,
  activeSessionID,
  openSession,
  jobRunViewer,
  closeJobRunViewer,
  projects,
  jobRunViewerLoading,
  jobRunViewerMessages,
  branchCreateModalOpen,
  setBranchCreateModalOpen,
  branchCreateName,
  setBranchCreateName,
  branchCreateError,
  setBranchCreateError,
  submitBranchCreate,
  branchSwitching,
  commitModalOpen,
  setCommitModalOpen,
  commitSummary,
  commitSummaryLoading,
  commitIncludeUnstaged,
  setCommitIncludeUnstaged,
  commitMessageDraft,
  setCommitMessageDraft,
  commitNextStepOptions,
  commitNextStep,
  setCommitNextStep,
  commitSubmitting,
  commitBaseBranch,
  setCommitBaseBranch,
  commitBaseBranchOptions,
  commitBaseBranchLoading,
  commitFlowState,
  dismissCommitFlowState,
  submitCommit,
  jobEditorOpen,
  jobDraft,
  closeJobEditor,
  updateJobEditor,
  saveJobEditor,
  addProjectDirectory,
  skillUseModal,
  setSkillUseModal,
  applySkillToProject,
  profileModalOpen,
  setProfileModalOpen,
  profiles,
  runtime,
  onSaveProfile,
  onDeleteProfile,
  onAttachProfile,
  onStartLocalProfile,
  onStopLocalProfile,
}: GlobalModalsHostProps) {
  const [copiedDependencyKey, setCopiedDependencyKey] = useState<string | null>(null);
  const [skillTargetSelectorOpen, setSkillTargetSelectorOpen] = useState(false);
  const [skillPreparing, setSkillPreparing] = useState(false);

  useEffect(() => {
    if (!copiedDependencyKey) {
      return;
    }
    const timer = window.setTimeout(() => setCopiedDependencyKey(null), 1200);
    return () => window.clearTimeout(timer);
  }, [copiedDependencyKey]);

  useEffect(() => {
    setSkillTargetSelectorOpen(false);
    setSkillPreparing(false);
  }, [skillUseModal?.skill.id, skillUseModal?.projectDir]);

  const copyDependencyCommand = async (installCommand: string, key: string) => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopiedDependencyKey(key);
    } catch {
      setCopiedDependencyKey(null);
    }
  };
  const dependencyRequiredMissing = Boolean(dependencyReport?.missingRequired);
  const closeDependencyModal = () => {
    if (dependencyRequiredMissing) {
      return;
    }
    setDependencyModalOpen(false);
  };

  const submitSkillPrompt = async (sessionTarget: SkillPromptTarget) => {
    if (!skillUseModal?.projectDir) {
      return;
    }
    try {
      setSkillPreparing(true);
      await applySkillToProject(skillUseModal.skill, skillUseModal.projectDir, sessionTarget);
    } finally {
      setSkillPreparing(false);
      setSkillTargetSelectorOpen(false);
    }
  };

  return (
    <>
      {dependencyModalOpen && dependencyReport?.missingAny ? (
        <div className="overlay dependency-overlay" onClick={closeDependencyModal}>
          <section className="modal dependency-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>Runtime Dependencies</h2>
              {!dependencyRequiredMissing ? (
                <button type="button" onClick={closeDependencyModal}>
                  Close
                </button>
              ) : null}
            </header>
            <div className="dependency-modal-body">
              <p className="dependency-intro">
                OpenCode is required to run sessions. The Orxa package is optional and only needed for Orxa mode workflows.
              </p>
              {dependencyRequiredMissing ? (
                <p className="dependency-warning">
                  OpenCode is missing. Install it and use <strong>Check again</strong> to continue.
                </p>
              ) : null}
              <div className="dependency-list">
                {dependencyReport.dependencies.map((dependency) => (
                  <article key={dependency.key} className={`dependency-card ${dependency.installed ? "ok" : "missing"}`.trim()}>
                    <header>
                      <strong>{dependency.label}</strong>
                      <div className="dependency-badges">
                        <span className={`dependency-badge ${dependency.required ? "required" : "optional"}`.trim()}>
                          {dependency.required ? "Required" : "Optional"}
                        </span>
                        <span className={`dependency-badge ${dependency.installed ? "installed" : "missing"}`.trim()}>
                          {dependency.installed ? "Installed" : "Missing"}
                        </span>
                      </div>
                    </header>
                    <p>{dependency.description}</p>
                    <small>{dependency.reason}</small>
                    <div className="dependency-install">
                      <code>{dependency.installCommand}</code>
                      <button
                        type="button"
                        className="dependency-copy-btn"
                        onClick={() => void copyDependencyCommand(dependency.installCommand, dependency.key)}
                      >
                        {copiedDependencyKey === dependency.key ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <a
                      href={dependency.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        void window.orxa.app.openExternal(dependency.sourceUrl).catch(() => undefined);
                      }}
                    >
                      Source repository
                    </a>
                  </article>
                ))}
              </div>
              <div className="dependency-actions">
                <button type="button" className="primary" onClick={() => void onCheckDependencies()}>
                  Check again
                </button>
                {!dependencyRequiredMissing ? (
                  <button type="button" onClick={closeDependencyModal}>
                    Continue
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* Permission and Question modals removed — now render via PermissionDock and QuestionDock in ComposerPanel */}

      {allSessionsModalOpen && activeProjectDir ? (
        <div className="overlay" onClick={() => setAllSessionsModalOpen(false)}>
          <div className="modal session-list-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>all sessions</h2>
              <button type="button" className="modal-close-btn" onClick={() => setAllSessionsModalOpen(false)}>
                X
              </button>
            </div>
            <div className="session-list-search">
              <input type="text" placeholder="search sessions..." />
            </div>
            <div className="session-list-modal-body">
              {sessions.map((session) => {
                const status = getSessionStatusType(session.id, activeProjectDir);
                const busy = status === "busy" || status === "retry";
                const awaitingPermission = status === "permission";
                const isActive = session.id === activeSessionID;
                const statusLabelClass = awaitingPermission
                  ? "session-status-label--busy"
                  : busy
                    ? "session-status-label--busy"
                    : isActive
                      ? "session-status-label--active"
                      : "session-status-label--idle";
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`session-modal-row ${isActive ? "active" : ""}`.trim()}
                    onClick={() => {
                      if (!activeProjectDir) {
                        return;
                      }
                      void openSession(activeProjectDir, session.id);
                      setAllSessionsModalOpen(false);
                    }}
                    title={session.title || session.slug}
                  >
                    <span
                      className={`session-status-indicator ${awaitingPermission ? "attention" : busy ? "busy" : "idle"}`}
                      aria-hidden="true"
                    >
                      {awaitingPermission ? "!" : null}
                    </span>
                    <div className="session-modal-row-info">
                      <span className="session-modal-row-title">{session.title || session.slug}</span>
                      <span className="session-modal-row-workspace">{activeProjectDir}</span>
                    </div>
                    <div className="session-modal-row-right">
                      <span className="session-modal-row-time">{new Date(session.time.updated).toLocaleString()}</span>
                      <span className={`session-status-label ${statusLabelClass}`}>{isActive ? "active" : status}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {jobRunViewer ? (
        <div className="overlay" onClick={closeJobRunViewer}>
          <section className="modal job-run-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>{jobRunViewer.jobName}</h2>
              <button type="button" className="modal-close-btn" onClick={closeJobRunViewer}>
                X
              </button>
            </header>
            <div className="job-run-meta">
              <span>{projects.find((project) => project.worktree === jobRunViewer.projectDir)?.name || jobRunViewer.projectDir.split("/").at(-1) || jobRunViewer.projectDir}</span>
              <small>
                Session {jobRunViewer.sessionID}
              </small>
            </div>
            <div className="job-run-body">
              {jobRunViewerLoading ? <p className="dashboard-empty">Loading job output...</p> : <MessageFeed messages={jobRunViewerMessages} />}
            </div>
          </section>
        </div>
      ) : null}

      {branchCreateModalOpen ? (
        <div className="overlay" onClick={() => setBranchCreateModalOpen(false)}>
          <section className="modal branch-create-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>create branch</h2>
              <button type="button" className="modal-close-btn" onClick={() => setBranchCreateModalOpen(false)}>
                X
              </button>
            </header>
            <div className="branch-create-modal-body">
              <label className="branch-create-field">
                <input
                  type="text"
                  value={branchCreateName}
                  onChange={(event) => {
                    setBranchCreateName(event.target.value);
                    setBranchCreateError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitBranchCreate();
                    }
                    if (event.key === "Escape") {
                      setBranchCreateModalOpen(false);
                    }
                  }}
                  placeholder="feature/..."
                  autoFocus
                />
              </label>
              <p className="branch-create-from-hint">from main</p>
              {branchCreateError ? <p className="branch-create-error">{branchCreateError}</p> : null}
            </div>
            <div className="modal-action-bar">
              <button type="button" onClick={() => setBranchCreateModalOpen(false)}>
                cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!branchCreateName.trim() || branchSwitching}
                onClick={() => void submitBranchCreate()}
              >
                {branchSwitching ? "creating..." : "create"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {commitModalOpen && activeProjectDir ? (
        <div className="overlay" onClick={() => setCommitModalOpen(false)}>
          <section className="modal commit-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>commit changes</h2>
              <button type="button" className="modal-close-btn" onClick={() => setCommitModalOpen(false)}>
                X
              </button>
            </header>
            <div className="commit-modal-body">
              {commitSummaryLoading ? (
                <p className="permission-description">Loading changes...</p>
              ) : (
                <>
                  <div className="commit-summary-grid">
                    <div>
                      <small>Branch</small>
                      <strong>{commitSummary?.branch ?? "..."}</strong>
                    </div>
                    <div>
                      <small>Changes</small>
                      <strong className="commit-summary-values">
                        <span>{`${commitSummary?.filesChanged ?? 0} files`}</span>
                        <span className="added">+{commitSummary?.insertions ?? 0}</span>
                        <span className="removed">-{commitSummary?.deletions ?? 0}</span>
                      </strong>
                    </div>
                  </div>

                  <div>
                    <p className="commit-section-header">Staged ({commitSummary?.filesChanged ?? 0})</p>
                    <div className="commit-file-list">
                      <div className="commit-file-row">
                        <span className="commit-file-status commit-file-status--modified">M</span>
                        <span className="commit-file-name">{commitSummary?.branch ?? "..."}</span>
                      </div>
                    </div>
                  </div>

                  <label className="commit-include-toggle">
                    <input
                      type="checkbox"
                      checked={commitIncludeUnstaged}
                      onChange={(event) => setCommitIncludeUnstaged(event.target.checked)}
                    />
                    Include unstaged changes
                  </label>
                </>
              )}

              <div className="commit-message-field">
                <div className="commit-message-header">
                  <span>commit message</span>
                  <button type="button" className="commit-ai-btn">ai</button>
                </div>
                <textarea
                  rows={4}
                  value={commitMessageDraft}
                  placeholder="Leave blank to autogenerate a commit message"
                  onChange={(event) => setCommitMessageDraft(event.target.value)}
                />
              </div>

              <section className="commit-next-steps">
                <small>next step</small>
                {commitNextStepOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={commitNextStep === option.id ? "active" : ""}
                    onClick={() => setCommitNextStep(option.id)}
                  >
                    <span className="commit-radio-dot" aria-hidden="true" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </section>

              {commitNextStep === "commit_and_create_pr" ? (
                <label className="commit-base-branch-field">
                  Base branch for PR
                  <select
                    value={commitBaseBranch}
                    onChange={(event) => setCommitBaseBranch(event.target.value)}
                    disabled={commitBaseBranchLoading}
                  >
                    <option value="">Use repository default</option>
                    {commitBaseBranchOptions.map((branch) => (
                      <option key={`commit-base-${branch}`} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="modal-action-bar">
              <button type="button" onClick={() => setCommitModalOpen(false)}>
                cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={commitSubmitting || commitSummaryLoading}
                onClick={() => void submitCommit()}
              >
                {commitSubmitting ? "committing..." : "commit"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {commitFlowState ? (
        <div className="overlay" onClick={commitFlowState.phase === "running" ? undefined : dismissCommitFlowState}>
          <section className="modal commit-progress-modal" onClick={(event) => event.stopPropagation()}>
            <div className="commit-progress-body">
              {commitFlowState.phase === "running" ? (
                <>
                  <span className="session-status-indicator busy commit-progress-spinner" aria-hidden="true" />
                  <h2>{formatCommitStepLabel(commitFlowState.nextStep)}</h2>
                </>
              ) : commitFlowState.phase === "success" ? (
                <>
                  <h2>{commitFlowState.message}</h2>
                  <p>Complete</p>
                </>
              ) : (
                <>
                  <h2>Commit flow failed</h2>
                  <p>{commitFlowState.message}</p>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <JobEditorModal
        open={jobEditorOpen}
        draft={jobDraft}
        projects={projects}
        onClose={closeJobEditor}
        onChange={updateJobEditor}
        onSave={() => {
          void saveJobEditor();
        }}
        onAddProject={() => addProjectDirectory({ select: false })}
      />

      {skillUseModal ? (
        <div className="overlay" onClick={() => setSkillUseModal(null)}>
          <section className="modal skill-use-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>use skill: {skillUseModal.skill.name}</h2>
              <button type="button" className="modal-close-btn" onClick={() => setSkillUseModal(null)}>
                X
              </button>
            </header>
            <div className="skill-use-body">
              <label>
                target workspace
                <div className="skill-use-project-row">
                  <select
                    value={skillUseModal.projectDir}
                    onChange={(event) => setSkillUseModal((current) => (current ? { ...current, projectDir: event.target.value } : current))}
                  >
                    <option value="">choose a workspace</option>
                    {projects.map((project) => (
                      <option key={`skill-use-${project.id}`} value={project.worktree}>
                        {project.name || project.worktree.split("/").at(-1) || project.worktree}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      void addProjectDirectory({ select: false }).then((directory) => {
                        if (!directory) {
                          return;
                        }
                        setSkillUseModal((current) => (current ? { ...current, projectDir: directory } : current));
                      })
                    }
                  >
                    Add new workspace
                  </button>
                </div>
              </label>
              <p className="skill-use-description">{skillUseModal.skill.description}</p>
              {skillTargetSelectorOpen ? (
                <section className="skill-use-target-selector">
                  <p>Add this prepared prompt to:</p>
                  <div className="skill-use-target-actions">
                    <button
                      type="button"
                      disabled={skillPreparing}
                      onClick={() => void submitSkillPrompt("current")}
                    >
                      Current session
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={skillPreparing}
                      onClick={() => void submitSkillPrompt("new")}
                    >
                      New session
                    </button>
                    <button
                      type="button"
                      disabled={skillPreparing}
                      onClick={() => setSkillTargetSelectorOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
            <div className="modal-action-bar">
              <button type="button" disabled={skillPreparing} onClick={() => setSkillUseModal(null)}>
                cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={!skillUseModal.projectDir || skillPreparing}
                onClick={() => setSkillTargetSelectorOpen(true)}
              >
                {skillPreparing ? "Preparing..." : "Prepare prompt"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ProfileModal
        open={profileModalOpen}
        profiles={profiles}
        runtime={runtime}
        onClose={() => setProfileModalOpen(false)}
        onSave={onSaveProfile}
        onDelete={onDeleteProfile}
        onAttach={onAttachProfile}
        onStartLocal={onStartLocalProfile}
        onStopLocal={onStopLocalProfile}
      />
    </>
  );
}
