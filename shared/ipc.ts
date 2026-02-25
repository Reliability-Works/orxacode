import type {
  Agent,
  Command,
  Config,
  FormatterStatus,
  LspStatus,
  Message,
  McpStatus,
  Part,
  Path,
  PermissionRequest,
  ProviderListResponse,
  Pty,
  QuestionAnswer,
  QuestionRequest,
  Session,
  SessionStatus,
  VcsInfo,
  Worktree,
} from "@opencode-ai/sdk/v2/client";

export const IPC = {
  modeGet: "orxa:mode:get",
  modeSet: "orxa:mode:set",
  updatesGetPreferences: "orxa:updates:getPreferences",
  updatesSetPreferences: "orxa:updates:setPreferences",
  updatesCheckNow: "orxa:updates:checkNow",
  runtimeGetState: "orxa:runtime:getState",
  runtimeListProfiles: "orxa:runtime:listProfiles",
  runtimeSaveProfile: "orxa:runtime:saveProfile",
  runtimeDeleteProfile: "orxa:runtime:deleteProfile",
  runtimeAttach: "orxa:runtime:attach",
  runtimeStartLocal: "orxa:runtime:startLocal",
  runtimeStopLocal: "orxa:runtime:stopLocal",
  opencodeBootstrap: "orxa:opencode:bootstrap",
  opencodeCheckDependencies: "orxa:opencode:checkDependencies",
  opencodeAddProjectDirectory: "orxa:opencode:addProjectDirectory",
  opencodeRemoveProjectDirectory: "orxa:opencode:removeProjectDirectory",
  opencodeSelectProject: "orxa:opencode:selectProject",
  opencodeRefreshProject: "orxa:opencode:refreshProject",
  opencodeCreateSession: "orxa:opencode:createSession",
  opencodeDeleteSession: "orxa:opencode:deleteSession",
  opencodeAbortSession: "orxa:opencode:abortSession",
  opencodeRenameSession: "orxa:opencode:renameSession",
  opencodeArchiveSession: "orxa:opencode:archiveSession",
  opencodeCreateWorktreeSession: "orxa:opencode:createWorktreeSession",
  opencodeLoadMessages: "orxa:opencode:loadMessages",
  opencodeLoadExecutionLedger: "orxa:opencode:loadExecutionLedger",
  opencodeClearExecutionLedger: "orxa:opencode:clearExecutionLedger",
  opencodeLoadChangeProvenance: "orxa:opencode:loadChangeProvenance",
  opencodeGetFileProvenance: "orxa:opencode:getFileProvenance",
  opencodeSendPrompt: "orxa:opencode:sendPrompt",
  opencodeReplyPermission: "orxa:opencode:replyPermission",
  opencodeReplyQuestion: "orxa:opencode:replyQuestion",
  opencodeRejectQuestion: "orxa:opencode:rejectQuestion",
  opencodeGetConfig: "orxa:opencode:getConfig",
  opencodeUpdateConfig: "orxa:opencode:updateConfig",
  opencodeReadRawConfig: "orxa:opencode:readRawConfig",
  opencodeWriteRawConfig: "orxa:opencode:writeRawConfig",
  opencodeListProviders: "orxa:opencode:listProviders",
  opencodePickImage: "orxa:opencode:pickImage",
  opencodeGitDiff: "orxa:opencode:gitDiff",
  opencodeGitLog: "orxa:opencode:gitLog",
  opencodeGitIssues: "orxa:opencode:gitIssues",
  opencodeGitPrs: "orxa:opencode:gitPrs",
  opencodeOpenDirectoryIn: "orxa:opencode:openDirectoryIn",
  opencodeGitCommitSummary: "orxa:opencode:gitCommitSummary",
  opencodeGitGenerateCommitMessage: "orxa:opencode:gitGenerateCommitMessage",
  opencodeGitCommit: "orxa:opencode:gitCommit",
  opencodeGitBranches: "orxa:opencode:gitBranches",
  opencodeGitCheckoutBranch: "orxa:opencode:gitCheckoutBranch",
  opencodeGitStageAll: "orxa:opencode:gitStageAll",
  opencodeGitRestoreAllUnstaged: "orxa:opencode:gitRestoreAllUnstaged",
  opencodeGitStagePath: "orxa:opencode:gitStagePath",
  opencodeGitRestorePath: "orxa:opencode:gitRestorePath",
  opencodeGitUnstagePath: "orxa:opencode:gitUnstagePath",
  opencodeListSkills: "orxa:opencode:listSkills",
  opencodeReadAgentsMd: "orxa:opencode:readAgentsMd",
  opencodeWriteAgentsMd: "orxa:opencode:writeAgentsMd",
  opencodeListAgentFiles: "orxa:opencode:listAgentFiles",
  opencodeReadAgentFile: "orxa:opencode:readAgentFile",
  opencodeWriteAgentFile: "orxa:opencode:writeAgentFile",
  opencodeDeleteAgentFile: "orxa:opencode:deleteAgentFile",
  opencodeOpenFileIn: "orxa:opencode:openFileIn",
  opencodeListFiles: "orxa:opencode:listFiles",
  opencodeCountProjectFiles: "orxa:opencode:countProjectFiles",
  opencodeReadProjectFile: "orxa:opencode:readProjectFile",
  opencodeMemoryGetSettings: "orxa:opencode:memory:getSettings",
  opencodeMemoryUpdateSettings: "orxa:opencode:memory:updateSettings",
  opencodeMemoryListTemplates: "orxa:opencode:memory:listTemplates",
  opencodeMemoryApplyTemplate: "orxa:opencode:memory:applyTemplate",
  opencodeMemoryGetGraph: "orxa:opencode:memory:getGraph",
  opencodeMemoryBackfill: "orxa:opencode:memory:backfill",
  opencodeMemoryClearWorkspace: "orxa:opencode:memory:clearWorkspace",
  orxaReadConfig: "orxa:orxa:readConfig",
  orxaWriteConfig: "orxa:orxa:writeConfig",
  orxaReadAgentPrompt: "orxa:orxa:readAgentPrompt",
  orxaListAgents: "orxa:orxa:listAgents",
  orxaSaveAgent: "orxa:orxa:saveAgent",
  orxaGetAgentDetails: "orxa:orxa:getAgentDetails",
  orxaResetAgent: "orxa:orxa:resetAgent",
  orxaRestoreAgentHistory: "orxa:orxa:restoreAgentHistory",
  orxaGetServerDiagnostics: "orxa:orxa:getServerDiagnostics",
  orxaRepairRuntime: "orxa:orxa:repairRuntime",
  terminalList: "orxa:terminal:list",
  terminalCreate: "orxa:terminal:create",
  terminalConnect: "orxa:terminal:connect",
  terminalWrite: "orxa:terminal:write",
  terminalResize: "orxa:terminal:resize",
  terminalClose: "orxa:terminal:close",
  events: "orxa:events",
} as const;

export type AppMode = "orxa" | "standard";

export type UpdateReleaseChannel = "stable" | "prerelease";

export type UpdatePreferences = {
  autoCheckEnabled: boolean;
  releaseChannel: UpdateReleaseChannel;
};

export type UpdateCheckResult = {
  ok: boolean;
  status: "started" | "skipped" | "error";
  message?: string;
};

export type RuntimeProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  https: boolean;
  username?: string;
  hasPassword: boolean;
  startCommand: boolean;
  startHost: string;
  startPort: number;
  cliPath?: string;
  corsOrigins: string[];
};

export type RuntimeProfileInput = Omit<RuntimeProfile, "id" | "hasPassword"> & {
  id?: string;
  password?: string;
};

export type RuntimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "starting"
  | "error";

export type RuntimeState = {
  status: RuntimeConnectionStatus;
  activeProfileId?: string;
  baseUrl?: string;
  managedServer: boolean;
  lastError?: string;
};

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
  ptys: Pty[];
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
};

export type SessionPermissionMode = "ask-write" | "yolo-write";

export type MemoryPolicyMode = "conservative" | "balanced" | "aggressive" | "codebase-facts";

export type MemoryPolicy = {
  enabled: boolean;
  mode: MemoryPolicyMode;
  guidance: string;
  maxPromptMemories: number;
  maxCapturePerSession: number;
};

export type MemorySettings = {
  global: MemoryPolicy;
  directory?: string;
  workspace?: MemoryPolicy;
  hasWorkspaceOverride: boolean;
};

export type MemorySettingsUpdateInput = {
  directory?: string;
  global?: Partial<MemoryPolicy>;
  workspace?: Partial<MemoryPolicy>;
  clearWorkspaceOverride?: boolean;
};

export type MemoryTemplate = {
  id: string;
  name: string;
  description: string;
  policy: MemoryPolicy;
};

export type MemoryNode = {
  id: string;
  workspace: string;
  summary: string;
  content: string;
  confidence: number;
  tags: string[];
  source: {
    sessionID?: string;
    messageID?: string;
    actor?: string;
  };
  createdAt: number;
  updatedAt: number;
};

export type MemoryEdge = {
  id: string;
  workspace: string;
  from: string;
  to: string;
  relation: string;
  weight: number;
  createdAt: number;
  updatedAt: number;
};

export type MemoryGraphQuery = {
  workspace?: string;
  query?: string;
  relation?: string;
  limit?: number;
};

export type MemoryGraphSnapshot = {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  workspaces: string[];
  updatedAt: number;
};

export type MemoryBackfillStatus = {
  running: boolean;
  progress: number;
  scannedSessions: number;
  totalSessions: number;
  inserted: number;
  updated: number;
  startedAt?: number;
  completedAt?: number;
  message?: string;
};

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

export type OrxaAgentDocument = {
  name: string;
  mode: "primary" | "subagent" | "all";
  description?: string;
  model?: string;
  prompt?: string;
  path: string;
  source: "base" | "override" | "custom";
};

export type OrxaAgentHistoryDocument = {
  id: string;
  path: string;
  updatedAt: number;
  model?: string;
  prompt?: string;
};

export type OrxaAgentDetails = {
  current?: OrxaAgentDocument;
  base?: OrxaAgentDocument;
  override?: OrxaAgentDocument;
  history: OrxaAgentHistoryDocument[];
};

export type ServerDiagnostics = {
  runtime: RuntimeState;
  activeProfile?: RuntimeProfile;
  health: "connected" | "disconnected" | "error";
  plugin: {
    specifier: string;
    configPath: string;
    installedPath: string;
    configured: boolean;
    installed: boolean;
  };
  lastError?: string;
};

export type RuntimeDependency = {
  key: "opencode" | "orxa";
  label: string;
  required: boolean;
  installed: boolean;
  description: string;
  reason: string;
  installCommand: string;
  sourceUrl: string;
};

export type RuntimeDependencyReport = {
  checkedAt: number;
  dependencies: RuntimeDependency[];
  missingAny: boolean;
  missingRequired: boolean;
};

export type TerminalConnectResult = {
  ptyID: string;
  directory: string;
  connected: boolean;
};

type StreamEventSummary = {
  type: string;
  properties?: Record<string, unknown>;
};

export type OrxaEvent =
  | {
      type: "runtime.status";
      payload: RuntimeState;
    }
  | {
      type: "runtime.error";
      payload: {
        message: string;
      };
    }
  | {
      type: "opencode.global";
      payload: {
        directory?: string;
        event: StreamEventSummary;
      };
    }
  | {
      type: "opencode.project";
      payload: {
        directory: string;
        event: StreamEventSummary;
      };
    }
  | {
      type: "pty.output";
      payload: {
        ptyID: string;
        directory: string;
        chunk: string;
      };
    }
  | {
      type: "pty.closed";
      payload: {
        ptyID: string;
        directory: string;
      };
    }
  | {
      type: "updater.telemetry";
      payload: {
        phase: "check.start" | "check.success" | "check.error" | "download.progress" | "download.complete";
        manual: boolean;
        releaseChannel: UpdateReleaseChannel;
        durationMs?: number;
        percent?: number;
        message?: string;
        version?: string;
      };
    }
  | {
      type: "memory.backfill";
      payload: MemoryBackfillStatus;
    };

export interface OrxaBridge {
  mode: {
    get: () => Promise<AppMode>;
    set: (mode: AppMode) => Promise<AppMode>;
  };
  updates: {
    getPreferences: () => Promise<UpdatePreferences>;
    setPreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>;
    checkNow: () => Promise<UpdateCheckResult>;
  };
  runtime: {
    getState: () => Promise<RuntimeState>;
    listProfiles: () => Promise<RuntimeProfile[]>;
    saveProfile: (profile: RuntimeProfileInput) => Promise<RuntimeProfile[]>;
    deleteProfile: (id: string) => Promise<RuntimeProfile[]>;
    attach: (profileID: string) => Promise<RuntimeState>;
    startLocal: (profileID: string) => Promise<RuntimeState>;
    stopLocal: () => Promise<RuntimeState>;
  };
  opencode: {
    bootstrap: () => Promise<GlobalBootstrap>;
    checkDependencies: () => Promise<RuntimeDependencyReport>;
    addProjectDirectory: () => Promise<string | undefined>;
    removeProjectDirectory: (directory: string) => Promise<boolean>;
    selectProject: (directory: string) => Promise<ProjectBootstrap>;
    refreshProject: (directory: string) => Promise<ProjectBootstrap>;
    createSession: (directory: string, title?: string, permissionMode?: SessionPermissionMode) => Promise<Session>;
    deleteSession: (directory: string, sessionID: string) => Promise<boolean>;
    abortSession: (directory: string, sessionID: string) => Promise<boolean>;
    renameSession: (directory: string, sessionID: string, title: string) => Promise<Session>;
    archiveSession: (directory: string, sessionID: string) => Promise<Session>;
    createWorktreeSession: (directory: string, sessionID: string, name?: string) => Promise<WorktreeSessionResult>;
    loadMessages: (directory: string, sessionID: string) => Promise<SessionMessageBundle[]>;
    loadExecutionLedger: (directory: string, sessionID: string, cursor?: number) => Promise<ExecutionLedgerSnapshot>;
    clearExecutionLedger: (directory: string, sessionID: string) => Promise<boolean>;
    loadChangeProvenance: (directory: string, sessionID: string, cursor?: number) => Promise<SessionProvenanceSnapshot>;
    getFileProvenance: (directory: string, sessionID: string, relativePath: string) => Promise<ChangeProvenanceRecord[]>;
    sendPrompt: (input: PromptRequest) => Promise<boolean>;
    replyPermission: (
      directory: string,
      requestID: string,
      reply: "once" | "always" | "reject",
      message?: string,
    ) => Promise<boolean>;
    replyQuestion: (directory: string, requestID: string, answers: QuestionAnswer[]) => Promise<boolean>;
    rejectQuestion: (directory: string, requestID: string) => Promise<boolean>;
    getConfig: (scope: "project" | "global", directory?: string) => Promise<Config>;
    updateConfig: (scope: "project" | "global", patch: Config, directory?: string) => Promise<Config>;
    readRawConfig: (scope: "project" | "global", directory?: string) => Promise<RawConfigDocument>;
    writeRawConfig: (scope: "project" | "global", content: string, directory?: string) => Promise<RawConfigDocument>;
    listProviders: (directory?: string) => Promise<ProviderListResponse>;
    pickImage: () => Promise<ImageSelection | undefined>;
    gitDiff: (directory: string) => Promise<string>;
    gitLog: (directory: string) => Promise<string>;
    gitIssues: (directory: string) => Promise<string>;
    gitPrs: (directory: string) => Promise<string>;
    openDirectoryIn: (directory: string, target: OpenDirectoryTarget) => Promise<OpenDirectoryResult>;
    gitCommitSummary: (directory: string, includeUnstaged: boolean) => Promise<GitCommitSummary>;
    gitGenerateCommitMessage: (directory: string, includeUnstaged: boolean, guidancePrompt: string) => Promise<string>;
    gitCommit: (directory: string, request: GitCommitRequest) => Promise<GitCommitResult>;
    gitBranches: (directory: string) => Promise<GitBranchState>;
    gitCheckoutBranch: (directory: string, branch: string) => Promise<GitBranchState>;
    gitStageAll: (directory: string) => Promise<boolean>;
    gitRestoreAllUnstaged: (directory: string) => Promise<boolean>;
    gitStagePath: (directory: string, filePath: string) => Promise<boolean>;
    gitRestorePath: (directory: string, filePath: string) => Promise<boolean>;
    gitUnstagePath: (directory: string, filePath: string) => Promise<boolean>;
    listSkills: () => Promise<SkillEntry[]>;
    readAgentsMd: (directory: string) => Promise<AgentsDocument>;
    writeAgentsMd: (directory: string, content: string) => Promise<AgentsDocument>;
    listAgentFiles: () => Promise<OpenCodeAgentFile[]>;
    readAgentFile: (filename: string) => Promise<OpenCodeAgentFile>;
    writeAgentFile: (filename: string, content: string) => Promise<OpenCodeAgentFile>;
    deleteAgentFile: (filename: string) => Promise<boolean>;
    openFileIn: (filePath: string, target: OpenDirectoryTarget) => Promise<OpenDirectoryResult>;
    listFiles: (directory: string, relativePath?: string) => Promise<ProjectFileEntry[]>;
    countProjectFiles: (directory: string) => Promise<number>;
    readProjectFile: (directory: string, relativePath: string) => Promise<ProjectFileDocument>;
    getMemorySettings: (directory?: string) => Promise<MemorySettings>;
    updateMemorySettings: (input: MemorySettingsUpdateInput) => Promise<MemorySettings>;
    listMemoryTemplates: () => Promise<MemoryTemplate[]>;
    applyMemoryTemplate: (templateID: string, directory?: string, scope?: "global" | "workspace") => Promise<MemorySettings>;
    getMemoryGraph: (input?: MemoryGraphQuery) => Promise<MemoryGraphSnapshot>;
    backfillMemory: (directory?: string) => Promise<MemoryBackfillStatus>;
    clearWorkspaceMemory: (directory: string) => Promise<boolean>;
    readOrxaConfig: () => Promise<RawConfigDocument>;
    writeOrxaConfig: (content: string) => Promise<RawConfigDocument>;
    readOrxaAgentPrompt: (agent: "orxa" | "plan") => Promise<string | undefined>;
    listOrxaAgents: () => Promise<OrxaAgentDocument[]>;
    saveOrxaAgent: (input: {
      name: string;
      mode: "primary" | "subagent" | "all";
      description?: string;
      model?: string;
      prompt?: string;
    }) => Promise<OrxaAgentDocument>;
    getOrxaAgentDetails: (name: string) => Promise<OrxaAgentDetails>;
    resetOrxaAgent: (name: string) => Promise<OrxaAgentDocument | undefined>;
    restoreOrxaAgentHistory: (name: string, historyID: string) => Promise<OrxaAgentDocument | undefined>;
    getServerDiagnostics: () => Promise<ServerDiagnostics>;
    repairRuntime: () => Promise<ServerDiagnostics>;
  };
  terminal: {
    list: (directory: string) => Promise<Pty[]>;
    create: (directory: string, cwd?: string, title?: string) => Promise<Pty>;
    connect: (directory: string, ptyID: string) => Promise<TerminalConnectResult>;
    write: (directory: string, ptyID: string, data: string) => Promise<boolean>;
    resize: (directory: string, ptyID: string, cols: number, rows: number) => Promise<boolean>;
    close: (directory: string, ptyID: string) => Promise<boolean>;
  };
  events: {
    subscribe: (listener: (event: OrxaEvent) => void) => () => void;
  };
}
