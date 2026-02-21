import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { Part, QuestionAnswer } from "@opencode-ai/sdk/v2/client";
import { parse as parseJsonc } from "jsonc-parser";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Ellipsis,
  Fingerprint,
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Pin,
  PinOff,
  Pencil,
  Search as SearchIcon,
  Send,
  Upload,
} from "lucide-react";
import type {
  AgentsDocument,
  GitBranchState,
  ProjectListItem,
  ProjectBootstrap,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  SkillEntry,
  SessionMessageBundle,
} from "@shared/ipc";
import { IconButton } from "./components/IconButton";
import { HomeDashboard } from "./components/HomeDashboard";
import { MessageFeed } from "./components/MessageFeed";
import { ProfileModal } from "./components/ProfileModal";
import { ProjectDashboard } from "./components/ProjectDashboard";
import { ProjectFilesPanel } from "./components/ProjectFilesPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { TerminalPanel } from "./components/TerminalPanel";
import { JobEditorModal, JobsBoard, type JobRecord, type JobRunRecord, type JobTemplate } from "./components/JobsBoard";
import { SkillsBoard } from "./components/SkillsBoard";
import { findFallbackModel, listAgentOptions, listModelOptions, listModelOptionsFromConfig, type ModelOption } from "./lib/models";
import antigravityLogo from "./assets/app-icons/antigravity.png";
import cursorLogo from "./assets/app-icons/cursor.png";
import finderLogo from "./assets/app-icons/finder.png";
import ghosttyLogo from "./assets/app-icons/ghostty.png";
import terminalLogo from "./assets/app-icons/terminal.png";
import xcodeLogo from "./assets/app-icons/xcode.png";
import zedLogo from "./assets/app-icons/zed.png";

const INITIAL_RUNTIME: RuntimeState = {
  status: "disconnected",
  managedServer: false,
};

type AppPreferences = {
  showOperationsPane: boolean;
  autoOpenTerminalOnCreate: boolean;
  confirmDangerousActions: boolean;
  commitGuidancePrompt: string;
};

type CommitNextStep = "commit" | "commit_and_push" | "commit_and_create_pr";

type OpenTarget = "cursor" | "antigravity" | "finder" | "terminal" | "ghostty" | "xcode" | "zed";
type SidebarMode = "projects" | "jobs" | "skills";

const DEFAULT_COMMIT_GUIDANCE_PROMPT = [
  "Write a high-quality conventional commit message.",
  "Use this format:",
  "1) First line: <type>(optional-scope): concise summary in imperative mood.",
  "2) Blank line.",
  "3) Body bullets grouped by area, clearly describing what changed and why.",
  "4) Mention notable side effects, risk, and follow-up work if relevant.",
  "5) Keep it specific to the included diff and avoid generic phrasing.",
].join("\n");

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  showOperationsPane: true,
  autoOpenTerminalOnCreate: true,
  confirmDangerousActions: true,
  commitGuidancePrompt: DEFAULT_COMMIT_GUIDANCE_PROMPT,
};

const APP_PREFERENCES_KEY = "orxa:appPreferences:v1";
const PINNED_SESSIONS_KEY = "orxa:pinnedSessions:v1";
const OPEN_TARGET_KEY = "orxa:openTarget:v1";
const JOBS_KEY = "orxa:jobs:v1";
const JOB_RUNS_KEY = "orxa:jobRuns:v1";
const SIDEBAR_LEFT_WIDTH_KEY = "orxa:leftPaneWidth:v1";
const SIDEBAR_RIGHT_WIDTH_KEY = "orxa:rightPaneWidth:v1";

type ComposerAttachment = {
  url: string;
  filename: string;
  mime: string;
  path: string;
};

type DashboardState = {
  loading: boolean;
  updatedAt?: number;
  error?: string;
  recentSessions: Array<{
    id: string;
    title: string;
    project: string;
    updatedAt: number;
  }>;
  sessions7d: number;
  sessions30d: number;
  projects: number;
  providersConnected: number;
  topModels: Array<{
    model: string;
    count: number;
  }>;
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  daySeries: Array<{
    label: string;
    count: number;
  }>;
};

type ProjectDashboardState = {
  loading: boolean;
  updatedAt?: number;
  error?: string;
  sessions7d: number;
  sessions30d: number;
  sessionCount: number;
  tokenInput30d: number;
  tokenOutput30d: number;
  tokenCacheRead30d: number;
  totalCost30d: number;
  topModels: Array<{
    model: string;
    count: number;
  }>;
  daySeries: Array<{
    label: string;
    count: number;
  }>;
  recentSessions: Array<{
    id: string;
    title: string;
    updatedAt: number;
    status: string;
  }>;
};

type ContextMenuState =
  | {
      kind: "project";
      x: number;
      y: number;
      directory: string;
      label: string;
    }
  | {
      kind: "session";
      x: number;
      y: number;
      directory: string;
      sessionID: string;
      title: string;
    }
  | null;

type ProjectSortMode = "updated" | "recent" | "alpha-asc" | "alpha-desc";

type OrxaTodoItem = {
  id: string;
  content: string;
  status?: string;
  priority?: string;
};

type OpenTargetOption = {
  id: OpenTarget;
  label: string;
  logo: string;
};

const OPEN_TARGETS: OpenTargetOption[] = [
  { id: "cursor", label: "Cursor", logo: cursorLogo },
  { id: "antigravity", label: "Antigravity", logo: antigravityLogo },
  { id: "finder", label: "Finder", logo: finderLogo },
  { id: "terminal", label: "Terminal", logo: terminalLogo },
  { id: "ghostty", label: "Ghostty", logo: ghosttyLogo },
  { id: "xcode", label: "Xcode", logo: xcodeLogo },
  { id: "zed", label: "Zed", logo: zedLogo },
];

const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: "weekly-release-notes",
    title: "Weekly release notes",
    description: "Draft weekly release notes from merged PRs and include links.",
    prompt:
      "Draft weekly release notes from merged PRs (include links when available). Scope only the last 7 days and group by feature, fix, and infra.",
    icon: "book",
    schedule: { type: "daily", time: "09:00", days: [5] },
  },
  {
    id: "scan-bugs",
    title: "Scan recent commits for bugs",
    description: "Review recent commits and flag likely regressions with severity.",
    prompt:
      "Scan commits from the last 24h and list likely bugs, impact, and minimal fixes. Prioritize risky changes and include file references.",
    icon: "bug",
    schedule: { type: "daily", time: "10:00", days: [1, 2, 3, 4, 5] },
  },
  {
    id: "security-audit",
    title: "Security scan findings",
    description: "Run a lightweight security review and summarize findings.",
    prompt:
      "Perform a focused security scan of recent changes and dependencies. Report exploitable paths, confidence, and remediation steps.",
    icon: "shield",
    schedule: { type: "daily", time: "11:00", days: [1, 3, 5] },
  },
  {
    id: "ci-failures",
    title: "CI failure triage",
    description: "Summarize flaky failures and propose top fixes.",
    prompt: "Summarize CI failures in the last 24h, cluster root causes, and suggest top 3 fixes with owner recommendations.",
    icon: "activity",
    schedule: { type: "daily", time: "09:30", days: [1, 2, 3, 4, 5] },
  },
  {
    id: "dependency-drift",
    title: "Dependency drift check",
    description: "Detect outdated dependencies and safe upgrade paths.",
    prompt:
      "Scan dependencies for security and compatibility drift; propose minimal safe updates and rollout order.",
    icon: "package",
    schedule: { type: "interval", intervalMinutes: 1440 },
  },
  {
    id: "pr-quality",
    title: "PR quality digest",
    description: "Summarize recent PR quality trends and risks.",
    prompt:
      "Analyze merged PRs in the last week and summarize quality trends, hotspots, and high-risk areas for next sprint planning.",
    icon: "sparkles",
    schedule: { type: "daily", time: "16:00", days: [5] },
  },
];

function truncateLabel(value: string, maxLength = 19) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function shouldAutoRenameSessionTitle(title: string | undefined) {
  if (!title) {
    return true;
  }
  const normalized = title.trim().toLowerCase();
  return normalized === "" || normalized === "new session" || normalized === "untitled session";
}

function deriveSessionTitleFromPrompt(prompt: string, maxLength = 56) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, "")
    .trim();
  if (!cleaned) {
    return "New session";
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned;
}

function clampContextMenuPosition(x: number, y: number) {
  const menuWidth = 240;
  const menuHeight = 220;
  const padding = 8;
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  };
}

function buildDaySeries(points: Array<{ timestamp: number; value: number }>) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const slots = Array.from({ length: 7 }, (_, reverseIndex) => {
    const index = 6 - reverseIndex;
    const start = now - (index + 1) * MS_PER_DAY;
    const end = start + MS_PER_DAY;
    return {
      start,
      end,
      label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: 0,
    };
  });

  for (const point of points) {
    const slot = slots.find((item) => point.timestamp >= item.start && point.timestamp < item.end);
    if (slot) {
      slot.count += point.value;
    }
  }

  return slots.map((item) => ({ label: item.label, count: item.count }));
}

function summarizeStepFinishParts(parts: Part[]) {
  let tokenInput = 0;
  let tokenOutput = 0;
  let tokenCacheRead = 0;
  let cost = 0;
  let count = 0;
  let totalTokens = 0;

  for (const part of parts) {
    if (part.type !== "step-finish") {
      continue;
    }
    tokenInput += part.tokens.input ?? 0;
    tokenOutput += part.tokens.output ?? 0;
    tokenCacheRead += part.tokens.cache.read ?? 0;
    totalTokens += (part.tokens.input ?? 0) + (part.tokens.output ?? 0);
    cost += part.cost ?? 0;
    count += 1;
  }

  return {
    tokenInput,
    tokenOutput,
    tokenCacheRead,
    totalTokens,
    cost,
    count,
  };
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

function parseTodoItemsFromValue(value: unknown): OrxaTodoItem[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseTodoItemsFromValue(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    const items: OrxaTodoItem[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as { content?: unknown; status?: unknown; priority?: unknown; id?: unknown };
      const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
      if (!content) {
        continue;
      }
      const status = typeof candidate.status === "string" ? candidate.status : undefined;
      const priority = typeof candidate.priority === "string" ? candidate.priority : undefined;
      const id = typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : `${content}:${index}`;
      items.push({ id, content, status, priority });
    }
    return items;
  }

  if (value && typeof value === "object") {
    const candidate = value as { todos?: unknown; items?: unknown };
    if (candidate.todos) {
      return parseTodoItemsFromValue(candidate.todos);
    }
    if (candidate.items) {
      return parseTodoItemsFromValue(candidate.items);
    }
  }

  return [];
}

function extractOrxaTodos(messages: SessionMessageBundle[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const bundle = messages[messageIndex];
    for (let partIndex = bundle.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = bundle.parts[partIndex];
      if (part.type !== "tool" || !part.tool.toLowerCase().includes("todo")) {
        continue;
      }
      const state = part.state as { output?: unknown; input?: unknown };
      const fromOutput = parseTodoItemsFromValue(state.output);
      if (fromOutput.length > 0) {
        return fromOutput;
      }
      const fromInput = parseTodoItemsFromValue(state.input);
      if (fromInput.length > 0) {
        return fromInput;
      }
    }
  }
  return [];
}

export default function App() {
  const [appPreferences, setAppPreferences] = useState<AppPreferences>(() => {
    try {
      const raw = window.localStorage.getItem(APP_PREFERENCES_KEY);
      if (!raw) {
        return DEFAULT_APP_PREFERENCES;
      }
      const parsed = JSON.parse(raw) as Partial<AppPreferences>;
      return {
        ...DEFAULT_APP_PREFERENCES,
        ...parsed,
      };
    } catch {
      return DEFAULT_APP_PREFERENCES;
    }
  });
  const [runtime, setRuntime] = useState<RuntimeState>(INITIAL_RUNTIME);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("projects");
  const [profiles, setProfiles] = useState<RuntimeProfile[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProjectDir, setActiveProjectDir] = useState<string | undefined>();
  const [projectData, setProjectData] = useState<ProjectBootstrap | null>(null);
  const [activeSessionID, setActiveSessionID] = useState<string | undefined>();
  const [messages, setMessages] = useState<SessionMessageBundle[]>([]);
  const [composer, setComposer] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalPtyID, setTerminalPtyID] = useState<string | undefined>();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setStatusLine] = useState<string>("Ready");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSortOpen, setProjectSortOpen] = useState(false);
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>("updated");
  const [allSessionsModalOpen, setAllSessionsModalOpen] = useState(false);
  const [projectsSidebarVisible, setProjectsSidebarVisible] = useState(true);
  const [leftPaneWidth, setLeftPaneWidth] = useState<number>(() => {
    const parsed = Number(window.localStorage.getItem(SIDEBAR_LEFT_WIDTH_KEY));
    return Number.isFinite(parsed) && parsed >= 230 ? parsed : 300;
  });
  const [rightPaneWidth, setRightPaneWidth] = useState<number>(() => {
    const parsed = Number(window.localStorage.getItem(SIDEBAR_RIGHT_WIDTH_KEY));
    return Number.isFinite(parsed) && parsed >= 280 ? parsed : 340;
  });
  const [jobs, setJobs] = useState<JobRecord[]>(() => {
    try {
      const raw = window.localStorage.getItem(JOBS_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as JobRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [jobRuns, setJobRuns] = useState<JobRunRecord[]>(() => {
    try {
      const raw = window.localStorage.getItem(JOB_RUNS_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as JobRunRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [jobRunViewer, setJobRunViewer] = useState<JobRunRecord | null>(null);
  const [jobRunViewerMessages, setJobRunViewerMessages] = useState<SessionMessageBundle[]>([]);
  const [jobRunViewerLoading, setJobRunViewerLoading] = useState(false);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [jobDraft, setJobDraft] = useState<JobRecord>({
    id: "",
    name: "",
    projectDir: "",
    prompt: "",
    schedule: { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] },
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | undefined>();
  const [skillUseModal, setSkillUseModal] = useState<{ skill: SkillEntry; projectDir: string } | null>(null);
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, string[]>>(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed;
    } catch {
      return {};
    }
  });
  const [configModelOptions, setConfigModelOptions] = useState<ModelOption[]>([]);
  const [orxaModels, setOrxaModels] = useState<{ orxa?: string; plan?: string }>({});
  const [orxaPrompts, setOrxaPrompts] = useState<{ orxa?: string; plan?: string }>({});
  const [opsPanelTab, setOpsPanelTab] = useState<"operations" | "git" | "files">("operations");
  const [gitPanelTab, setGitPanelTab] = useState<"diff" | "log" | "issues" | "prs">("diff");
  const [gitPanelOutput, setGitPanelOutput] = useState("Select DIFF or LOG.");
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [preferredOpenTarget, setPreferredOpenTarget] = useState<OpenTarget>(() => {
    try {
      const raw = window.localStorage.getItem(OPEN_TARGET_KEY);
      const available = new Set<OpenTarget>(OPEN_TARGETS.map((target) => target.id));
      if (raw && available.has(raw as OpenTarget)) {
        return raw as OpenTarget;
      }
    } catch {
      // no-op
    }
    return "finder";
  });
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitIncludeUnstaged, setCommitIncludeUnstaged] = useState(true);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [commitNextStep, setCommitNextStep] = useState<CommitNextStep>("commit");
  const [commitSummary, setCommitSummary] = useState<{
    branch: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    repoRoot: string;
  } | null>(null);
  const [commitSummaryLoading, setCommitSummaryLoading] = useState(false);
  const [commitSubmitting, setCommitSubmitting] = useState(false);
  const [branchState, setBranchState] = useState<GitBranchState | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [permissionDecisionPending, setPermissionDecisionPending] = useState<"once" | "always" | "reject" | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [dashboard, setDashboard] = useState<DashboardState>({
    loading: false,
    recentSessions: [],
    sessions7d: 0,
    sessions30d: 0,
    projects: 0,
    providersConnected: 0,
    topModels: [],
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
    daySeries: buildDaySeries([]),
  });
  const [projectDashboard, setProjectDashboard] = useState<ProjectDashboardState>({
    loading: false,
    sessions7d: 0,
    sessions30d: 0,
    sessionCount: 0,
    tokenInput30d: 0,
    tokenOutput30d: 0,
    tokenCacheRead30d: 0,
    totalCost30d: 0,
    topModels: [],
    daySeries: buildDaySeries([]),
    recentSessions: [],
  });
  const [agentsDocument, setAgentsDocument] = useState<AgentsDocument | null>(null);
  const [agentsDraft, setAgentsDraft] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsSaving, setAgentsSaving] = useState(false);
  const hasProjectContext = Boolean(activeProjectDir) && sidebarMode === "projects";
  const showProjectsPane = !hasProjectContext || projectsSidebarVisible;
  const showOperationsPane = hasProjectContext && sidebarMode === "projects" && appPreferences.showOperationsPane;

  const refreshTimer = useRef<number | undefined>(undefined);
  const responsePollTimer = useRef<number | undefined>(undefined);
  const resizeStateRef = useRef<null | { side: "left" | "right"; startX: number; startWidth: number }>(null);
  const activeProjectDirRef = useRef<string | undefined>(undefined);
  const projectSearchInputRef = useRef<HTMLInputElement | null>(null);
  const branchSearchInputRef = useRef<HTMLInputElement | null>(null);
  const terminalAutoCreateTried = useRef(false);
  const runningJobIDsRef = useRef<Set<string>>(new Set());
  const messageCacheRef = useRef<Record<string, SessionMessageBundle[]>>({});
  const projectLastOpenedRef = useRef<Record<string, number>>({});
  const projectLastUpdatedRef = useRef<Record<string, number>>({});

  const agentOptions = useMemo(() => listAgentOptions(projectData?.agents ?? []), [projectData?.agents]);
  const serverModelOptions = useMemo(
    () => listModelOptions(projectData?.providers ?? { all: [], connected: [], default: {} }),
    [projectData],
  );
  const modelOptions = useMemo(() => {
    const merged = [...serverModelOptions];
    for (const model of configModelOptions) {
      if (!merged.some((item) => item.key === model.key)) {
        merged.push(model);
      }
    }
    return merged.sort((a, b) => a.key.localeCompare(b.key));
  }, [configModelOptions, serverModelOptions]);
  const preferredAgentModel = useMemo(() => {
    if (selectedAgent === "plan") {
      return orxaModels.plan;
    }
    if (selectedAgent === "orxa") {
      return orxaModels.orxa;
    }
    return undefined;
  }, [orxaModels.orxa, orxaModels.plan, selectedAgent]);
  const selectedAgentDefinition = useMemo(
    () => agentOptions.find((agent) => agent.name === selectedAgent),
    [agentOptions, selectedAgent],
  );
  const serverAgentNames = useMemo(() => new Set(agentOptions.map((agent) => agent.name)), [agentOptions]);
  const hasPlanAgent = useMemo(
    () => serverAgentNames.has("plan") || Boolean(orxaModels.plan) || Boolean(orxaPrompts.plan),
    [serverAgentNames, orxaModels.plan, orxaPrompts.plan],
  );
  const hasOrxaAgent = useMemo(
    () => serverAgentNames.has("orxa") || Boolean(orxaModels.orxa) || Boolean(orxaPrompts.orxa),
    [serverAgentNames, orxaModels.orxa, orxaPrompts.orxa],
  );
  const isPlanMode = selectedAgent === "plan";
  const modelOptionsForAgent = useMemo(() => {
    if (selectedAgent === "orxa" && orxaModels.orxa) {
      const exact = modelOptions.filter((item) => item.key === orxaModels.orxa);
      return exact.length > 0 ? exact : modelOptions;
    }
    if (selectedAgent === "plan" && orxaModels.plan) {
      const exact = modelOptions.filter((item) => item.key === orxaModels.plan);
      return exact.length > 0 ? exact : modelOptions;
    }
    return modelOptions;
  }, [modelOptions, orxaModels.orxa, orxaModels.plan, selectedAgent]);
  const modelSelectOptions = useMemo(() => {
    const items = [...modelOptionsForAgent];
    const extras = [preferredAgentModel, selectedModel].filter((value): value is string => Boolean(value));
    for (const key of extras) {
      if (items.some((item) => item.key === key)) {
        continue;
      }
      const [providerID, ...modelParts] = key.split("/");
      const modelID = modelParts.join("/");
      if (!providerID || !modelID) {
        continue;
      }
      items.unshift({
        key,
        providerID,
        modelID,
        providerName: providerID,
        modelName: modelID,
        variants: [],
      });
    }
    return items;
  }, [modelOptionsForAgent, preferredAgentModel, selectedModel]);
  const variantOptions = useMemo(() => {
    const model = modelSelectOptions.find((item) => item.key === selectedModel);
    return model?.variants ?? [];
  }, [selectedModel, modelSelectOptions]);
  const modelDisplayValue = useMemo(() => {
    const selected = modelSelectOptions.find((item) => item.key === selectedModel);
    if (selected) {
      return `${selected.providerName}/${selected.modelName}`;
    }
    return "Model";
  }, [modelSelectOptions, selectedModel]);
  const variantDisplayValue = selectedVariant && selectedVariant.trim().length > 0 ? selectedVariant : "(default)";
  const modelSelectWidthCh = useMemo(() => Math.max(18, Math.min(44, modelDisplayValue.length + 4)), [modelDisplayValue]);
  const variantSelectWidthCh = useMemo(() => Math.max(12, Math.min(24, variantDisplayValue.length + 4)), [variantDisplayValue]);
  const branchDisplayValue = useMemo(() => {
    if (branchLoading) {
      return "Loading branch...";
    }
    return branchState?.current || "Branch";
  }, [branchLoading, branchState]);
  const branchControlWidthCh = useMemo(() => Math.max(12, Math.min(30, branchDisplayValue.length + 5)), [branchDisplayValue]);
  const filteredBranches = useMemo(() => {
    const query = branchQuery.trim().toLowerCase();
    const branches = branchState?.branches ?? [];
    if (!query) {
      return branches;
    }
    return branches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchQuery, branchState]);
  const selectedModelPayload = useMemo(() => {
    if (!selectedModel) {
      return undefined;
    }
    const [providerID, ...modelParts] = selectedModel.split("/");
    const modelID = modelParts.join("/");
    if (!providerID || !modelID) {
      return undefined;
    }
    return { providerID, modelID };
  }, [selectedModel]);

  const refreshProfiles = useCallback(async () => {
    const [nextRuntime, nextProfiles] = await Promise.all([window.orxa.runtime.getState(), window.orxa.runtime.listProfiles()]);
    setRuntime(nextRuntime);
    setProfiles(nextProfiles);
  }, []);

  const refreshOrxaState = useCallback(async () => {
    try {
      const [doc, orxaPrompt, planPrompt] = await Promise.all([
        window.orxa.opencode.readOrxaConfig(),
        window.orxa.opencode.readOrxaAgentPrompt("orxa"),
        window.orxa.opencode.readOrxaAgentPrompt("plan"),
      ]);
      const parsed = parseJsonc(doc.content) as {
        model?: string;
        small_model?: string;
        orxa?: { model?: string };
        plan?: { model?: string };
      };
      setOrxaModels({
        orxa: parsed.orxa?.model ?? parsed.model,
        plan: parsed.plan?.model ?? parsed.small_model,
      });
      setOrxaPrompts({
        orxa: orxaPrompt,
        plan: planPrompt,
      });
    } catch {
      setOrxaModels({});
      setOrxaPrompts({});
    }
  }, []);

  const refreshConfigModels = useCallback(async () => {
    try {
      const doc = await window.orxa.opencode.readRawConfig("global");
      const parsed = parseJsonc(doc.content) as unknown;
      setConfigModelOptions(listModelOptionsFromConfig(parsed));
    } catch {
      setConfigModelOptions([]);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const result = await window.orxa.opencode.bootstrap();
      setProjects(result.projects);
      setRuntime(result.runtime);
      if (activeProjectDir && !result.projects.some((item) => item.worktree === activeProjectDir)) {
        setActiveProjectDir(undefined);
        setProjectData(null);
        setActiveSessionID(undefined);
        setMessages([]);
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const refreshProject = useCallback(
    async (directory: string) => {
      try {
        const data = await window.orxa.opencode.refreshProject(directory);
        setProjectData(data);
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        projectLastUpdatedRef.current[directory] = lastUpdated;

        const sortedSessions = [...data.sessions].sort((a, b) => b.time.updated - a.time.updated);
        let nextSessionID = activeSessionID;
        if (nextSessionID && !sortedSessions.some((item) => item.id === nextSessionID)) {
          nextSessionID = undefined;
          setActiveSessionID(undefined);
          setMessages([]);
        }

        if (!terminalPtyID || !data.ptys.some((item) => item.id === terminalPtyID)) {
          setTerminalPtyID(data.ptys[0]?.id);
        }

        if (nextSessionID) {
          const cacheKey = `${directory}:${nextSessionID}`;
          const cached = messageCacheRef.current[cacheKey];
          if (cached) {
            setMessages(cached);
          }
          const latest = await window.orxa.opencode.loadMessages(directory, nextSessionID).catch(() => undefined);
          if (latest) {
            messageCacheRef.current[cacheKey] = latest;
            setMessages(latest);
          }
        }

        return data;
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    [activeSessionID, terminalPtyID],
  );

  const selectProject = useCallback(
    async (directory: string) => {
      try {
        setStatusLine(`Loading workspace ${directory}`);
        setProjectData(null);
        setMessages([]);
        setActiveSessionID(undefined);
        setTerminalPtyID(undefined);
        setActiveProjectDir(directory);
        setSidebarMode("projects");
        setCollapsedProjects((current) => ({ ...current, [directory]: false }));
        const data = await window.orxa.opencode.selectProject(directory);
        setProjectData(data);
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        projectLastUpdatedRef.current[directory] = lastUpdated;
        projectLastOpenedRef.current[directory] = Date.now();

        setTerminalPtyID(data.ptys[0]?.id);
        setActiveSessionID(undefined);
        setMessages([]);
        setStatusLine(`Loaded ${directory}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [],
  );

  const openWorkspaceDashboard = useCallback(() => {
    setSidebarMode("projects");
    setActiveProjectDir(undefined);
    setProjectData(null);
    setActiveSessionID(undefined);
    setMessages([]);
    setTerminalOpen(false);
    setTerminalPtyID(undefined);
    setStatusLine("Workspace dashboard");
  }, []);

  const refreshMessages = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      setMessages([]);
      return;
    }

    try {
      const cacheKey = `${activeProjectDir}:${activeSessionID}`;
      const cached = messageCacheRef.current[cacheKey];
      if (cached) {
        setMessages(cached);
      } else {
        setMessages([]);
      }
      const items = await window.orxa.opencode.loadMessages(activeProjectDir, activeSessionID);
      messageCacheRef.current[cacheKey] = items;
      setMessages(items);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID]);

  const openSession = useCallback(
    (sessionID: string) => {
      if (!activeProjectDir) {
        return;
      }
      setActiveSessionID(sessionID);
      const cacheKey = `${activeProjectDir}:${sessionID}`;
      const cached = messageCacheRef.current[cacheKey];
      setMessages(cached ?? []);
      void window.orxa.opencode
        .loadMessages(activeProjectDir, sessionID)
        .then((items) => {
          messageCacheRef.current[cacheKey] = items;
          setMessages(items);
        })
        .catch(() => undefined);
    },
    [activeProjectDir],
  );

  const queueRefresh = useCallback(
    (reason: string) => {
      if (!activeProjectDir) {
        return;
      }

      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        void refreshProject(activeProjectDir)
          .then(() => {
            void refreshMessages();
            setStatusLine(reason);
          })
          .catch(() => undefined);
      }, 180);
    },
    [activeProjectDir, refreshProject, refreshMessages],
  );

  useEffect(() => {
    activeProjectDirRef.current = activeProjectDir;
  }, [activeProjectDir]);

  const stopResponsePolling = useCallback(() => {
    if (responsePollTimer.current) {
      window.clearTimeout(responsePollTimer.current);
      responsePollTimer.current = undefined;
    }
  }, []);

  const startResponsePolling = useCallback(
    (directory: string, sessionID: string) => {
      stopResponsePolling();
      const startedAt = Date.now();
      const tick = () => {
        if (activeProjectDirRef.current !== directory) {
          stopResponsePolling();
          return;
        }

        void refreshProject(directory)
          .then((next) => {
            void refreshMessages();
            const status = next.sessionStatus[sessionID];
            const done = status?.type === "idle";
            const timedOut = Date.now() - startedAt > 120_000;
            if (done || timedOut) {
              stopResponsePolling();
              return;
            }
            responsePollTimer.current = window.setTimeout(tick, 900);
          })
          .catch(() => {
            const timedOut = Date.now() - startedAt > 30_000;
            if (timedOut) {
              stopResponsePolling();
              return;
            }
            responsePollTimer.current = window.setTimeout(tick, 1300);
          });
      };

      responsePollTimer.current = window.setTimeout(tick, 900);
    },
    [refreshMessages, refreshProject, stopResponsePolling],
  );

  useEffect(() => {
    return () => {
      stopResponsePolling();
    };
  }, [stopResponsePolling]);

  useEffect(() => {
    window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(appPreferences));
  }, [appPreferences]);

  useEffect(() => {
    window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pinnedSessions));
  }, [pinnedSessions]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_TARGET_KEY, preferredOpenTarget);
  }, [preferredOpenTarget]);

  useEffect(() => {
    window.localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  }, [jobs]);

  useEffect(() => {
    window.localStorage.setItem(JOB_RUNS_KEY, JSON.stringify(jobRuns.slice(0, 300)));
  }, [jobRuns]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_LEFT_WIDTH_KEY, String(Math.round(leftPaneWidth)));
  }, [leftPaneWidth]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_RIGHT_WIDTH_KEY, String(Math.round(rightPaneWidth)));
  }, [rightPaneWidth]);

  useEffect(() => {
    void refreshProfiles()
      .then(() => Promise.all([bootstrap(), refreshOrxaState(), refreshConfigModels()]))
      .catch((error) => setStatusLine(error instanceof Error ? error.message : String(error)));
  }, [bootstrap, refreshConfigModels, refreshOrxaState, refreshProfiles]);

  useEffect(() => {
    if (!activeSessionID || !activeProjectDir) {
      setMessages([]);
      return;
    }

    void refreshMessages();
  }, [activeProjectDir, activeSessionID, refreshMessages]);

  useEffect(() => {
    const preferredModel = selectedAgentDefinition?.model ?? preferredAgentModel ?? projectData?.config.model;
    const fallback = findFallbackModel(modelSelectOptions, selectedModel ?? preferredModel);
    if (!selectedModel) {
      setSelectedModel(preferredModel ?? fallback?.key);
    } else if (!modelSelectOptions.some((item) => item.key === selectedModel) && preferredModel) {
      setSelectedModel(preferredModel);
    }

    const available = new Set(agentOptions.map((item) => item.name));
    if (hasOrxaAgent) {
      available.add("orxa");
    }
    if (hasPlanAgent) {
      available.add("plan");
    }

    if (!selectedAgent || !available.has(selectedAgent)) {
      const preferred = hasOrxaAgent ? "orxa" : (agentOptions[0]?.name ?? (hasPlanAgent ? "plan" : undefined));
      setSelectedAgent(preferred);
    }
  }, [
    agentOptions,
    hasOrxaAgent,
    hasPlanAgent,
    modelSelectOptions,
    preferredAgentModel,
    projectData?.config.model,
    selectedAgent,
    selectedAgentDefinition?.model,
    selectedModel,
  ]);

  useEffect(() => {
    const events = window.orxa?.events;
    if (!events) {
      setStatusLine("Desktop bridge unavailable. Restart OrxaCode to reconnect.");
      return;
    }

    const unsubscribe = events.subscribe((event) => {
      if (event.type === "runtime.status") {
        setRuntime(event.payload);
      }

      if (event.type === "runtime.error") {
        setStatusLine(event.payload.message);
      }

      if (event.type === "opencode.global") {
        if (event.payload.event.type === "project.updated" || event.payload.event.type === "global.disposed") {
          void bootstrap();
        }
      }

      if (event.type === "opencode.project") {
        if (event.payload.directory !== activeProjectDir) {
          return;
        }

        const kind = String(event.payload.event.type);
        if (
          kind === "message.created" ||
          kind === "session.created" ||
          kind === "session.updated" ||
          kind === "session.deleted" ||
          kind === "session.status" ||
          kind === "session.idle" ||
          kind === "session.error" ||
          kind === "message.updated" ||
          kind === "message.part.added" ||
          kind === "message.part.created" ||
          kind === "message.part.delta" ||
          kind === "message.part.updated" ||
          kind === "message.part.removed" ||
          kind === "message.removed" ||
          kind === "permission.asked" ||
          kind === "permission.replied" ||
          kind === "question.asked" ||
          kind === "question.replied" ||
          kind === "question.rejected" ||
          kind === "pty.created" ||
          kind === "pty.deleted"
        ) {
          queueRefresh(`Updated from event: ${kind}`);
        }

        if (kind === "session.error") {
          const eventValue = event.payload.event as unknown as { properties?: { error?: { message?: string } } };
          const message = eventValue.properties?.error?.message;
          if (message && message.trim().length > 0) {
            setStatusLine(message);
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [activeProjectDir, bootstrap, queueRefresh]);

  const activeProject = useMemo(() => projects.find((item) => item.worktree === activeProjectDir), [projects, activeProjectDir]);

  const sessions = useMemo(() => {
    if (!projectData) {
      return [];
    }
    const pinned = new Set(pinnedSessions[projectData.directory] ?? []);
    return [...projectData.sessions]
      .filter((item) => !item.time.archived)
      .sort((a, b) => {
        const aPinned = pinned.has(a.id) ? 1 : 0;
        const bPinned = pinned.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) {
          return bPinned - aPinned;
        }
        return b.time.updated - a.time.updated;
      });
  }, [pinnedSessions, projectData]);
  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      const name = (project.name || project.worktree.split("/").at(-1) || project.worktree).toLowerCase();
      return query ? name.includes(query) : true;
    });
    const withIndex = filtered.map((project, index) => ({ project, index }));
    withIndex.sort((left, right) => {
      const leftName = left.project.name || left.project.worktree.split("/").at(-1) || left.project.worktree;
      const rightName = right.project.name || right.project.worktree.split("/").at(-1) || right.project.worktree;
      if (projectSortMode === "alpha-asc") {
        return leftName.localeCompare(rightName);
      }
      if (projectSortMode === "alpha-desc") {
        return rightName.localeCompare(leftName);
      }
      if (projectSortMode === "recent") {
        const leftTime = projectLastOpenedRef.current[left.project.worktree] ?? 0;
        const rightTime = projectLastOpenedRef.current[right.project.worktree] ?? 0;
        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }
      }
      if (projectSortMode === "updated") {
        const leftTime = projectLastUpdatedRef.current[left.project.worktree] ?? 0;
        const rightTime = projectLastUpdatedRef.current[right.project.worktree] ?? 0;
        if (rightTime !== leftTime) {
          return rightTime - leftTime;
        }
      }
      return left.index - right.index;
    });
    return withIndex.map((item) => item.project);
  }, [projectSearchQuery, projectSortMode, projects]);
  const getSessionStatusType = useCallback(
    (sessionID: string, directory?: string) => {
      if (!directory || !projectData || projectData.directory !== directory) {
        return "idle";
      }
      return projectData.sessionStatus[sessionID]?.type ?? "idle";
    },
    [projectData],
  );

  const refreshDashboard = useCallback(async () => {
    setDashboard((current) => ({ ...current, loading: true, error: undefined, projects: projects.length }));
    if (projects.length === 0) {
      setDashboard({
        loading: false,
        updatedAt: Date.now(),
        recentSessions: [],
        sessions7d: 0,
        sessions30d: 0,
        projects: 0,
        providersConnected: 0,
        topModels: [],
        tokenInput30d: 0,
        tokenOutput30d: 0,
        tokenCacheRead30d: 0,
        totalCost30d: 0,
        daySeries: buildDaySeries([]),
      });
      return;
    }

    try {
      const snapshots = await Promise.all(
        projects.map(async (project) => {
          try {
            const data = await window.orxa.opencode.refreshProject(project.worktree);
            return { project, data };
          } catch {
            return { project, data: undefined };
          }
        }),
      );

      const sessionTimes: number[] = [];
      const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = [];
      const recentSessions: DashboardState["recentSessions"] = [];
      const connectedProviders = new Set<string>();
      const modelUsage = new Map<string, number>();
      const telemetryCandidates: Array<{ directory: string; sessionID: string; updatedAt: number }> = [];
      const now = Date.now();
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      let tokenInput30d = 0;
      let tokenOutput30d = 0;
      let tokenCacheRead30d = 0;
      let totalCost30d = 0;

      for (const snapshot of snapshots) {
        const data = snapshot.data;
        if (!data) {
          continue;
        }
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        projectLastUpdatedRef.current[snapshot.project.worktree] = lastUpdated;

        for (const provider of data.providers.connected) {
          connectedProviders.add(provider);
        }

        const modelHints = [data.config.model, data.config.small_model].filter((item): item is string => Boolean(item));
        for (const modelHint of modelHints) {
          modelUsage.set(modelHint, (modelUsage.get(modelHint) ?? 0) + 1);
        }

        for (const session of data.sessions) {
          sessionTimes.push(session.time.updated);
          if (session.time.updated >= thirtyDaysAgo) {
            telemetryCandidates.push({
              directory: data.directory,
              sessionID: session.id,
              updatedAt: session.time.updated,
            });
          }
          recentSessions.push({
            id: `${snapshot.project.id}:${session.id}`,
            title: session.title || session.slug,
            project: snapshot.project.name || snapshot.project.worktree.split("/").at(-1) || snapshot.project.worktree,
            updatedAt: session.time.updated,
          });
        }
      }

      for (const model of [orxaModels.orxa, orxaModels.plan].filter((item): item is string => Boolean(item))) {
        modelUsage.set(model, (modelUsage.get(model) ?? 0) + 1);
      }

      const recentTelemetrySessions = telemetryCandidates
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 60);

      if (recentTelemetrySessions.length > 0) {
        const telemetryMessages = await Promise.all(
          recentTelemetrySessions.map(async (candidate) => {
            try {
              const payload = await window.orxa.opencode.loadMessages(candidate.directory, candidate.sessionID);
              return payload;
            } catch {
              return [];
            }
          }),
        );

        for (let index = 0; index < telemetryMessages.length; index += 1) {
          const sessionMessages = telemetryMessages[index] ?? [];
          const fallbackTimestamp = recentTelemetrySessions[index]?.updatedAt ?? now;
          for (const message of sessionMessages) {
            const info = message.info as { role?: string; providerID?: string; modelID?: string };
            if (info.role === "assistant" && info.providerID && info.modelID) {
              const modelKey = `${info.providerID}/${info.modelID}`;
              modelUsage.set(modelKey, (modelUsage.get(modelKey) ?? 0) + 1);
            }
            const summary = summarizeStepFinishParts(message.parts);
            tokenInput30d += summary.tokenInput;
            tokenOutput30d += summary.tokenOutput;
            tokenCacheRead30d += summary.tokenCacheRead;
            totalCost30d += summary.cost;
            if (summary.totalTokens > 0) {
              const created = (message.info as { time?: { created?: number } }).time?.created;
              tokenSeriesPoints.push({
                timestamp: typeof created === "number" ? created : fallbackTimestamp,
                value: summary.totalTokens,
              });
            }
          }
        }
      }

      recentSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const sessions7d = sessionTimes.filter((time) => time >= sevenDaysAgo).length;
      const sessions30d = sessionTimes.filter((time) => time >= thirtyDaysAgo).length;
      const topModels = [...modelUsage.entries()]
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      setDashboard({
        loading: false,
        updatedAt: now,
        recentSessions,
        sessions7d,
        sessions30d,
        projects: projects.length,
        providersConnected: connectedProviders.size,
        topModels,
        tokenInput30d,
        tokenOutput30d,
        tokenCacheRead30d,
        totalCost30d,
        daySeries: buildDaySeries(tokenSeriesPoints),
      });
    } catch (error) {
      setDashboard((current) => ({
        ...current,
        loading: false,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [orxaModels.orxa, orxaModels.plan, projects]);

  const refreshProjectDashboard = useCallback(async () => {
    if (!activeProjectDir || !projectData) {
      setProjectDashboard({
        loading: false,
        sessions7d: 0,
        sessions30d: 0,
        sessionCount: 0,
        tokenInput30d: 0,
        tokenOutput30d: 0,
        tokenCacheRead30d: 0,
        totalCost30d: 0,
        topModels: [],
        daySeries: buildDaySeries([]),
        recentSessions: [],
      });
      return;
    }

    setProjectDashboard((current) => ({ ...current, loading: true, error: undefined }));

    try {
      const sessionsAll = [...projectData.sessions]
        .filter((item) => !item.time.archived)
        .sort((a, b) => b.time.updated - a.time.updated);
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

      const recentSessions = sessionsAll.slice(0, 4).map((session) => ({
        id: session.id,
        title: session.title || session.slug,
        updatedAt: session.time.updated,
        status: projectData.sessionStatus[session.id]?.type ?? "idle",
      }));

      const telemetryCandidates = sessionsAll
        .filter((session) => session.time.updated >= thirtyDaysAgo)
        .slice(0, 40);

      let tokenInput30d = 0;
      let tokenOutput30d = 0;
      let tokenCacheRead30d = 0;
      let totalCost30d = 0;
      const modelUsage = new Map<string, number>();
      const tokenSeriesPoints: Array<{ timestamp: number; value: number }> = [];

      for (const session of telemetryCandidates) {
        const payload = await window.orxa.opencode.loadMessages(activeProjectDir, session.id).catch(() => []);
        if (payload.length > 0) {
          messageCacheRef.current[`${activeProjectDir}:${session.id}`] = payload;
        }
        for (const message of payload) {
          const info = message.info as { role?: string; providerID?: string; modelID?: string; time?: { created?: number } };
          if (info.role === "assistant" && info.providerID && info.modelID) {
            const key = `${info.providerID}/${info.modelID}`;
            modelUsage.set(key, (modelUsage.get(key) ?? 0) + 1);
          }
          const summary = summarizeStepFinishParts(message.parts);
          tokenInput30d += summary.tokenInput;
          tokenOutput30d += summary.tokenOutput;
          tokenCacheRead30d += summary.tokenCacheRead;
          totalCost30d += summary.cost;
          if (summary.totalTokens > 0) {
            tokenSeriesPoints.push({
              timestamp: typeof info.time?.created === "number" ? info.time.created : session.time.updated,
              value: summary.totalTokens,
            });
          }
        }
      }

      setProjectDashboard({
        loading: false,
        updatedAt: now,
        sessions7d: sessionsAll.filter((item) => item.time.updated >= sevenDaysAgo).length,
        sessions30d: sessionsAll.filter((item) => item.time.updated >= thirtyDaysAgo).length,
        sessionCount: sessionsAll.length,
        tokenInput30d,
        tokenOutput30d,
        tokenCacheRead30d,
        totalCost30d,
        topModels: [...modelUsage.entries()]
          .map(([model, count]) => ({ model, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
        daySeries: buildDaySeries(tokenSeriesPoints),
        recentSessions,
      });
    } catch (error) {
      setProjectDashboard((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [activeProjectDir, projectData]);

  const refreshAgentsDocument = useCallback(
    async (directory?: string) => {
      const targetDirectory = directory ?? activeProjectDir;
      if (!targetDirectory) {
        setAgentsDocument(null);
        setAgentsDraft("");
        return;
      }
      try {
        setAgentsLoading(true);
        const doc = await window.orxa.opencode.readAgentsMd(targetDirectory);
        setAgentsDocument(doc);
        setAgentsDraft(doc.content);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setAgentsLoading(false);
      }
    },
    [activeProjectDir],
  );

  const createAgentsDocument = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    const projectLabel = activeProject?.name || activeProjectDir.split("/").at(-1) || "Workspace";
    const template = [
      `# ${projectLabel} - Agent Instructions`,
      "",
      "## Scope",
      "- Work only inside this repository unless explicitly told otherwise.",
      "- Prefer minimal, safe changes that are easy to review.",
      "",
      "## Quality",
      "- Run relevant tests after changes.",
      "- Explain what changed, why, and how it was verified.",
      "",
      "## Notes",
      "- Add workspace-specific conventions and workflows here.",
      "",
    ].join("\n");
    try {
      setAgentsSaving(true);
      const doc = await window.orxa.opencode.writeAgentsMd(activeProjectDir, template);
      setAgentsDocument(doc);
      setAgentsDraft(doc.content);
      setStatusLine("AGENTS.md created");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentsSaving(false);
    }
  }, [activeProject?.name, activeProjectDir]);

  const saveAgentsDocument = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    try {
      setAgentsSaving(true);
      const doc = await window.orxa.opencode.writeAgentsMd(activeProjectDir, agentsDraft);
      setAgentsDocument(doc);
      setAgentsDraft(doc.content);
      setStatusLine("AGENTS.md saved");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentsSaving(false);
    }
  }, [activeProjectDir, agentsDraft]);

  useEffect(() => {
    if (activeProjectDir) {
      return;
    }
    void refreshDashboard();
  }, [activeProjectDir, refreshDashboard]);

  useEffect(() => {
    if (!activeProjectDir || activeSessionID) {
      return;
    }
    void refreshProjectDashboard();
    void refreshAgentsDocument(activeProjectDir);
  }, [activeProjectDir, activeSessionID, refreshAgentsDocument, refreshProjectDashboard]);

  useEffect(() => {
    if (activeProjectDir && !activeSessionID) {
      return;
    }
    setAgentsDocument(null);
    setAgentsDraft("");
  }, [activeProjectDir, activeSessionID]);

  const createSession = useCallback(async (directory?: string, initialPrompt?: string) => {
    const targetDirectory = directory ?? activeProjectDir;
    if (!targetDirectory) {
      return;
    }

    const firstPrompt = initialPrompt?.trim() ?? "";
    const title = firstPrompt.length > 0 ? deriveSessionTitleFromPrompt(firstPrompt) : "New session";

    try {
      if (activeProjectDir !== targetDirectory) {
        await selectProject(targetDirectory);
      }
      const createdSession = await window.orxa.opencode.createSession(targetDirectory, title);
      const next = await refreshProject(targetDirectory);
      const sorted = [...next.sessions].filter((item) => !item.time.archived).sort((a, b) => b.time.updated - a.time.updated);
      const nextSessionID = createdSession.id || sorted[0]?.id;
      setActiveSessionID(nextSessionID);
      setActiveProjectDir(targetDirectory);
      if (nextSessionID && firstPrompt.length > 0) {
        const supportsSelectedAgent = selectedAgent ? serverAgentNames.has(selectedAgent) : false;
        await window.orxa.opencode.sendPrompt({
          directory: targetDirectory,
          sessionID: nextSessionID,
          text: firstPrompt,
          agent: supportsSelectedAgent ? selectedAgent : undefined,
          model: selectedModelPayload,
          variant: selectedVariant,
        });
        startResponsePolling(targetDirectory, nextSessionID);
        setStatusLine("Session started");
      } else {
        setStatusLine("Session created");
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [
    activeProjectDir,
    refreshProject,
    selectProject,
    selectedAgent,
    selectedModelPayload,
    selectedVariant,
    serverAgentNames,
    startResponsePolling,
  ]);

  const addProjectDirectory = useCallback(async (options?: { select?: boolean }) => {
    try {
      const directory = await window.orxa.opencode.addProjectDirectory();
      if (!directory) {
        return undefined;
      }
      await bootstrap();
      if (options?.select !== false) {
        await selectProject(directory);
      }
      setStatusLine(`Workspace added: ${directory}`);
      return directory;
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, [bootstrap, selectProject]);

  const loadSkills = useCallback(async () => {
    try {
      setSkillsLoading(true);
      setSkillsError(undefined);
      const entries = await window.orxa.opencode.listSkills();
      setSkills(entries);
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sidebarMode !== "skills") {
      return;
    }
    void loadSkills();
  }, [loadSkills, sidebarMode]);

  const openNewJobModal = useCallback(
    (template?: JobTemplate) => {
      setJobDraft({
        id: "",
        name: template?.title ?? "",
        projectDir: activeProjectDir ?? "",
        prompt: template?.prompt ?? "",
        schedule: template?.schedule ?? { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setJobModalOpen(true);
    },
    [activeProjectDir],
  );

  const updateJobDraft = useCallback((next: JobRecord) => {
    setJobDraft(next);
  }, []);

  const saveJobDraft = useCallback(() => {
    if (!jobDraft.name.trim() || !jobDraft.projectDir.trim() || !jobDraft.prompt.trim()) {
      setStatusLine("Name, workspace, and prompt are required");
      return;
    }
    const now = Date.now();
    setJobs((current) => [
      {
        ...jobDraft,
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        name: jobDraft.name.trim(),
        projectDir: jobDraft.projectDir.trim(),
        prompt: jobDraft.prompt.trim(),
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ]);
    setJobModalOpen(false);
    setStatusLine("Job created");
  }, [jobDraft]);

  const removeJob = useCallback((jobID: string) => {
    setJobs((current) => current.filter((job) => job.id !== jobID));
    setJobRuns((current) => current.filter((run) => run.jobID !== jobID));
    setStatusLine("Job deleted");
  }, []);

  const toggleJobEnabled = useCallback((jobID: string, enabled: boolean) => {
    setJobs((current) =>
      current.map((job) =>
        job.id === jobID
          ? {
              ...job,
              enabled,
              updatedAt: Date.now(),
            }
          : job,
      ),
    );
    setStatusLine(enabled ? "Job resumed" : "Job paused");
  }, []);

  const openSkillUseModal = useCallback(
    (skill: SkillEntry) => {
      setSkillUseModal({
        skill,
        projectDir: activeProjectDir ?? projects[0]?.worktree ?? "",
      });
    },
    [activeProjectDir, projects],
  );

  const applySkillToProject = useCallback(
    async (skill: SkillEntry, targetProjectDir: string) => {
      const project = projects.find((item) => item.worktree === targetProjectDir);
      if (!project) {
        setStatusLine("Select a valid workspace");
        return;
      }
      const seedPrompt = [
        `Use skill: ${skill.name}`,
        "",
        skill.description,
        "",
        `Skill path: ${skill.path}`,
        "",
        "Apply this skill to the current task and ask clarifying questions if needed.",
      ].join("\n");

      await selectProject(targetProjectDir);
      const latest = await window.orxa.opencode.refreshProject(targetProjectDir);
      setProjectData(latest);
      const session = [...latest.sessions]
        .filter((item) => !item.time.archived)
        .sort((left, right) => right.time.updated - left.time.updated)[0];
      if (session) {
        setActiveSessionID(session.id);
        const msgs = await window.orxa.opencode.loadMessages(targetProjectDir, session.id).catch(() => []);
        messageCacheRef.current[`${targetProjectDir}:${session.id}`] = msgs;
        setMessages(msgs);
      } else {
        const created = await window.orxa.opencode.createSession(targetProjectDir, `Skill: ${skill.name}`);
        setActiveSessionID(created.id);
        setMessages([]);
      }
      setComposer(seedPrompt);
      setSidebarMode("projects");
      setSkillUseModal(null);
      setStatusLine(`Prepared skill prompt for ${project.name || project.worktree.split("/").at(-1) || project.worktree}`);
    },
    [projects, selectProject],
  );

  const runScheduledJob = useCallback(async (job: JobRecord) => {
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
        agent: "orxa",
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
      setStatusLine(`Job completed: ${job.name}`);
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
      setStatusLine(error instanceof Error ? `Job failed (${job.name}): ${error.message}` : `Job failed (${job.name})`);
    } finally {
      runningJobIDsRef.current.delete(job.id);
    }
  }, []);

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
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setJobRunViewerLoading(false);
      }
    },
    [jobRuns],
  );

  useEffect(() => {
    if (jobs.length === 0) {
      return;
    }

    const tick = () => {
      const now = Date.now();
      for (const job of jobs) {
        if (isJobDueNow(job, now)) {
          void runScheduledJob(job);
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [jobs, runScheduledJob]);

  useEffect(() => {
    if (!projectSearchOpen) {
      return;
    }
    projectSearchInputRef.current?.focus();
  }, [projectSearchOpen]);

  useEffect(() => {
    setAllSessionsModalOpen(false);
  }, [activeProjectDir]);

  const removeProjectDirectory = useCallback(
    async (directory: string, label: string) => {
      try {
        if (!window.confirm(`Remove "${label}" from OrxaCode workspace list?`)) {
          return;
        }
        await window.orxa.opencode.removeProjectDirectory(directory);
        if (activeProjectDir === directory) {
          setActiveProjectDir(undefined);
          setProjectData(null);
          setActiveSessionID(undefined);
          setMessages([]);
          setTerminalPtyID(undefined);
          setTerminalOpen(false);
        }
        await bootstrap();
        setStatusLine(`Removed workspace: ${label}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, bootstrap],
  );

  const renameSession = useCallback(
    async (directory: string, sessionID: string, currentTitle: string) => {
      const nextTitle = window.prompt("Rename session", currentTitle)?.trim();
      if (!nextTitle || nextTitle === currentTitle) {
        return;
      }
      try {
        await window.orxa.opencode.renameSession(directory, sessionID, nextTitle);
        await refreshProject(directory);
        setStatusLine("Session renamed");
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshProject],
  );

  const archiveSession = useCallback(
    async (directory: string, sessionID: string) => {
      try {
        await window.orxa.opencode.archiveSession(directory, sessionID);
        const next = await refreshProject(directory);
        if (sessionID === activeSessionID) {
          const sorted = [...next.sessions].filter((item) => !item.time.archived).sort((a, b) => b.time.updated - a.time.updated);
          setActiveSessionID(sorted[0]?.id);
        }
        setStatusLine("Session archived");
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionID, refreshProject],
  );

  const copySessionID = useCallback(async (sessionID: string) => {
    try {
      await navigator.clipboard.writeText(sessionID);
      setStatusLine("Session ID copied");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const copyProjectPath = useCallback(async (directory: string) => {
    try {
      await navigator.clipboard.writeText(directory);
      setStatusLine("Workspace path copied");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const togglePinSession = useCallback((directory: string, sessionID: string) => {
    setPinnedSessions((current) => {
      const existing = new Set(current[directory] ?? []);
      if (existing.has(sessionID)) {
        existing.delete(sessionID);
      } else {
        existing.add(sessionID);
      }
      return {
        ...current,
        [directory]: [...existing],
      };
    });
  }, []);

  const createWorktreeSession = useCallback(
    async (directory: string, sessionID: string, currentTitle: string) => {
      const suggested = currentTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      const nameInput = window.prompt("New worktree name", suggested || "feature")?.trim();
      if (nameInput === "") {
        return;
      }

      try {
        const result = await window.orxa.opencode.createWorktreeSession(directory, sessionID, nameInput || undefined);
        await bootstrap();
        await selectProject(result.worktree.directory);
        setActiveSessionID(result.session.id);
        setStatusLine(`Worktree session created: ${result.worktree.name}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [bootstrap, selectProject],
  );

  const openProjectContextMenu = useCallback((event: ReactMouseEvent, directory: string, label: string) => {
    event.preventDefault();
    const point = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: "project",
      x: point.x,
      y: point.y,
      directory,
      label,
    });
  }, []);

  const openSessionContextMenu = useCallback((event: ReactMouseEvent, directory: string, sessionID: string, title: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: "session",
      x: point.x,
      y: point.y,
      directory,
      sessionID,
      title,
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setTitleMenuOpen(false);
      setOpenMenuOpen(false);
      setCommitMenuOpen(false);
      setProjectSearchOpen(false);
      setProjectSortOpen(false);
      setBranchMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const insideTopMenus =
        target.closest(".titlebar-split") ||
        target.closest(".title-overflow-button") ||
        target.closest(".title-overflow-menu");
      if (!insideTopMenus) {
        setOpenMenuOpen(false);
        setCommitMenuOpen(false);
        setTitleMenuOpen(false);
      }
      if (!target.closest(".project-search-popover") && !target.closest(".pane-action-icon")) {
        setProjectSearchOpen(false);
      }
      if (!target.closest(".project-sort-popover") && !target.closest(".pane-action-icon")) {
        setProjectSortOpen(false);
      }
      if (!target.closest(".composer-branch-wrap")) {
        setBranchMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const startSidebarResize = useCallback((side: "left" | "right", event: ReactMouseEvent) => {
    event.preventDefault();
    resizeStateRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === "left" ? leftPaneWidth : rightPaneWidth,
    };
  }, [leftPaneWidth, rightPaneWidth]);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }
      if (state.side === "left") {
        const next = Math.max(240, Math.min(520, state.startWidth + (event.clientX - state.startX)));
        setLeftPaneWidth(next);
        return;
      }
      const next = Math.max(280, Math.min(560, state.startWidth - (event.clientX - state.startX)));
      setRightPaneWidth(next);
    };
    const onMouseUp = () => {
      resizeStateRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    setTitleMenuOpen(false);
    setOpenMenuOpen(false);
    setCommitMenuOpen(false);
    setBranchMenuOpen(false);
  }, [activeProjectDir, activeSessionID]);

  useEffect(() => {
    if (!branchMenuOpen) {
      return;
    }
    window.setTimeout(() => {
      branchSearchInputRef.current?.focus();
    }, 0);
  }, [branchMenuOpen]);

  const togglePlanMode = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        if (hasPlanAgent) {
          setSelectedAgent("plan");
          if (orxaModels.plan) {
            setSelectedModel(orxaModels.plan);
          }
        }
        return;
      }
      if (hasOrxaAgent) {
        setSelectedAgent("orxa");
        if (orxaModels.orxa) {
          setSelectedModel(orxaModels.orxa);
        }
        return;
      }
      setSelectedAgent(agentOptions[0]?.name);
    },
    [agentOptions, hasOrxaAgent, hasPlanAgent, orxaModels.orxa, orxaModels.plan],
  );

  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage();
      if (!selection) {
        return;
      }
      setComposerAttachments((current) => {
        if (current.some((item) => item.url === selection.url)) {
          return current;
        }
        return [...current, selection];
      });
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const removeAttachment = useCallback((url: string) => {
    setComposerAttachments((current) => current.filter((item) => item.url !== url));
  }, []);

  const sendPrompt = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      setStatusLine("Select a workspace and session first");
      return;
    }

    const text = composer.trim();
    if (!text && composerAttachments.length === 0) {
      return;
    }

    const supportsSelectedAgent = selectedAgent ? serverAgentNames.has(selectedAgent) : false;
    const activeSession = sessions.find((item) => item.id === activeSessionID);
    const shouldAutoTitle = text.length > 0 && shouldAutoRenameSessionTitle(activeSession?.title);

    try {
      stopResponsePolling();
      if (shouldAutoTitle) {
        const generatedTitle = deriveSessionTitleFromPrompt(text);
        await window.orxa.opencode.renameSession(activeProjectDir, activeSessionID, generatedTitle);
      }

      await window.orxa.opencode.sendPrompt({
        directory: activeProjectDir,
        sessionID: activeSessionID,
        text,
        attachments: composerAttachments.map((attachment) => ({
          url: attachment.url,
          mime: attachment.mime,
          filename: attachment.filename,
        })),
        agent: supportsSelectedAgent ? selectedAgent : undefined,
        model: selectedModelPayload,
        variant: selectedVariant,
      });

      setComposer("");
      setComposerAttachments([]);
      setStatusLine(shouldAutoTitle ? "Prompt sent and session titled" : "Prompt sent");
      window.setTimeout(() => {
        void refreshMessages();
      }, 240);
      startResponsePolling(activeProjectDir, activeSessionID);
      if (shouldAutoTitle) {
        void refreshProject(activeProjectDir).catch(() => undefined);
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [
    activeProjectDir,
    activeSessionID,
    composerAttachments,
    composer,
    refreshMessages,
    selectedAgent,
    selectedModelPayload,
    selectedVariant,
    sessions,
    serverAgentNames,
    refreshProject,
    startResponsePolling,
    stopResponsePolling,
  ]);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionID),
    [activeSessionID, sessions],
  );
  const currentSessionStatus = activeSessionID ? projectData?.sessionStatus[activeSessionID] : undefined;
  const isSessionBusy = currentSessionStatus?.type === "busy" || currentSessionStatus?.type === "retry";
  const showingProjectDashboard = Boolean(activeProjectDir && !activeSessionID);
  const isActiveSessionPinned = Boolean(
    activeProjectDir && activeSessionID && (pinnedSessions[activeProjectDir] ?? []).includes(activeSessionID),
  );
  const orxaTodos = useMemo(() => extractOrxaTodos(messages), [messages]);
  const unreadJobRunsCount = useMemo(
    () => jobRuns.filter((run) => run.unread && run.status !== "running").length,
    [jobRuns],
  );
  const pendingPermission = useMemo(() => (projectData?.permissions ?? [])[0], [projectData?.permissions]);
  const workspaceClassName = [
    "workspace",
    showOperationsPane ? "" : "workspace-no-ops",
    showProjectsPane ? "" : "workspace-left-collapsed",
    showOperationsPane ? "" : "workspace-right-collapsed",
  ]
    .filter(Boolean)
    .join(" ");
  const workspaceStyle = useMemo(
    () =>
      ({
        "--left-pane-width": `${leftPaneWidth}px`,
        "--right-pane-width": `${rightPaneWidth}px`,
      }) as CSSProperties,
    [leftPaneWidth, rightPaneWidth],
  );

  useEffect(() => {
    setTodosOpen(false);
  }, [activeSessionID]);

  const abortActiveSession = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return;
    }
    try {
      await window.orxa.opencode.abortSession(activeProjectDir, activeSessionID);
      setStatusLine("Stopped");
      stopResponsePolling();
      void refreshProject(activeProjectDir).catch(() => undefined);
      void refreshMessages().catch(() => undefined);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID, refreshMessages, refreshProject, stopResponsePolling]);

  const createTerminal = useCallback(async (openAfterCreate = appPreferences.autoOpenTerminalOnCreate) => {
    if (!activeProjectDir) {
      return;
    }

    const cwd = projectData?.path.directory ?? activeProjectDir;
    try {
      const pty = await window.orxa.terminal.create(activeProjectDir, cwd, "Workspace shell");
      setTerminalPtyID(pty.id);
      setTerminalOpen(openAfterCreate);
      setStatusLine("Terminal created");
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, appPreferences.autoOpenTerminalOnCreate, projectData?.path.directory]);

  const toggleTerminal = useCallback(async () => {
    if (terminalOpen) {
      setTerminalOpen(false);
      return;
    }
    if (!activeProjectDir) {
      return;
    }
    if (!terminalPtyID) {
      await createTerminal(true);
      return;
    }
    setTerminalOpen(true);
  }, [activeProjectDir, createTerminal, terminalOpen, terminalPtyID]);

  const replyPendingPermission = useCallback(
    async (reply: "once" | "always" | "reject") => {
      if (!activeProjectDir || !pendingPermission) {
        return;
      }
      if (reply === "reject" && appPreferences.confirmDangerousActions && !window.confirm("Reject this permission request?")) {
        return;
      }
      try {
        setPermissionDecisionPending(reply);
        await window.orxa.opencode.replyPermission(activeProjectDir, pendingPermission.id, reply);
        await refreshProject(activeProjectDir);
        setStatusLine(`Permission ${reply === "reject" ? "rejected" : "approved"}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setPermissionDecisionPending(null);
      }
    },
    [activeProjectDir, appPreferences.confirmDangerousActions, pendingPermission, refreshProject],
  );

  useEffect(() => {
    if (!terminalOpen || !activeProjectDir) {
      terminalAutoCreateTried.current = false;
      return;
    }

    if (terminalPtyID) {
      terminalAutoCreateTried.current = false;
      return;
    }

    if (terminalAutoCreateTried.current) {
      return;
    }

    terminalAutoCreateTried.current = true;
    void createTerminal(true);
  }, [activeProjectDir, createTerminal, terminalOpen, terminalPtyID]);

  const loadGitDiff = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setOpsPanelTab("git");
    setGitPanelTab("diff");
    setGitPanelOutput("Loading diff...");
    try {
      const output = await window.orxa.opencode.gitDiff(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const loadGitLog = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setOpsPanelTab("git");
    setGitPanelTab("log");
    setGitPanelOutput("Loading log...");
    try {
      const output = await window.orxa.opencode.gitLog(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const loadGitIssues = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setOpsPanelTab("git");
    setGitPanelTab("issues");
    setGitPanelOutput("Loading issues...");
    try {
      const output = await window.orxa.opencode.gitIssues(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const loadGitPrs = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setOpsPanelTab("git");
    setGitPanelTab("prs");
    setGitPanelOutput("Loading pull requests...");
    try {
      const output = await window.orxa.opencode.gitPrs(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir]);

  const refreshBranchState = useCallback(async () => {
    if (!activeProjectDir) {
      setBranchState(null);
      return;
    }
    try {
      setBranchLoading(true);
      const next = await window.orxa.opencode.gitBranches(activeProjectDir);
      setBranchState(next);
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setBranchLoading(false);
    }
  }, [activeProjectDir]);

  const checkoutBranch = useCallback(
    async (nextBranchInput: string) => {
      if (!activeProjectDir) {
        return;
      }
      const nextBranch = nextBranchInput.trim();
      if (!nextBranch || nextBranch === branchState?.current) {
        setBranchMenuOpen(false);
        return;
      }
      try {
        setBranchSwitching(true);
        const next = await window.orxa.opencode.gitCheckoutBranch(activeProjectDir, nextBranch);
        setBranchState(next);
        setBranchQuery("");
        setBranchMenuOpen(false);
        setStatusLine(`Checked out ${next.current}`);
        if (opsPanelTab === "git") {
          if (gitPanelTab === "diff") {
            await loadGitDiff();
          } else if (gitPanelTab === "log") {
            await loadGitLog();
          } else if (gitPanelTab === "issues") {
            await loadGitIssues();
          } else {
            await loadGitPrs();
          }
        }
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setBranchSwitching(false);
      }
    },
    [activeProjectDir, branchState, gitPanelTab, loadGitDiff, loadGitIssues, loadGitLog, loadGitPrs, opsPanelTab],
  );

  const createAndCheckoutBranch = useCallback(async () => {
    const existing = new Set(branchState?.branches ?? []);
    let candidate = branchQuery.trim();
    if (!candidate) {
      candidate = window.prompt("Create and checkout new branch", "")?.trim() ?? "";
    }
    if (!candidate) {
      return;
    }
    if (existing.has(candidate)) {
      setStatusLine(`Branch "${candidate}" already exists`);
      return;
    }
    await checkoutBranch(candidate);
  }, [branchQuery, branchState?.branches, checkoutBranch]);

  const openDirectoryInTarget = useCallback(
    async (target: OpenTarget) => {
      if (!activeProjectDir) {
        return;
      }
      setPreferredOpenTarget(target);
      try {
        const result = await window.orxa.opencode.openDirectoryIn(activeProjectDir, target);
        setStatusLine(result.detail);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setOpenMenuOpen(false);
      }
    },
    [activeProjectDir],
  );

  const loadCommitSummary = useCallback(
    async (includeUnstaged: boolean) => {
      if (!activeProjectDir) {
        return;
      }
      try {
        setCommitSummaryLoading(true);
        const summary = await window.orxa.opencode.gitCommitSummary(activeProjectDir, includeUnstaged);
        setCommitSummary(summary);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      } finally {
        setCommitSummaryLoading(false);
      }
    },
    [activeProjectDir],
  );

  const openCommitModal = useCallback(
    (nextStep?: CommitNextStep) => {
      if (!activeProjectDir) {
        return;
      }
      if (nextStep) {
        setCommitNextStep(nextStep);
      }
      setCommitModalOpen(true);
      setCommitMenuOpen(false);
    },
    [activeProjectDir],
  );

  const submitCommit = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    try {
      setCommitSubmitting(true);
      const result = await window.orxa.opencode.gitCommit(activeProjectDir, {
        includeUnstaged: commitIncludeUnstaged,
        message: commitMessageDraft.trim().length > 0 ? commitMessageDraft.trim() : undefined,
        guidancePrompt: appPreferences.commitGuidancePrompt,
        nextStep: commitNextStep,
      });
      setCommitModalOpen(false);
      setCommitMessageDraft("");
      const prSuffix = result.prUrl ? ` • PR ${result.prUrl}` : "";
      const pushSuffix = result.pushed ? " • pushed" : "";
      setStatusLine(`Committed ${result.commitHash.slice(0, 7)}${pushSuffix}${prSuffix}`);
      await refreshProject(activeProjectDir);
      if (opsPanelTab === "git") {
        void loadGitDiff();
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitSubmitting(false);
    }
  }, [
    activeProjectDir,
    appPreferences.commitGuidancePrompt,
    commitIncludeUnstaged,
    commitMessageDraft,
    commitNextStep,
    loadGitDiff,
    opsPanelTab,
    refreshProject,
  ]);

  const appendPathToComposer = useCallback((filePath: string) => {
    setComposer((current) => (current.trim().length > 0 ? `${current}\n${filePath}` : filePath));
  }, []);

  useEffect(() => {
    if (!activeProjectDir) {
      setOpsPanelTab("operations");
      setGitPanelOutput("Select DIFF or LOG.");
      return;
    }
  }, [activeProjectDir]);

  useEffect(() => {
    if (!commitModalOpen || !activeProjectDir) {
      return;
    }
    void loadCommitSummary(commitIncludeUnstaged);
  }, [activeProjectDir, commitIncludeUnstaged, commitModalOpen, loadCommitSummary]);

  useEffect(() => {
    if (!activeProjectDir || opsPanelTab !== "git") {
      return;
    }
    if (gitPanelTab === "diff") {
      void loadGitDiff();
      return;
    }
    if (gitPanelTab === "log") {
      void loadGitLog();
      return;
    }
    if (gitPanelTab === "issues") {
      void loadGitIssues();
      return;
    }
    void loadGitPrs();
  }, [activeProjectDir, gitPanelTab, loadGitDiff, loadGitIssues, loadGitLog, loadGitPrs, opsPanelTab]);

  useEffect(() => {
    if (!activeProjectDir) {
      setBranchState(null);
      return;
    }
    void refreshBranchState();
  }, [activeProjectDir, refreshBranchState]);

  const openTargets = OPEN_TARGETS;
  const activeOpenTarget = openTargets.find((target) => target.id === preferredOpenTarget) ?? openTargets[2]!;

  const commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }> = [
    { id: "commit", label: "Commit", icon: <GitCommitHorizontal size={14} aria-hidden="true" /> },
    { id: "commit_and_push", label: "Commit and push", icon: <Upload size={14} aria-hidden="true" /> },
    { id: "commit_and_create_pr", label: "Create PR", icon: <Send size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="app-shell">
      <div className="window-drag-region" />
      <div className={workspaceClassName} style={workspaceStyle}>
        {showProjectsPane ? (
          <aside className="sidebar projects-pane">
            <nav className="sidebar-mode-links" aria-label="Sidebar mode">
              <button
                type="button"
                className={sidebarMode === "jobs" ? "active" : ""}
                onClick={() => setSidebarMode("jobs")}
              >
                Jobs
                {unreadJobRunsCount > 0 ? <span className="sidebar-mode-badge">{unreadJobRunsCount}</span> : null}
              </button>
              <button
                type="button"
                className={sidebarMode === "skills" ? "active" : ""}
                onClick={() => setSidebarMode("skills")}
              >
                Skills
              </button>
            </nav>
            <div className="pane-header">
              <h2>
                <button
                  type="button"
                  className={`pane-heading-link ${sidebarMode === "projects" ? "active" : ""}`.trim()}
                  onClick={openWorkspaceDashboard}
                >
                  Workspaces
                </button>
              </h2>
              <div className="pane-header-actions">
                {sidebarMode === "projects" ? (
                  <>
                    <IconButton
                      icon="search"
                      className="pane-action-icon"
                      label={projectSearchOpen ? "Close search" : "Search workspaces"}
                      onClick={() => {
                        setProjectSearchOpen((value) => !value);
                        setProjectSortOpen(false);
                      }}
                    />
                    <IconButton
                      icon="sort"
                      className="pane-action-icon"
                      label={projectSortOpen ? "Close sort options" : "Sort workspaces"}
                      onClick={() => {
                        setProjectSortOpen((value) => !value);
                        setProjectSearchOpen(false);
                      }}
                    />
                    <IconButton icon="folderPlus" className="pane-action-icon" label="Add workspace folder" onClick={() => void addProjectDirectory()} />
                  </>
                ) : null}
                {sidebarMode === "jobs" ? (
                  <IconButton icon="plus" className="pane-action-icon" label="New job" onClick={() => openNewJobModal()} />
                ) : null}
                {sidebarMode === "skills" ? (
                  <IconButton icon="refresh" className="pane-action-icon" label="Refresh skills" onClick={() => void loadSkills()} />
                ) : null}
              </div>
            </div>
            {sidebarMode === "projects" ? (
              <>
                {projectSortOpen ? (
                  <div className="project-sort-popover">
                    <button
                      type="button"
                      className={projectSortMode === "updated" ? "active" : ""}
                      onClick={() => {
                        setProjectSortMode("updated");
                        setProjectSortOpen(false);
                      }}
                    >
                      Last updated
                    </button>
                    <button
                      type="button"
                      className={projectSortMode === "recent" ? "active" : ""}
                      onClick={() => {
                        setProjectSortMode("recent");
                        setProjectSortOpen(false);
                      }}
                    >
                      Most recent
                    </button>
                    <button
                      type="button"
                      className={projectSortMode === "alpha-asc" ? "active" : ""}
                      onClick={() => {
                        setProjectSortMode("alpha-asc");
                        setProjectSortOpen(false);
                      }}
                    >
                      Alphabetical (A-Z)
                    </button>
                    <button
                      type="button"
                      className={projectSortMode === "alpha-desc" ? "active" : ""}
                      onClick={() => {
                        setProjectSortMode("alpha-desc");
                        setProjectSortOpen(false);
                      }}
                    >
                      Alphabetical (Z-A)
                    </button>
                  </div>
                ) : null}
                {projectSearchOpen ? (
                  <div className="project-search-popover">
                    <input
                      ref={projectSearchInputRef}
                      placeholder="Search workspaces..."
                      value={projectSearchQuery}
                      onChange={(event) => setProjectSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setProjectSearchOpen(false);
                          setProjectSearchQuery("");
                        }
                      }}
                    />
                    <div className="project-search-results">
                      {filteredProjects.map((project) => (
                        <button
                          key={`search-${project.id}`}
                          type="button"
                          onClick={() => {
                            void selectProject(project.worktree);
                            setProjectSearchOpen(false);
                          }}
                          title={project.name || project.worktree.split("/").at(-1) || project.worktree}
                        >
                          {project.name || project.worktree.split("/").at(-1) || project.worktree}
                        </button>
                      ))}
                      {filteredProjects.length === 0 ? <p>No matching workspaces</p> : null}
                    </div>
                  </div>
                ) : null}
                <div className="project-list">
                  {filteredProjects.map((project) => {
                    const projectLabel = project.name || project.worktree.split("/").at(-1) || project.worktree;
                    const isActiveProject = project.worktree === activeProjectDir;
                    const isExpanded = isActiveProject && !collapsedProjects[project.worktree];
                    return (
                      <article
                        key={project.id}
                        className={`project-item ${isActiveProject ? "active" : ""}`.trim()}
                        onContextMenu={(event) => openProjectContextMenu(event, project.worktree, projectLabel)}
                      >
                        <div className="project-item-header">
                          <button
                            type="button"
                            className={`project-select ${isActiveProject ? "active" : ""}`.trim()}
                            onClick={() => {
                              if (isActiveProject) {
                                setCollapsedProjects((current) => ({
                                  ...current,
                                  [project.worktree]: !current[project.worktree],
                                }));
                                return;
                              }
                              void selectProject(project.worktree);
                            }}
                            title={projectLabel}
                          >
                            <span className="project-row-arrow" aria-hidden="true">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                            <span>{truncateLabel(projectLabel)}</span>
                          </button>
                          <button
                            type="button"
                            className="project-add-session"
                            onClick={(event) => {
                              event.stopPropagation();
                              void createSession(project.worktree);
                            }}
                            aria-label={`Create session for ${projectLabel}`}
                            title="New session"
                          >
                            +
                          </button>
                        </div>
                        {isExpanded ? (
                          <div className="project-session-list">
                            {sessions.length === 0 ? <p>No sessions yet</p> : null}
                            {sessions.slice(0, 4).map((session) => {
                              const status = getSessionStatusType(session.id, project.worktree);
                              const busy = status === "busy" || status === "retry";
                              return (
                                <button
                                  type="button"
                                  key={session.id}
                                  className={session.id === activeSessionID ? "active" : ""}
                                  onClick={() => openSession(session.id)}
                                  onContextMenu={(event) =>
                                    openSessionContextMenu(event, project.worktree, session.id, session.title || session.slug)
                                  }
                                  title={session.title || session.slug}
                                >
                                  <span className={`session-status-indicator ${busy ? "busy" : "idle"}`} aria-hidden="true" />
                                  <span>{truncateLabel(session.title || session.slug, 22)}</span>
                                </button>
                              );
                            })}
                            {sessions.length > 4 ? (
                              <button type="button" className="project-sessions-more" onClick={() => setAllSessionsModalOpen(true)}>
                                View all
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="sidebar-mode-placeholder">
                {sidebarMode === "jobs" ? "Scheduled automations run from the Jobs page." : "Skill cards are available in the Skills page."}
              </div>
            )}

            <div className="sidebar-footer-actions">
              <IconButton icon="profiles" label="Profiles" onClick={() => setProfileModalOpen(true)} />
              <IconButton icon="settings" label="Config" onClick={() => setSettingsOpen((value) => !value)} />
            </div>
          </aside>
        ) : null}
        {showProjectsPane ? (
          <button
            type="button"
            className="sidebar-resizer sidebar-resizer-left"
            aria-label="Resize workspaces sidebar"
            onMouseDown={(event) => startSidebarResize("left", event)}
          />
        ) : null}

        <main className={`content-pane ${activeProjectDir ? "" : "content-pane-dashboard"}`.trim()}>
          {hasProjectContext ? (
            <div className="content-edge-controls">
              <IconButton
                icon="panelLeft"
                label={showProjectsPane ? "Hide workspaces sidebar" : "Show workspaces sidebar"}
                className={`titlebar-toggle titlebar-toggle-left ${showProjectsPane ? "active" : ""}`.trim()}
                onClick={() => setProjectsSidebarVisible((value) => !value)}
              />
              <div className="content-edge-right-actions">
                <div className={`titlebar-split titlebar-open ${openMenuOpen ? "open" : ""}`.trim()}>
                  <button
                    type="button"
                    className="titlebar-action"
                    onClick={() => {
                      void openDirectoryInTarget(preferredOpenTarget);
                      setCommitMenuOpen(false);
                      setTitleMenuOpen(false);
                    }}
                  >
                    <span className="titlebar-action-logo titlebar-action-logo-app">
                      <img src={activeOpenTarget.logo} alt="" aria-hidden="true" />
                    </span>
                    <span>{activeOpenTarget.label}</span>
                  </button>
                  <button
                    type="button"
                    className="titlebar-action-arrow"
                    onClick={() => {
                      setOpenMenuOpen((value) => !value);
                      setCommitMenuOpen(false);
                      setTitleMenuOpen(false);
                    }}
                    aria-label="Open in options"
                    title="Open in options"
                  >
                    <ChevronsUpDown size={13} aria-hidden="true" />
                  </button>
                  {openMenuOpen ? (
                    <div className="titlebar-menu">
                      <small>Open in</small>
                      {openTargets.map((target) => (
                        <button key={target.id} type="button" onClick={() => void openDirectoryInTarget(target.id)}>
                          <span className="menu-item-logo menu-item-logo-app">
                            <img src={target.logo} alt="" aria-hidden="true" />
                          </span>
                          <span>{target.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className={`titlebar-split titlebar-commit ${commitMenuOpen ? "open" : ""}`.trim()}>
                  <button
                    type="button"
                    className="titlebar-action"
                    onClick={() => {
                      openCommitModal();
                      setOpenMenuOpen(false);
                      setTitleMenuOpen(false);
                    }}
                  >
                    <span className="titlebar-action-logo">
                      <GitCommitHorizontal size={14} aria-hidden="true" />
                    </span>
                    <span>Commit</span>
                  </button>
                  <button
                    type="button"
                    className="titlebar-action-arrow"
                    onClick={() => {
                      setCommitMenuOpen((value) => !value);
                      setOpenMenuOpen(false);
                      setTitleMenuOpen(false);
                    }}
                    aria-label="Commit options"
                    title="Commit options"
                  >
                    <ChevronsUpDown size={13} aria-hidden="true" />
                  </button>
                  {commitMenuOpen ? (
                    <div className="titlebar-menu">
                      <small>Next step</small>
                      {commitNextStepOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setCommitNextStep(option.id);
                            openCommitModal(option.id);
                          }}
                        >
                          <span className="menu-item-logo">{option.icon}</span>
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <IconButton
                  icon="terminal"
                  label={terminalOpen ? "Hide terminal" : "Show terminal"}
                  className={`titlebar-toggle titlebar-toggle-terminal ${terminalOpen ? "active" : ""}`.trim()}
                  onClick={() => void toggleTerminal()}
                />
                <IconButton
                  icon="panelRight"
                  label={showOperationsPane ? "Hide operations sidebar" : "Show operations sidebar"}
                  className={`titlebar-toggle titlebar-toggle-right ${showOperationsPane ? "active" : ""}`.trim()}
                  onClick={() =>
                    setAppPreferences((current) => ({
                      ...current,
                      showOperationsPane: !current.showOperationsPane,
                    }))
                  }
                />
              </div>
            </div>
          ) : null}
          {sidebarMode === "jobs" ? (
            <JobsBoard
              templates={JOB_TEMPLATES}
              jobs={jobs}
              runs={jobRuns}
              unreadRuns={unreadJobRunsCount}
              projects={projects}
              onNewJob={() => openNewJobModal()}
              onUseTemplate={(template) => openNewJobModal(template)}
              onDeleteJob={removeJob}
              onToggleEnabled={toggleJobEnabled}
              onOpenRun={(runID) => void openJobRunViewer(runID)}
              onMarkAllRunsRead={markAllJobRunsRead}
            />
          ) : sidebarMode === "skills" ? (
            <SkillsBoard
              skills={skills}
              loading={skillsLoading}
              error={skillsError}
              onRefresh={() => void loadSkills()}
              onUseSkill={openSkillUseModal}
            />
          ) : activeProjectDir ? (
            <>
              <div className="content-header">
                <div className="content-title-row">
                  <h2>{activeProject?.name || activeProjectDir?.split("/").at(-1) || "No workspace selected"}</h2>
                  {!showingProjectDashboard ? (
                    <>
                      <button
                        type="button"
                        className="title-overflow-button"
                        aria-label="Session and workspace actions"
                        title="Session and workspace actions"
                        onClick={() => {
                          setTitleMenuOpen((value) => !value);
                          setOpenMenuOpen(false);
                          setCommitMenuOpen(false);
                        }}
                      >
                        <Ellipsis size={16} aria-hidden="true" />
                      </button>
                      {titleMenuOpen ? (
                        <div className="title-overflow-menu">
                          <button
                            type="button"
                            disabled={!activeSessionID}
                            onClick={() => {
                              if (!activeProjectDir || !activeSessionID) {
                                return;
                              }
                              const nextPinned = !isActiveSessionPinned;
                              togglePinSession(activeProjectDir, activeSessionID);
                              setStatusLine(nextPinned ? "Session pinned" : "Session unpinned");
                              setTitleMenuOpen(false);
                            }}
                          >
                            <span className="menu-item-logo">{isActiveSessionPinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}</span>
                            <span>{isActiveSessionPinned ? "Unpin session" : "Pin session"}</span>
                          </button>
                          <button
                            type="button"
                            disabled={!activeSessionID || !activeSession || !activeProjectDir}
                            onClick={() => {
                              if (!activeProjectDir || !activeSessionID || !activeSession) {
                                return;
                              }
                              setTitleMenuOpen(false);
                              void renameSession(activeProjectDir, activeSessionID, activeSession.title || activeSession.slug);
                            }}
                          >
                            <span className="menu-item-logo">
                              <Pencil size={14} aria-hidden="true" />
                            </span>
                            <span>Rename session</span>
                          </button>
                          <button
                            type="button"
                            disabled={!activeSessionID || !activeProjectDir}
                            onClick={() => {
                              if (!activeProjectDir || !activeSessionID) {
                                return;
                              }
                              setTitleMenuOpen(false);
                              void archiveSession(activeProjectDir, activeSessionID);
                            }}
                          >
                            <span className="menu-item-logo">
                              <Archive size={14} aria-hidden="true" />
                            </span>
                            <span>Archive session</span>
                          </button>
                          <div className="menu-separator" />
                          <button
                            type="button"
                            onClick={() => {
                              if (!activeProjectDir) {
                                return;
                              }
                              setTitleMenuOpen(false);
                              void copyProjectPath(activeProjectDir);
                            }}
                          >
                            <span className="menu-item-logo">
                              <Copy size={14} aria-hidden="true" />
                            </span>
                            <span>Copy path</span>
                          </button>
                          <button
                            type="button"
                            disabled={!activeSessionID}
                            onClick={() => {
                              if (!activeSessionID) {
                                return;
                              }
                              setTitleMenuOpen(false);
                              void copySessionID(activeSessionID);
                            }}
                          >
                            <span className="menu-item-logo">
                              <Fingerprint size={14} aria-hidden="true" />
                            </span>
                            <span>Copy session id</span>
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              {!showingProjectDashboard ? (
                <>
                  <MessageFeed messages={messages} showAssistantPlaceholder={isSessionBusy} />

                  {orxaTodos.length > 0 ? (
                    <section className={`todos-drawer ${todosOpen ? "open" : "closed"}`.trim()}>
                      <button type="button" className="todos-drawer-toggle" onClick={() => setTodosOpen((value) => !value)}>
                        <span>Orxa Todos</span>
                        <small>{orxaTodos.length}</small>
                      </button>
                      {todosOpen ? (
                        <div className="todos-drawer-body">
                          <ul>
                            {orxaTodos.map((todo) => (
                              <li key={todo.id}>
                                <span>{todo.content}</span>
                                {todo.status || todo.priority ? (
                                  <small>
                                    {[todo.status, todo.priority].filter(Boolean).join(" • ")}
                                  </small>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className="composer-zone">
                    <div className="composer-input-wrap">
                      <textarea
                        placeholder="Send message to Orxa"
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (isSessionBusy) {
                              void abortActiveSession();
                            } else {
                              void sendPrompt();
                            }
                          }
                        }}
                      />
                      <div className="composer-input-actions">
                        <IconButton icon="image" label="Attach image" onClick={() => void pickImageAttachment()} />
                        <IconButton
                          icon={isSessionBusy ? "stop" : "send"}
                          label={isSessionBusy ? "Stop" : "Send prompt"}
                          onClick={() => (isSessionBusy ? void abortActiveSession() : void sendPrompt())}
                          disabled={!activeSessionID}
                        />
                      </div>
                    </div>

                    {composerAttachments.length > 0 ? (
                      <div className="composer-attachments">
                        {composerAttachments.map((attachment) => (
                          <button
                            key={attachment.url}
                            type="button"
                            className="attachment-chip"
                            onClick={() => removeAttachment(attachment.url)}
                            title={`Remove ${attachment.filename}`}
                          >
                            {attachment.filename}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="composer-divider" />

                    <div className="composer-controls">
                      <label className="agent-mode-toggle plan-toggle-inline">
                        <input
                          type="checkbox"
                          checked={isPlanMode}
                          disabled={!hasPlanAgent}
                          onChange={(event) => togglePlanMode(event.target.checked)}
                        />
                        Plan mode
                      </label>
                      <div className={`composer-branch-wrap ${branchMenuOpen ? "open" : ""}`.trim()}>
                        <button
                          type="button"
                          className="composer-branch-control"
                          style={{ width: `${branchControlWidthCh}ch` }}
                          disabled={branchLoading || branchSwitching || !activeProjectDir}
                          onClick={() => {
                            setBranchMenuOpen((value) => {
                              const next = !value;
                              if (next) {
                                setBranchQuery("");
                              }
                              return next;
                            });
                          }}
                          title={branchState?.current || "Branch"}
                        >
                          <span className="composer-branch-leading">
                            <GitBranch size={14} aria-hidden="true" />
                            <span className="composer-branch-label">{branchDisplayValue}</span>
                          </span>
                          <ChevronDown size={13} aria-hidden="true" />
                        </button>
                        {branchMenuOpen ? (
                          <div className="composer-branch-menu">
                            <div className="composer-branch-search">
                              <SearchIcon size={13} aria-hidden="true" />
                              <input
                                ref={branchSearchInputRef}
                                value={branchQuery}
                                onChange={(event) => setBranchQuery(event.target.value)}
                                placeholder="Search branches"
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void checkoutBranch(branchQuery);
                                  }
                                }}
                              />
                            </div>
                            <small>Branches</small>
                            <div className="composer-branch-list">
                              {filteredBranches.length === 0 ? (
                                <p>No branches found</p>
                              ) : (
                                filteredBranches.map((branch) => (
                                  <button key={branch} type="button" onClick={() => void checkoutBranch(branch)}>
                                    <span className="composer-branch-item-main">
                                      <GitBranch size={13} aria-hidden="true" />
                                      <span>{branch}</span>
                                    </span>
                                    {branch === branchState?.current ? <Check size={13} aria-hidden="true" /> : null}
                                  </button>
                                ))
                              )}
                            </div>
                            <button
                              type="button"
                              className="composer-branch-create"
                              disabled={branchLoading || branchSwitching}
                              onClick={() => void createAndCheckoutBranch()}
                            >
                              <Plus size={14} aria-hidden="true" />
                              Create and checkout new branch...
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <select
                        className="composer-select composer-model-select"
                        aria-label="Model"
                        value={selectedModel ?? ""}
                        style={{ width: `${modelSelectWidthCh}ch` }}
                        onChange={(event) => setSelectedModel(event.target.value || undefined)}
                      >
                        {modelSelectOptions.map((model) => (
                          <option key={model.key} value={model.key}>
                            {model.providerName}/{model.modelName}
                          </option>
                        ))}
                      </select>
                      <select
                        className="composer-select composer-variant-select"
                        aria-label="Variant"
                        value={selectedVariant ?? ""}
                        style={{ width: `${variantSelectWidthCh}ch` }}
                        onChange={(event) => setSelectedVariant(event.target.value || undefined)}
                      >
                        <option value="">(default)</option>
                        {variantOptions.map((variant) => (
                          <option key={variant} value={variant}>
                            {variant}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <TerminalPanel
                    directory={activeProjectDir}
                    ptyID={terminalPtyID}
                    open={terminalOpen}
                    onCreate={() => createTerminal(true)}
                  />
                </>
              ) : (
                <ProjectDashboard
                  loading={projectDashboard.loading}
                  sessionCount={projectDashboard.sessionCount}
                  sessions7d={projectDashboard.sessions7d}
                  sessions30d={projectDashboard.sessions30d}
                  tokenInput30d={projectDashboard.tokenInput30d}
                  tokenOutput30d={projectDashboard.tokenOutput30d}
                  tokenCacheRead30d={projectDashboard.tokenCacheRead30d}
                  totalCost30d={projectDashboard.totalCost30d}
                  topModels={projectDashboard.topModels}
                  updatedAt={projectDashboard.updatedAt}
                  error={projectDashboard.error}
                  agentsDocument={agentsDocument}
                  agentsDraft={agentsDraft}
                  agentsLoading={agentsLoading}
                  agentsSaving={agentsSaving}
                  onAgentsDraftChange={setAgentsDraft}
                  onCreateAgents={() => void createAgentsDocument()}
                  onSaveAgents={() => void saveAgentsDocument()}
                  onRefreshAgents={() => void refreshAgentsDocument()}
                  onRefresh={() => void refreshProjectDashboard()}
                />
              )}
            </>
          ) : (
            <HomeDashboard
              loading={dashboard.loading}
              projects={dashboard.projects}
              sessions7d={dashboard.sessions7d}
              sessions30d={dashboard.sessions30d}
              providersConnected={dashboard.providersConnected}
              topModels={dashboard.topModels}
              tokenInput30d={dashboard.tokenInput30d}
              tokenOutput30d={dashboard.tokenOutput30d}
              tokenCacheRead30d={dashboard.tokenCacheRead30d}
              totalCost30d={dashboard.totalCost30d}
              recentSessions={dashboard.recentSessions}
              daySeries={dashboard.daySeries}
              updatedAt={dashboard.updatedAt}
              error={dashboard.error}
              onRefresh={() => void refreshDashboard()}
              onAddWorkspace={() => void addProjectDirectory()}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
        </main>
        {showOperationsPane ? (
          <button
            type="button"
            className="sidebar-resizer sidebar-resizer-right"
            aria-label="Resize operations sidebar"
            onMouseDown={(event) => startSidebarResize("right", event)}
          />
        ) : null}

        {showOperationsPane ? (
          <aside className="sidebar ops-pane">
            <div className="pane-header pane-header-empty" aria-hidden="true" />
            <section className="ops-toolbar">
              <IconButton
                icon="git"
                label="Git"
                className={`tab-icon ${opsPanelTab === "git" ? "active" : ""}`.trim()}
                onClick={() => setOpsPanelTab("git")}
              />
              <IconButton
                icon="files"
                label="Files"
                className={`tab-icon ${opsPanelTab === "files" ? "active" : ""}`.trim()}
                onClick={() => setOpsPanelTab("files")}
              />
              <IconButton
                icon="ops"
                label="Operations"
                className={`tab-icon ${opsPanelTab === "operations" ? "active" : ""}`.trim()}
                onClick={() => setOpsPanelTab("operations")}
              />
            </section>

            {opsPanelTab === "git" ? (
              <section className="ops-section ops-section-fill">
                <h3>Git</h3>
                <div className="ops-icon-row ops-icon-tabs">
                  <IconButton
                    icon="diff"
                    label="Diff"
                    className={gitPanelTab === "diff" ? "active" : ""}
                    onClick={() => void loadGitDiff()}
                  />
                  <IconButton
                    icon="log"
                    label="Log"
                    className={gitPanelTab === "log" ? "active" : ""}
                    onClick={() => void loadGitLog()}
                  />
                  <IconButton
                    icon="issues"
                    label="Issues"
                    className={gitPanelTab === "issues" ? "active" : ""}
                    onClick={() => void loadGitIssues()}
                  />
                  <IconButton
                    icon="pulls"
                    label="Pull requests"
                    className={gitPanelTab === "prs" ? "active" : ""}
                    onClick={() => void loadGitPrs()}
                  />
                </div>
                <pre className="ops-console">{gitPanelOutput}</pre>
              </section>
            ) : null}

            {opsPanelTab === "files" ? (
              <ProjectFilesPanel
                directory={activeProjectDir ?? ""}
                onAddToChatPath={appendPathToComposer}
                onStatus={(message) => setStatusLine(message)}
              />
            ) : null}

            {opsPanelTab === "operations" ? (
              <>
                <section className="ops-section">
                  <h3>Pending Permissions</h3>
                  {(projectData?.permissions ?? []).length === 0 ? <p>None</p> : null}
                  {(projectData?.permissions ?? []).map((permission) => (
                    <article key={permission.id} className="ops-card">
                      <div>{permission.permission}</div>
                      <small>{permission.patterns.join(", ")}</small>
                      <div className="ops-card-actions">
                        <button
                          type="button"
                          onClick={() =>
                            activeProjectDir &&
                            void window.orxa.opencode.replyPermission(activeProjectDir, permission.id, "once").then(() => queueRefresh("Permission replied"))
                          }
                        >
                          Once
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            activeProjectDir &&
                            void window.orxa.opencode.replyPermission(activeProjectDir, permission.id, "always").then(() => queueRefresh("Permission replied"))
                          }
                        >
                          Always
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (!activeProjectDir) {
                              return;
                            }
                            if (appPreferences.confirmDangerousActions && !window.confirm("Reject this permission request?")) {
                              return;
                            }
                            void window.orxa.opencode.replyPermission(activeProjectDir, permission.id, "reject").then(() => queueRefresh("Permission rejected"));
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="ops-section">
                  <h3>Pending Questions</h3>
                  {(projectData?.questions ?? []).length === 0 ? <p>None</p> : null}
                  {(projectData?.questions ?? []).map((question) => (
                    <article key={question.id} className="ops-card">
                      <div>{question.questions[0]?.header ?? "Question"}</div>
                      <small>{question.questions[0]?.question ?? ""}</small>
                      <div className="ops-card-actions">
                        {(question.questions[0]?.options ?? []).slice(0, 3).map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => {
                              if (!activeProjectDir) {
                                return;
                              }
                              const answers: QuestionAnswer[] = [[option.label]];
                              void window.orxa.opencode.replyQuestion(activeProjectDir, question.id, answers).then(() => queueRefresh("Question replied"));
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (!activeProjectDir) {
                              return;
                            }
                            if (appPreferences.confirmDangerousActions && !window.confirm("Reject this question request?")) {
                              return;
                            }
                            void window.orxa.opencode.rejectQuestion(activeProjectDir, question.id).then(() => queueRefresh("Question rejected"));
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </article>
                  ))}
                </section>

                <section className="ops-section">
                  <h3>Commands</h3>
                  <ul className="command-list">
                    {(projectData?.commands ?? []).map((command) => (
                      <li key={command.name}>
                        <strong>{command.name}</strong>
                        <span>{command.description}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>

      {contextMenu ? (
        <div className="context-menu-overlay" onClick={() => setContextMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div
            className="context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextMenu.kind === "project" ? (
              <>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const { directory, label } = contextMenu;
                    setContextMenu(null);
                    void removeProjectDirectory(directory, label);
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID } = contextMenu;
                    setContextMenu(null);
                    void archiveSession(directory, sessionID);
                  }}
                >
                  Archive Session
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { sessionID } = contextMenu;
                    setContextMenu(null);
                    void copySessionID(sessionID);
                  }}
                >
                  Copy Session ID
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID, title } = contextMenu;
                    setContextMenu(null);
                    void createWorktreeSession(directory, sessionID, title);
                  }}
                >
                  Create Worktree Session
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { directory, sessionID, title } = contextMenu;
                    setContextMenu(null);
                    void renameSession(directory, sessionID, title);
                  }}
                >
                  Rename Session
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {pendingPermission && activeProjectDir ? (
        <div className="overlay permission-overlay">
          <section className="modal permission-modal">
            <header className="modal-header">
              <h2>Permission Request</h2>
            </header>
            <div className="permission-modal-body">
              <p className="permission-title">{pendingPermission.permission}</p>
              <p className="permission-description">OpenCode is requesting edit access for the selected project.</p>
              <div className="permission-patterns">
                {(pendingPermission.patterns ?? []).map((pattern) => (
                  <code key={pattern}>{pattern}</code>
                ))}
              </div>
              <div className="permission-actions">
                <button
                  type="button"
                  disabled={permissionDecisionPending !== null}
                  onClick={() => void replyPendingPermission("once")}
                >
                  Allow once
                </button>
                <button
                  type="button"
                  disabled={permissionDecisionPending !== null}
                  onClick={() => void replyPendingPermission("always")}
                >
                  Allow session
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={permissionDecisionPending !== null}
                  onClick={() => void replyPendingPermission("reject")}
                >
                  Reject
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
                    <span className={`session-status-indicator ${busy ? "busy" : "idle"}`} aria-hidden="true" />
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
        <div className="overlay" onClick={() => setJobRunViewer(null)}>
          <section className="modal job-run-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>{jobRunViewer.jobName}</h2>
              <button type="button" onClick={() => setJobRunViewer(null)}>
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
        open={jobModalOpen}
        draft={jobDraft}
        projects={projects}
        onClose={() => setJobModalOpen(false)}
        onChange={updateJobDraft}
        onSave={saveJobDraft}
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
                    Add workspace
                  </button>
                </div>
              </label>
              <footer className="skill-use-actions">
                <button type="button" onClick={() => setSkillUseModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!skillUseModal.projectDir}
                  onClick={() => void applySkillToProject(skillUseModal.skill, skillUseModal.projectDir)}
                >
                  Prepare prompt
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
        onSave={async (profile: RuntimeProfileInput) => {
          await window.orxa.runtime.saveProfile(profile);
          await refreshProfiles();
          setStatusLine("Profile saved");
        }}
        onDelete={async (profileID) => {
          await window.orxa.runtime.deleteProfile(profileID);
          await refreshProfiles();
          setStatusLine("Profile deleted");
        }}
        onAttach={async (profileID) => {
          await window.orxa.runtime.attach(profileID);
          await refreshProfiles();
          await bootstrap();
          setStatusLine("Attached to server");
        }}
        onStartLocal={async (profileID) => {
          await window.orxa.runtime.startLocal(profileID);
          await refreshProfiles();
          await bootstrap();
          setStatusLine("Local server started");
        }}
        onStopLocal={async () => {
          await window.orxa.runtime.stopLocal();
          await refreshProfiles();
          setStatusLine("Local server stopped");
        }}
      />

      <SettingsDrawer
        open={settingsOpen}
        directory={activeProjectDir}
        onClose={() => setSettingsOpen(false)}
        onReadRaw={(scope, directory) => window.orxa.opencode.readRawConfig(scope, directory)}
        onWriteRaw={async (scope, content, directory) => {
          const doc = await window.orxa.opencode.writeRawConfig(scope, content, directory);
          if (scope === "global") {
            await refreshConfigModels();
          }
          if (directory) {
            await refreshProject(directory);
          }
          setStatusLine("Raw config saved");
          return doc;
        }}
        onReadOrxa={() => window.orxa.opencode.readOrxaConfig()}
        onWriteOrxa={async (content) => {
          const doc = await window.orxa.opencode.writeOrxaConfig(content);
          setStatusLine("Orxa config saved");
          await Promise.all([refreshOrxaState(), refreshConfigModels()]);
          await bootstrap();
          return doc;
        }}
        onListOrxaAgents={() => window.orxa.opencode.listOrxaAgents()}
        onSaveOrxaAgent={async (input) => {
          const saved = await window.orxa.opencode.saveOrxaAgent(input);
          await refreshOrxaState();
          setStatusLine(`Saved agent ${saved.name}`);
          return saved;
        }}
        appPreferences={appPreferences}
        onAppPreferencesChange={setAppPreferences}
        onGetServerDiagnostics={() => window.orxa.opencode.getServerDiagnostics()}
        onRepairRuntime={() => window.orxa.opencode.repairRuntime()}
        onGetOrxaAgentDetails={(name) => window.orxa.opencode.getOrxaAgentDetails(name)}
        onResetOrxaAgent={(name) => window.orxa.opencode.resetOrxaAgent(name)}
        onRestoreOrxaAgentHistory={(name, historyID) => window.orxa.opencode.restoreOrxaAgentHistory(name, historyID)}
      />
    </div>
  );
}
