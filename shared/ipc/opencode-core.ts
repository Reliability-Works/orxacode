import type {
  Agent,
  Command,
  Config,
  FileDiff,
  FormatterStatus,
  LspStatus,
  Message,
  McpStatus,
  Part,
  Path,
  PermissionRequest,
  ProviderListResponse,
  QuestionRequest,
  Session,
  SessionStatus,
  VcsInfo,
  Worktree,
} from "@opencode-ai/sdk/v2/client";

import type { RuntimeState } from "./runtime";
import type { OrxaTerminalSession } from "./terminal";

export type SessionMessageBundle = {
  info: Message;
  parts: Part[];
};

export type ProjectBootstrap = {
  directory: string;
  path: Path;
  sessions: Session[];
  sessionStatus: Record<string, SessionStatus>;
  providers: ProviderListResponse;
  agents: Agent[];
  config: Config;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  commands: Command[];
  mcp: Record<string, McpStatus>;
  lsp: LspStatus[];
  formatter: FormatterStatus[];
  vcs?: VcsInfo;
  ptys: OrxaTerminalSession[];
};

export type ProjectListItem = {
  id: string;
  name?: string;
  worktree: string;
  source: "local" | "opencode";
};

export type GlobalBootstrap = {
  projects: ProjectListItem[];
  runtime: RuntimeState;
};

export type WorktreeSessionResult = {
  worktree: Worktree;
  session: Session;
};

export type SessionRuntimeSnapshot = {
  directory: string;
  sessionID: string;
  session: Session | null;
  sessionStatus?: SessionStatus;
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  commands: Command[];
  messages: SessionMessageBundle[];
  sessionDiff: FileDiff[];
  executionLedger: ExecutionLedgerSnapshot;
  changeProvenance: SessionProvenanceSnapshot;
};

export type PromptRequest = {
  directory: string;
  sessionID: string;
  text: string;
  attachments?: Array<{
    url: string;
    mime: string;
    filename?: string;
  }>;
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  variant?: string;
  system?: string;
  promptSource?: "user" | "job" | "machine";
  tools?: Record<string, boolean>;
};

export type SessionPermissionMode = "ask-write" | "yolo-write";

export type ExecutionEventKind =
  | "read"
  | "search"
  | "edit"
  | "create"
  | "delete"
  | "run"
  | "git"
  | "todo"
  | "delegate"
  | "step"
  | "reasoning"
  | "error";

export type ExecutionEventActorType = "main" | "subagent" | "user" | "system";

export type ExecutionEventActor = {
  type: ExecutionEventActorType;
  name?: string;
};

export type ExecutionEventRecord = {
  id: string;
  directory: string;
  sessionID: string;
  timestamp: number;
  kind: ExecutionEventKind;
  summary: string;
  detail?: string;
  actor: ExecutionEventActor;
  model?: string;
  tool?: string;
  operation?: string;
  turnID?: string;
  delegationID?: string;
  eventID?: string;
  paths?: string[];
};

export type ExecutionLedgerSnapshot = {
  cursor: number;
  records: ExecutionEventRecord[];
};

export type ProvenanceActorType = "main" | "subagent" | "user" | "system";
export type ProvenanceOperation = "edit" | "create" | "delete";

export type ChangeProvenanceRecord = {
  filePath: string;
  operation: ProvenanceOperation;
  actorType: ProvenanceActorType;
  actorName?: string;
  model?: string;
  tool?: string;
  todoID?: string;
  delegationID?: string;
  turnID?: string;
  eventID: string;
  timestamp: number;
  reason?: string;
};

export type SessionProvenanceSnapshot = {
  cursor: number;
  records: ChangeProvenanceRecord[];
};

export type RawConfigDocument = {
  scope: "project" | "global";
  directory?: string;
  path: string;
  content: string;
};

export type ImageSelection = {
  path: string;
  url: string;
  filename: string;
  mime: string;
};

export type ProjectFileEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "file" | "directory";
  hasChildren?: boolean;
};

export type ProjectFileDocument = {
  path: string;
  relativePath: string;
  content: string;
  binary: boolean;
  truncated: boolean;
};

export type OpenCodeAgentFile = {
  name: string;
  filename: string;
  path: string;
  description: string;
  mode: string;
  model: string;
  temperature?: number;
  content: string;
};

export type OpenDirectoryTarget =
  | "cursor"
  | "antigravity"
  | "finder"
  | "terminal"
  | "ghostty"
  | "xcode"
  | "zed";

export type OpenDirectoryResult = {
  target: OpenDirectoryTarget;
  ok: boolean;
  detail: string;
};

export type GitCommitSummary = {
  repoRoot: string;
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitNextStep = "commit" | "commit_and_push" | "commit_and_create_pr";

export type GitCommitRequest = {
  includeUnstaged: boolean;
  message?: string;
  guidancePrompt?: string;
  baseBranch?: string;
  nextStep: GitCommitNextStep;
};

export type GitCommitResult = {
  repoRoot: string;
  branch: string;
  commitHash: string;
  message: string;
  pushed: boolean;
  prUrl?: string;
};

export type GitBranchState = {
  repoRoot: string;
  current: string;
  branches: string[];
};

export type SkillEntry = {
  id: string;
  name: string;
  description: string;
  path: string;
};

export type AgentsDocument = {
  path: string;
  content: string;
  exists: boolean;
};
