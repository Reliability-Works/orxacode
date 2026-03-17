import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionMessageBundle } from "@shared/ipc";
import type { JobRecord, JobRunRecord, JobTemplate } from "../components/JobsBoard";
import {
  BROWSER_MODE_TOOLS_POLICY,
  mergeModeToolPolicies,
} from "../lib/browser-tool-guardrails";

const JOBS_KEY = "orxa:jobs:v1";
const JOB_RUNS_KEY = "orxa:jobRuns:v1";

const DEFAULT_JOB_SCHEDULE: JobRecord["schedule"] = { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] };
const JOB_BROWSER_MODE_SYSTEM_ADDENDUM = [
  "Browser Mode is enabled in Orxa Code.",
  "To request browser automation, emit exactly one tag per action:",
  "<orxa_browser_action>{\"id\":\"unique-action-id\",\"action\":\"navigate\",\"args\":{\"url\":\"https://example.com\"}}</orxa_browser_action>",
  "Supported actions: open_tab, close_tab, switch_tab, navigate, back, forward, reload, click, type, press, scroll, extract_text, exists, visible, wait_for, wait_for_navigation, wait_for_idle, screenshot.",
  "For dynamic pages prefer robust locators in args.locator (selector/selectors/text/role/name/label/frameSelector/includeShadowDom/exact), plus timeoutMs/maxAttempts where needed.",
  "Prefer integrated Orxa browser actions over any external/headless browser tool for web tasks.",
  "Machine results are returned in assistant messages prefixed with [ORXA_BROWSER_RESULT].",
].join("\n");

const DEFAULT_JOB_TEMPLATES: JobTemplate[] = [
  {
    id: "weekly-release-notes",
    title: "Weekly release notes",
    description: "Draft weekly release notes from merged PRs and include links.",
    prompt:
      "Draft weekly release notes from merged PRs (include links when available). Scope only the last 7 days and group by feature, fix, and infra.",
    browserModeEnabled: false,
    icon: "book",
    schedule: { type: "daily", time: "09:00", days: [5] },
  },
  {
    id: "scan-bugs",
    title: "Scan recent commits for bugs",
    description: "Review recent commits and flag likely regressions with severity.",
    prompt:
      "Scan commits from the last 24h and list likely bugs, impact, and minimal fixes. Prioritize risky changes and include file references.",
    browserModeEnabled: false,
    icon: "bug",
    schedule: { type: "daily", time: "10:00", days: [1, 2, 3, 4, 5] },
  },
  {
    id: "security-audit",
    title: "Security scan findings",
    description: "Run a lightweight security review and summarize findings.",
    prompt:
      "Perform a focused security scan of recent changes and dependencies. Report exploitable paths, confidence, and remediation steps.",
    browserModeEnabled: false,
    icon: "shield",
    schedule: { type: "daily", time: "11:00", days: [1, 3, 5] },
  },
  {
    id: "ci-failures",
    title: "CI failure triage",
    description: "Summarize flaky failures and propose top fixes.",
    prompt: "Summarize CI failures in the last 24h, cluster root causes, and suggest top 3 fixes with owner recommendations.",
    browserModeEnabled: false,
    icon: "activity",
    schedule: { type: "daily", time: "09:30", days: [1, 2, 3, 4, 5] },
  },
  {
    id: "dependency-drift",
    title: "Dependency drift check",
    description: "Detect outdated dependencies and safe upgrade paths.",
    prompt:
      "Scan dependencies for security and compatibility drift; propose minimal safe updates and rollout order.",
    browserModeEnabled: false,
    icon: "package",
    schedule: { type: "interval", intervalMinutes: 1440 },
  },
  {
    id: "pr-quality",
    title: "PR quality digest",
    description: "Summarize recent PR quality trends and risks.",
    prompt:
      "Analyze merged PRs in the last week and summarize quality trends, hotspots, and high-risk areas for next sprint planning.",
    browserModeEnabled: false,
    icon: "sparkles",
    schedule: { type: "daily", time: "16:00", days: [5] },
  },
];

export type JobInput = {
  name: string;
  projectDir: string;
  prompt: string;
  browserModeEnabled?: boolean;
  agentMode?: JobRecord["agentMode"];
  schedule: JobRecord["schedule"];
  enabled?: boolean;
};

type UseJobsSchedulerOptions = {
  activeProjectDir?: string;
  onStatus?: (message: string) => void;
};

function createDraft(projectDir?: string, template?: JobTemplate): JobRecord {
  const now = Date.now();
  return {
    id: "",
    name: template?.title ?? "",
    projectDir: projectDir ?? "",
    prompt: template?.prompt ?? "",
    browserModeEnabled: template?.browserModeEnabled ?? false,
    agentMode: template?.agentMode ?? "opencode",
    schedule: template?.schedule ?? DEFAULT_JOB_SCHEDULE,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

function readStoredList<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredJobs() {
  const parsed = readStoredList<Partial<JobRecord>>(JOBS_KEY);
  return parsed.map((job) => ({
    ...job,
    browserModeEnabled: job.browserModeEnabled === true,
    agentMode: job.agentMode ?? "opencode",
  })) as JobRecord[];
}

function minutesSinceMidnight(timestamp: number) {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

function parseTimeToMinutes(value: string) {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function isSameCalendarDay(left: number, right: number) {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isJobDueNow(job: JobRecord, now: number) {
  if (!job.enabled) {
    return false;
  }

  if (job.schedule.type === "interval") {
    const intervalMs = Math.max(5, job.schedule.intervalMinutes) * 60_000;
    if (!job.lastRunAt) {
      return now - job.createdAt >= intervalMs;
    }
    return now - job.lastRunAt >= intervalMs;
  }

  const today = new Date(now).getDay();
  if (!job.schedule.days.includes(today)) {
    return false;
  }

  const targetMinutes = parseTimeToMinutes(job.schedule.time);
  const nowMinutes = minutesSinceMidnight(now);
  if (nowMinutes < targetMinutes) {
    return false;
  }

  if (!job.lastRunAt) {
    return true;
  }

  if (!isSameCalendarDay(job.lastRunAt, now)) {
    return true;
  }

  return minutesSinceMidnight(job.lastRunAt) < targetMinutes;
}

export function useJobsScheduler({ activeProjectDir, onStatus }: UseJobsSchedulerOptions = {}) {
  const [jobs, setJobs] = useState<JobRecord[]>(() => readStoredJobs());
  const [jobTemplates, setJobTemplates] = useState<JobTemplate[]>(DEFAULT_JOB_TEMPLATES);
  const [jobEditorOpen, setJobEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JobRecord | null>(null);
  const [jobRuns, setJobRuns] = useState<JobRunRecord[]>(() => readStoredList<JobRunRecord>(JOB_RUNS_KEY));
  const [jobRunViewer, setJobRunViewer] = useState<JobRunRecord | null>(null);
  const [jobRunViewerMessages, setJobRunViewerMessages] = useState<SessionMessageBundle[]>([]);
  const [jobRunViewerLoading, setJobRunViewerLoading] = useState(false);
  const runningJobIDsRef = useRef<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    setJobs(readStoredJobs());
    setJobRuns(readStoredList<JobRunRecord>(JOB_RUNS_KEY));
  }, []);

  const createJob = useCallback(
    async (job: JobInput) => {
      const trimmedName = job.name.trim();
      const trimmedProjectDir = job.projectDir.trim();
      const trimmedPrompt = job.prompt.trim();
      if (!trimmedName || !trimmedProjectDir || !trimmedPrompt) {
        onStatus?.("Name, workspace, and prompt are required");
        return;
      }

      const now = Date.now();
      setJobs((current) => [
        {
          id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
          name: trimmedName,
          projectDir: trimmedProjectDir,
          prompt: trimmedPrompt,
          browserModeEnabled: job.browserModeEnabled ?? false,
          agentMode: job.agentMode ?? "opencode",
          schedule: job.schedule,
          enabled: job.enabled ?? true,
          createdAt: now,
          updatedAt: now,
        },
        ...current,
      ]);
      onStatus?.("Job created");
    },
    [onStatus],
  );

  const openJobEditor = useCallback(
    (template?: JobTemplate) => {
      setEditingJob(createDraft(activeProjectDir, template));
      setJobEditorOpen(true);
    },
    [activeProjectDir],
  );

  const closeJobEditor = useCallback(() => {
    setJobEditorOpen(false);
    setEditingJob(null);
  }, []);

  const updateJobEditor = useCallback((next: JobRecord) => {
    setEditingJob(next);
  }, []);

  const saveJobEditor = useCallback(async () => {
    if (!editingJob) {
      return;
    }
    await createJob({
      name: editingJob.name,
      projectDir: editingJob.projectDir,
      prompt: editingJob.prompt,
      browserModeEnabled: editingJob.browserModeEnabled,
      agentMode: editingJob.agentMode,
      schedule: editingJob.schedule,
      enabled: editingJob.enabled,
    });
    setJobEditorOpen(false);
    setEditingJob(null);
  }, [createJob, editingJob]);

  const removeJob = useCallback(
    (id: string) => {
      setJobs((current) => current.filter((job) => job.id !== id));
      setJobRuns((current) => current.filter((run) => run.jobID !== id));
      onStatus?.("Job deleted");
    },
    [onStatus],
  );

  const toggleJobEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setJobs((current) =>
        current.map((job) =>
          job.id === id
            ? {
                ...job,
                enabled,
                updatedAt: Date.now(),
              }
            : job,
        ),
      );
      onStatus?.(enabled ? "Job resumed" : "Job paused");
    },
    [onStatus],
  );

  const runScheduledJob = useCallback(
    async (job: JobRecord) => {
      if (!job.enabled || runningJobIDsRef.current.has(job.id)) {
        return;
      }

      runningJobIDsRef.current.add(job.id);
      const runID = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const created = await window.orxa.opencode.createSession(job.projectDir, `Job: ${job.name}`);
        setJobRuns((current) => [
          {
            id: runID,
            jobID: job.id,
            jobName: job.name,
            projectDir: job.projectDir,
            sessionID: created.id,
            createdAt: Date.now(),
            status: "running",
            unread: false,
          },
          ...current,
        ]);

        await window.orxa.opencode.sendPrompt({
          directory: job.projectDir,
          sessionID: created.id,
          text: job.prompt,
          promptSource: "job",
          tools: mergeModeToolPolicies(
            job.browserModeEnabled ? BROWSER_MODE_TOOLS_POLICY : undefined,
          ),
          ...(job.browserModeEnabled ? { system: JOB_BROWSER_MODE_SYSTEM_ADDENDUM } : {}),
        });

        setJobs((current) =>
          current.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  lastRunAt: Date.now(),
                  updatedAt: Date.now(),
                }
              : item,
          ),
        );

        const startedAt = Date.now();
        let runCompleted = false;
        while (Date.now() - startedAt < 180_000) {
          const snapshot = await window.orxa.opencode.refreshProject(job.projectDir);
          const status = snapshot.sessionStatus[created.id]?.type ?? "idle";
          if (status === "idle") {
            runCompleted = true;
            break;
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1200);
          });
        }

        if (!runCompleted) {
          throw new Error("Timed out waiting for job output");
        }

        setJobRuns((current) =>
          current.map((run) =>
            run.id === runID
              ? {
                  ...run,
                  status: "completed",
                  completedAt: Date.now(),
                  unread: true,
                }
              : run,
          ),
        );
        onStatus?.(`Job completed: ${job.name}`);
      } catch (error) {
        setJobRuns((current) =>
          current.map((run) =>
            run.id === runID
              ? {
                  ...run,
                  status: "failed",
                  unread: true,
                  completedAt: Date.now(),
                  error: error instanceof Error ? error.message : String(error),
                }
              : run,
          ),
        );
        onStatus?.(error instanceof Error ? `Job failed (${job.name}): ${error.message}` : `Job failed (${job.name})`);
      } finally {
        runningJobIDsRef.current.delete(job.id);
      }
    },
    [onStatus],
  );

  const checkDueJobs = useCallback(async () => {
    const now = Date.now();
    for (const job of jobs) {
      if (isJobDueNow(job, now)) {
        void runScheduledJob(job);
      }
    }
  }, [jobs, runScheduledJob]);

  const markAllJobRunsRead = useCallback(() => {
    setJobRuns((current) =>
      current.map((run) =>
        run.unread
          ? {
              ...run,
              unread: false,
            }
          : run,
      ),
    );
  }, []);

  const openJobRunViewer = useCallback(
    async (runID: string) => {
      const run = jobRuns.find((item) => item.id === runID);
      if (!run) {
        return;
      }
      setJobRunViewer(run);
      setJobRunViewerLoading(true);
      setJobRunViewerMessages([]);
      setJobRuns((current) =>
        current.map((item) =>
          item.id === runID
            ? {
                ...item,
                unread: false,
              }
            : item,
        ),
      );
      try {
        const messagesForRun = await window.orxa.opencode.loadMessages(run.projectDir, run.sessionID);
        setJobRunViewerMessages(messagesForRun);
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : String(error));
      } finally {
        setJobRunViewerLoading(false);
      }
    },
    [jobRuns, onStatus],
  );

  const closeJobRunViewer = useCallback(() => {
    setJobRunViewer(null);
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }, [jobs]);

  useEffect(() => {
    window.localStorage.setItem(JOB_RUNS_KEY, JSON.stringify(jobRuns.slice(0, 300)));
  }, [jobRuns]);

  useEffect(() => {
    if (jobs.length === 0) {
      return;
    }

    void checkDueJobs();
    const timer = window.setInterval(() => {
      void checkDueJobs();
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [jobs.length, checkDueJobs]);

  const jobDraft = useMemo(() => editingJob ?? createDraft(activeProjectDir), [activeProjectDir, editingJob]);
  const unreadJobRunsCount = useMemo(
    () => jobRuns.filter((run) => run.unread && run.status !== "running").length,
    [jobRuns],
  );

  return {
    jobs,
    setJobs,
    jobTemplates,
    setJobTemplates,
    jobEditorOpen,
    setJobEditorOpen,
    editingJob,
    setEditingJob,
    jobDraft,
    jobRuns,
    setJobRuns,
    unreadJobRunsCount,
    jobRunViewer,
    jobRunViewerMessages,
    jobRunViewerLoading,
    loadJobs,
    createJob,
    openJobEditor,
    closeJobEditor,
    updateJobEditor,
    saveJobEditor,
    removeJob,
    toggleJobEnabled,
    runScheduledJob,
    checkDueJobs,
    markAllJobRunsRead,
    openJobRunViewer,
    closeJobRunViewer,
  };
}
