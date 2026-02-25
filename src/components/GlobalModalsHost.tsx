import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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
  openSession: (sessionID: string) => void;
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

function formatQuestionPrompt(questionRequest: QuestionRequest | null) {
  if (!questionRequest) {
    return "";
  }
  const raw = questionRequest as unknown as Record<string, unknown>;
  const candidate = raw.question ?? raw.prompt ?? raw.message ?? raw.title;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  return "OpenCode requires additional input to continue.";
}

function compactPermissionPattern(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatPermissionDescription(permissionRequest: PermissionRequest) {
  const firstPattern = (permissionRequest.patterns ?? []).find((pattern) => pattern.trim().length > 0);
  const permissionName = permissionRequest.permission.trim();
  const isCommandRequest = /\b(bash|command|exec|run)\b/i.test(permissionName);
  if (firstPattern && isCommandRequest) {
    return `OpenCode is requesting access to run: ${compactPermissionPattern(firstPattern)}`;
  }
  if (firstPattern) {
    return `OpenCode is requesting access for: ${compactPermissionPattern(firstPattern)}`;
  }
  if (permissionName) {
    return `OpenCode is requesting access for "${permissionName}".`;
  }
  return "OpenCode is requesting additional access.";
}

export function GlobalModalsHost({
  activeProjectDir,
  permissionMode,
  dependencyReport,
  dependencyModalOpen,
  setDependencyModalOpen,
  onCheckDependencies,
  permissionRequest,
  permissionDecisionInFlight,
  replyPermission,
  questionRequest,
  replyQuestion,
  rejectQuestion,
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
  const [questionFallbackDraft, setQuestionFallbackDraft] = useState("");
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({});
  const [questionCustomDrafts, setQuestionCustomDrafts] = useState<Record<number, string>>({});
  const [copiedDependencyKey, setCopiedDependencyKey] = useState<string | null>(null);
  const [skillTargetSelectorOpen, setSkillTargetSelectorOpen] = useState(false);
  const [skillPreparing, setSkillPreparing] = useState(false);

  useEffect(() => {
    setQuestionFallbackDraft("");
    setQuestionSelections({});
    setQuestionCustomDrafts({});
  }, [questionRequest?.id]);

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

  const questionItems = useMemo(() => questionRequest?.questions ?? [], [questionRequest?.questions]);
  const isStructuredQuestion = questionItems.length > 0;
  const isSingleChoiceQuestion = questionItems.length === 1 && questionItems[0]?.multiple !== true;

  const setSingleSelection = (questionIndex: number, optionLabel: string) => {
    setQuestionSelections((current) => ({
      ...current,
      [questionIndex]: [optionLabel],
    }));
  };

  const toggleSelection = (questionIndex: number, optionLabel: string) => {
    setQuestionSelections((current) => {
      const previous = current[questionIndex] ?? [];
      const exists = previous.includes(optionLabel);
      return {
        ...current,
        [questionIndex]: exists ? previous.filter((item) => item !== optionLabel) : [...previous, optionLabel],
      };
    });
  };

  const updateCustomAnswer = (questionIndex: number, value: string) => {
    setQuestionCustomDrafts((current) => ({
      ...current,
      [questionIndex]: value,
    }));
  };

  const buildStructuredAnswers = (): QuestionAnswer[] =>
    questionItems.map((question, index) => {
      const selected = questionSelections[index] ?? [];
      const customEnabled = question.custom !== false;
      const customText = customEnabled ? (questionCustomDrafts[index] ?? "").trim() : "";
      if (question.multiple === true) {
        const combined = customText ? [...selected, customText] : selected;
        return Array.from(new Set(combined.map((item) => item.trim()).filter((item) => item.length > 0)));
      }
      if (customText) {
        return [customText];
      }
      return selected.length > 0 ? [selected[0]!] : [];
    });

  const canSubmitStructuredQuestion = isStructuredQuestion && buildStructuredAnswers().every((answers) => answers.length > 0);

  const submitStructuredAnswers = async () => {
    const answers = buildStructuredAnswers();
    if (!answers.every((item) => item.length > 0)) {
      return;
    }
    await replyQuestion(answers);
  };

  const selectQuestionOption = async (questionIndex: number, optionLabel: string) => {
    const question = questionItems[questionIndex];
    if (!question) {
      return;
    }
    if (question.multiple === true) {
      toggleSelection(questionIndex, optionLabel);
      return;
    }
    setSingleSelection(questionIndex, optionLabel);
    if (isSingleChoiceQuestion) {
      await replyQuestion([[optionLabel]]);
    }
  };

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
                    <a href={dependency.sourceUrl} target="_blank" rel="noreferrer">
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

      {permissionRequest && activeProjectDir && permissionMode !== "yolo-write" ? (
        <div className="overlay permission-overlay">
          <section className="modal permission-modal">
            <header className="modal-header">
              <h2>Permission Request</h2>
            </header>
            <div className="permission-modal-body">
              <p className="permission-title">{permissionRequest.permission}</p>
              <p className="permission-description">{formatPermissionDescription(permissionRequest)}</p>
              <div className="permission-patterns">
                {(permissionRequest.patterns ?? []).map((pattern) => (
                  <code key={pattern}>{pattern}</code>
                ))}
              </div>
              <div className="permission-actions">
                <button
                  type="button"
                  disabled={permissionDecisionInFlight}
                  onClick={() => void replyPermission("once")}
                >
                  Allow once
                </button>
                <button
                  type="button"
                  disabled={permissionDecisionInFlight}
                  onClick={() => void replyPermission("always")}
                >
                  Allow session
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={permissionDecisionInFlight}
                  onClick={() => void replyPermission("reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {questionRequest && activeProjectDir ? (
        <div className="overlay permission-overlay" onClick={() => void rejectQuestion()}>
          <section className="modal permission-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>Question</h2>
            </header>
            <div className="permission-modal-body">
              {isStructuredQuestion ? (
                <div className="question-modal-content">
                  {questionItems.map((question, index) => {
                    const selected = questionSelections[index] ?? [];
                    const customEnabled = question.custom !== false;
                    const customDraft = questionCustomDrafts[index] ?? "";
                    return (
                      <section key={`${question.header}-${index}`} className="question-block">
                        <h3>{question.header}</h3>
                        <p className="permission-title">
                          {question.question}
                          {question.multiple === true ? " (select all that apply)" : ""}
                        </p>
                        <div className="question-options">
                          {question.options.map((option) => {
                            const active = selected.includes(option.label);
                            return (
                              <button
                                key={option.label}
                                type="button"
                                className={`question-option ${active ? "active" : ""}`.trim()}
                                onClick={() => void selectQuestionOption(index, option.label)}
                              >
                                <strong>{option.label}</strong>
                                <small>{option.description}</small>
                              </button>
                            );
                          })}
                        </div>
                        {customEnabled ? (
                          <label className="commit-message-field">
                            Custom answer
                            <textarea
                              rows={2}
                              value={customDraft}
                              placeholder="Type your own answer"
                              onChange={(event) => updateCustomAnswer(index, event.target.value)}
                            />
                          </label>
                        ) : null}
                      </section>
                    );
                  })}
                  {isSingleChoiceQuestion ? <p className="raw-path">Selecting an option will submit immediately.</p> : null}
                </div>
              ) : (
                <>
                  <p className="permission-title">{formatQuestionPrompt(questionRequest)}</p>
                  <label className="commit-message-field">
                    Your answer
                    <textarea
                      rows={4}
                      value={questionFallbackDraft}
                      placeholder="Type your answer"
                      onChange={(event) => setQuestionFallbackDraft(event.target.value)}
                    />
                  </label>
                </>
              )}
              <div className="permission-actions">
                <button type="button" className="danger" onClick={() => void rejectQuestion()}>
                  Reject
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    isStructuredQuestion
                      ? !canSubmitStructuredQuestion || isSingleChoiceQuestion
                      : !questionFallbackDraft.trim()
                  }
                  onClick={() => void (isStructuredQuestion ? submitStructuredAnswers() : replyQuestion([[questionFallbackDraft.trim()]]))}
                >
                  Submit
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {allSessionsModalOpen && activeProjectDir ? (
        <div className="overlay" onClick={() => setAllSessionsModalOpen(false)}>
          <div className="modal session-list-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>All Sessions</h2>
              <button type="button" onClick={() => setAllSessionsModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="session-list-modal-body">
              {sessions.map((session) => {
                const status = getSessionStatusType(session.id, activeProjectDir);
                const busy = status === "busy" || status === "retry";
                const awaitingPermission = status === "permission";
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`project-session-row session-modal-row ${session.id === activeSessionID ? "active" : ""}`.trim()}
                    onClick={() => {
                      openSession(session.id);
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
                    <strong>{session.title || session.slug}</strong>
                    <span>{status}</span>
                    <small>{new Date(session.time.updated).toLocaleString()}</small>
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
              <button type="button" onClick={closeJobRunViewer}>
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
              <h2>Create and checkout new branch</h2>
              <button type="button" onClick={() => setBranchCreateModalOpen(false)}>
                X
              </button>
            </header>
            <div className="branch-create-modal-body">
              <label className="branch-create-field">
                Branch name
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
                  placeholder="feature/my-new-branch"
                  autoFocus
                />
              </label>
              {branchCreateError ? <p className="branch-create-error">{branchCreateError}</p> : null}
              <div className="branch-create-actions">
                <button type="button" onClick={() => setBranchCreateModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!branchCreateName.trim() || branchSwitching}
                  onClick={() => void submitBranchCreate()}
                >
                  {branchSwitching ? "Creating..." : "Create and checkout"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {commitModalOpen && activeProjectDir ? (
        <div className="overlay" onClick={() => setCommitModalOpen(false)}>
          <section className="modal commit-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>Commit your changes</h2>
              <button type="button" onClick={() => setCommitModalOpen(false)}>
                X
              </button>
            </header>
            <div className="commit-modal-body">
              <div className="commit-summary-grid">
                <div>
                  <small>Branch</small>
                  <strong>{commitSummary?.branch ?? "..."}</strong>
                </div>
                <div>
                  <small>Changes</small>
                  <strong>
                    {commitSummaryLoading
                      ? "Loading..."
                      : `${commitSummary?.filesChanged ?? 0} files   +${commitSummary?.insertions ?? 0}  -${commitSummary?.deletions ?? 0}`}
                  </strong>
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

              <label className="commit-message-field">
                Commit message
                <textarea
                  rows={4}
                  value={commitMessageDraft}
                  placeholder="Leave blank to autogenerate a commit message"
                  onChange={(event) => setCommitMessageDraft(event.target.value)}
                />
              </label>

              <section className="commit-next-steps">
                <small>Next steps</small>
                {commitNextStepOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={commitNextStep === option.id ? "active" : ""}
                    onClick={() => setCommitNextStep(option.id)}
                  >
                    <span className="menu-item-logo">{option.icon}</span>
                    <span>{option.label}</span>
                    <span>{commitNextStep === option.id ? "✓" : ""}</span>
                  </button>
                ))}
              </section>

              <button
                type="button"
                className="commit-continue"
                disabled={commitSubmitting || commitSummaryLoading}
                onClick={() => void submitCommit()}
              >
                {commitSubmitting ? "Committing..." : "Continue"}
              </button>
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
              <h2>Use Skill</h2>
              <button type="button" onClick={() => setSkillUseModal(null)}>
                X
              </button>
            </header>
            <div className="skill-use-body">
              <strong>{skillUseModal.skill.name}</strong>
              <p>{skillUseModal.skill.description}</p>
              <label>
                Workspace
                <div className="skill-use-project-row">
                  <select
                    value={skillUseModal.projectDir}
                    onChange={(event) => setSkillUseModal((current) => (current ? { ...current, projectDir: event.target.value } : current))}
                  >
                    <option value="">Choose a workspace</option>
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
              <footer className="skill-use-actions">
                <button type="button" disabled={skillPreparing} onClick={() => setSkillUseModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!skillUseModal.projectDir || skillPreparing}
                  onClick={() => setSkillTargetSelectorOpen(true)}
                >
                  {skillPreparing ? "Preparing..." : "Prepare prompt"}
                </button>
              </footer>
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
