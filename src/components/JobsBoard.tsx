import { useMemo, useState } from "react";
import {
  Activity,
  AlarmClock,
  BookText,
  Bug,
  CheckCircle2,
  PackageSearch,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ProjectListItem } from "@shared/ipc";

export type JobSchedule =
  | {
      type: "daily";
      time: string;
      days: number[];
    }
  | {
      type: "interval";
      intervalMinutes: number;
    };

export type JobAgentMode = "opencode" | "codex" | "claude";

export type JobRecord = {
  id: string;
  name: string;
  projectDir: string;
  prompt: string;
  browserModeEnabled: boolean;
  agentMode: JobAgentMode;
  schedule: JobSchedule;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
};

export type JobRunRecord = {
  id: string;
  jobID: string;
  jobName: string;
  projectDir: string;
  sessionID: string;
  createdAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed";
  unread: boolean;
  error?: string;
};

export type JobTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  browserModeEnabled: boolean;
  agentMode?: JobAgentMode;
  icon: "book" | "bug" | "shield" | "activity" | "package" | "sparkles";
  schedule: JobSchedule;
};

type JobsBoardProps = {
  templates: JobTemplate[];
  jobs: JobRecord[];
  runs: JobRunRecord[];
  unreadRuns: number;
  projects: ProjectListItem[];
  onNewJob: () => void;
  onUseTemplate: (template: JobTemplate) => void;
  onDeleteJob: (jobID: string) => void;
  onToggleEnabled: (jobID: string, enabled: boolean) => void;
  onOpenRun: (runID: string) => void;
  onMarkAllRunsRead: () => void;
};

type JobEditorModalProps = {
  open: boolean;
  draft: JobRecord;
  projects: ProjectListItem[];
  onClose: () => void;
  onChange: (next: JobRecord) => void;
  onSave: () => void;
  onAddProject: () => Promise<string | undefined>;
};

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function templateIcon(icon: JobTemplate["icon"]) {
  if (icon === "book") {
    return <BookText size={16} aria-hidden="true" />;
  }
  if (icon === "bug") {
    return <Bug size={16} aria-hidden="true" />;
  }
  if (icon === "shield") {
    return <ShieldCheck size={16} aria-hidden="true" />;
  }
  if (icon === "activity") {
    return <Activity size={16} aria-hidden="true" />;
  }
  if (icon === "package") {
    return <PackageSearch size={16} aria-hidden="true" />;
  }
  return <Sparkles size={16} aria-hidden="true" />;
}

function scheduleSummary(schedule: JobSchedule) {
  if (schedule.type === "interval") {
    if (schedule.intervalMinutes < 60) {
      return `Every ${schedule.intervalMinutes} min`;
    }
    const hours = Math.round((schedule.intervalMinutes / 60) * 10) / 10;
    return `Every ${hours}h`;
  }

  const days = schedule.days.length === 7 ? "Daily" : schedule.days.map((day) => DAY_LABELS[day]).join(" ");
  return `${days} at ${schedule.time}`;
}

function projectName(projects: ProjectListItem[], directory: string) {
  const project = projects.find((item) => item.worktree === directory);
  if (!project) {
    return "No workspace";
  }
  return project.name || project.worktree.split("/").at(-1) || project.worktree;
}

export function JobsBoard({
  templates,
  jobs,
  runs,
  unreadRuns,
  projects,
  onNewJob,
  onUseTemplate,
  onDeleteJob,
  onToggleEnabled,
  onOpenRun,
  onMarkAllRunsRead,
}: JobsBoardProps) {
  const sortedJobs = useMemo(() => [...jobs].sort((left, right) => right.updatedAt - left.updatedAt), [jobs]);
  const sortedRuns = useMemo(() => [...runs].sort((left, right) => right.createdAt - left.createdAt), [runs]);

  return (
    <section className="jobs-board">
      <header className="jobs-board-header">
        <div>
          <h1>Jobs</h1>
          <p>Create scheduled automations for your local workspaces.</p>
        </div>
        <button type="button" className="jobs-new-button" onClick={onNewJob}>
          <Plus size={14} aria-hidden="true" />
          New Job +
        </button>
      </header>

      <section className="jobs-section">
        <div className="jobs-section-title jobs-inbox-title">
          <h2>inbox // recent runs</h2>
          {unreadRuns > 0 ? (
            <button type="button" className="jobs-mark-read" onClick={onMarkAllRunsRead}>
              mark all read
            </button>
          ) : null}
        </div>
        <div className="jobs-inbox-list">
          {sortedRuns.slice(0, 12).map((run) => (
            <button key={run.id} type="button" className="jobs-inbox-item" onClick={() => onOpenRun(run.id)}>
              <span className={`jobs-inbox-state ${run.status}`.trim()} aria-hidden="true" />
              <span className="jobs-inbox-main">
                <strong>{run.jobName}</strong>
                <small>
                  {projectName(projects, run.projectDir)} • {new Date(run.createdAt).toLocaleString()}
                </small>
              </span>
              {run.status === "running" ? <span className="jobs-inbox-label">Running</span> : null}
              {run.status === "failed" ? <span className="jobs-inbox-label">Failed</span> : null}
              {run.unread ? <span className="jobs-inbox-unread" aria-label="Unread" /> : null}
            </button>
          ))}
          {sortedRuns.length === 0 ? <p className="jobs-empty-copy">No completed job runs yet.</p> : null}
        </div>
      </section>

      <section className="jobs-section">
        <div className="jobs-section-title">
          <h2>configured_jobs</h2>
        </div>
        <div className="jobs-config-grid">
          {sortedJobs.map((job) => (
            <article key={job.id} className="jobs-config-card">
              <header>
                <strong>{job.name}</strong>
                <div className="jobs-config-badges">
                  <span className={`jobs-status-pill ${job.enabled ? "enabled" : "paused"}`.trim()}>
                    {job.enabled ? "Enabled" : "Paused"}
                  </span>
                  {job.browserModeEnabled ? <span className="jobs-inbox-label">Browser Mode</span> : null}
                  <span className="jobs-inbox-label">{(job.agentMode ?? "opencode").charAt(0).toUpperCase() + (job.agentMode ?? "opencode").slice(1)}</span>
                </div>
              </header>
              <p>{job.prompt}</p>
              <footer>
                <span>{projectName(projects, job.projectDir)}</span>
                <span>{scheduleSummary(job.schedule)}</span>
              </footer>
              <div className="jobs-config-actions">
                <button type="button" className="jobs-pause" onClick={() => onToggleEnabled(job.id, !job.enabled)}>
                  {job.enabled ? "Pause" : "Resume"}
                </button>
                <button type="button" className="jobs-delete" onClick={() => onDeleteJob(job.id)}>
                  <Trash2 size={13} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </article>
          ))}
          {sortedJobs.length === 0 ? (
            <div className="jobs-empty">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>No jobs yet. Create one from a template or start from scratch.</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="jobs-section">
        <div className="jobs-section-title">
          <h2>templates</h2>
        </div>
        <div className="jobs-template-grid">
          {templates.map((template) => (
            <article key={template.id} className="jobs-template-card">
              <header>
                <span className="jobs-template-icon">{templateIcon(template.icon)}</span>
                <strong>{template.title}</strong>
              </header>
              <p>{template.description}</p>
              <small>{scheduleSummary(template.schedule)}</small>
              <button type="button" onClick={() => onUseTemplate(template)}>
                use template
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export function JobEditorModal({ open, draft, projects, onClose, onChange, onSave, onAddProject }: JobEditorModalProps) {
  const [addingProject, setAddingProject] = useState(false);

  if (!open) {
    return null;
  }

  const update = (patch: Partial<JobRecord>) => {
    onChange({
      ...draft,
      ...patch,
      updatedAt: Date.now(),
    });
  };

  const schedule = draft.schedule;

  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal job-editor-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Create automation</h2>
          <button type="button" onClick={onClose}>
            X
          </button>
        </header>
        <div className="job-editor-body">
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Weekly release notes"
            />
          </label>

          <label>
            Workspace
            <div className="job-editor-project-row">
              <select
                value={draft.projectDir}
                onChange={(event) => update({ projectDir: event.target.value })}
              >
                <option value="">Choose a workspace</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.worktree}>
                    {project.name || project.worktree.split("/").at(-1) || project.worktree}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setAddingProject(true);
                  void onAddProject()
                    .then((directory) => {
                      if (directory) {
                        update({ projectDir: directory });
                      }
                    })
                    .finally(() => setAddingProject(false));
                }}
                disabled={addingProject}
              >
                {addingProject ? "Adding..." : "Add workspace"}
              </button>
            </div>
          </label>

          <label>
            Agent instructions
            <textarea
              rows={6}
              value={draft.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
              placeholder="Describe what the job should do..."
            />
          </label>

          <label>
            Agent
            <div className="job-editor-agent-select">
              {(["opencode", "codex", "claude"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={draft.agentMode === mode ? "active" : ""}
                  onClick={() => update({ agentMode: mode })}
                  disabled={mode !== "opencode"}
                  title={mode !== "opencode" ? `${mode.charAt(0).toUpperCase() + mode.slice(1)} job execution coming soon` : undefined}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </label>

          <label className="job-editor-toggle-row">
            <span>Enable Browser Mode</span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.browserModeEnabled}
              className={`job-editor-switch${draft.browserModeEnabled ? " on" : ""}`}
              onClick={() => update({ browserModeEnabled: !draft.browserModeEnabled })}
            >
              <span className="job-editor-switch-thumb" />
            </button>
          </label>

          <section className="job-editor-schedule">
            <div className="job-editor-schedule-header">
              <span>Schedule</span>
              <div className="job-editor-schedule-type">
                <button
                  type="button"
                  className={schedule.type === "daily" ? "active" : ""}
                  onClick={() =>
                    update({
                      schedule:
                        schedule.type === "daily"
                          ? schedule
                          : { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] },
                    })
                  }
                >
                  <AlarmClock size={12} aria-hidden="true" />
                  Daily
                </button>
                <button
                  type="button"
                  className={schedule.type === "interval" ? "active" : ""}
                  onClick={() =>
                    update({
                      schedule: schedule.type === "interval" ? schedule : { type: "interval", intervalMinutes: 240 },
                    })
                  }
                >
                  <Activity size={12} aria-hidden="true" />
                  Interval
                </button>
              </div>
            </div>

            {schedule.type === "daily" ? (
              <>
                <label>
                  Time
                  <input
                    type="time"
                    value={schedule.time}
                    onChange={(event) =>
                      update({
                        schedule: {
                          ...schedule,
                          time: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <div className="job-editor-days">
                  {DAY_LABELS.map((label, index) => {
                    const active = schedule.days.includes(index);
                    return (
                      <button
                        key={`${label}-${index}`}
                        type="button"
                        className={active ? "active" : ""}
                        onClick={() => {
                          const next = new Set(schedule.days);
                          if (next.has(index)) {
                            next.delete(index);
                          } else {
                            next.add(index);
                          }
                          update({
                            schedule: {
                              ...schedule,
                              days: [...next].sort((left, right) => left - right),
                            },
                          });
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <label>
                Every (minutes)
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={schedule.intervalMinutes}
                  onChange={(event) =>
                    update({
                      schedule: {
                        ...schedule,
                        intervalMinutes: Math.max(5, Number.parseInt(event.target.value, 10) || 5),
                      },
                    })
                  }
                />
              </label>
            )}
          </section>

          <footer className="job-editor-footer">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={onSave}>
              Create
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
