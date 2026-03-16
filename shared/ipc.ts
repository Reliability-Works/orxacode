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
  appOpenExternal: "orxa:app:openExternal",
  updatesGetPreferences: "orxa:updates:getPreferences",
  updatesSetPreferences: "orxa:updates:setPreferences",
  updatesCheckNow: "orxa:updates:checkNow",
  updatesDownloadAndInstall: "orxa:updates:downloadAndInstall",
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
  opencodeReadGlobalAgentsMd: "orxa:opencode:readGlobalAgentsMd",
  opencodeWriteGlobalAgentsMd: "orxa:opencode:writeGlobalAgentsMd",
  opencodeListAgentFiles: "orxa:opencode:listAgentFiles",
  opencodeReadAgentFile: "orxa:opencode:readAgentFile",
  opencodeWriteAgentFile: "orxa:opencode:writeAgentFile",
  opencodeDeleteAgentFile: "orxa:opencode:deleteAgentFile",
  opencodeOpenFileIn: "orxa:opencode:openFileIn",
  opencodeListFiles: "orxa:opencode:listFiles",
  opencodeCountProjectFiles: "orxa:opencode:countProjectFiles",
  opencodeReadProjectFile: "orxa:opencode:readProjectFile",
  opencodeArtifactsList: "orxa:opencode:artifacts:list",
  opencodeArtifactsGet: "orxa:opencode:artifacts:get",
  opencodeArtifactsDelete: "orxa:opencode:artifacts:delete",
  opencodeArtifactsListSessions: "orxa:opencode:artifacts:listSessions",
  opencodeArtifactsListWorkspaceSummary: "orxa:opencode:artifacts:listWorkspaceSummary",
  opencodeArtifactsGetRetention: "orxa:opencode:artifacts:getRetention",
  opencodeArtifactsSetRetention: "orxa:opencode:artifacts:setRetention",
  opencodeArtifactsPrune: "orxa:opencode:artifacts:prune",
  opencodeArtifactsExportBundle: "orxa:opencode:artifacts:exportBundle",
  opencodeContextList: "orxa:opencode:context:list",
  opencodeContextRead: "orxa:opencode:context:read",
  opencodeContextWrite: "orxa:opencode:context:write",
  opencodeContextDelete: "orxa:opencode:context:delete",
  opencodeMemoryGetSettings: "orxa:opencode:memory:getSettings",
  opencodeMemoryUpdateSettings: "orxa:opencode:memory:updateSettings",
  opencodeMemoryListTemplates: "orxa:opencode:memory:listTemplates",
  opencodeMemoryApplyTemplate: "orxa:opencode:memory:applyTemplate",
  opencodeMemoryGetGraph: "orxa:opencode:memory:getGraph",
  opencodeMemoryBackfill: "orxa:opencode:memory:backfill",
  opencodeMemoryClearWorkspace: "orxa:opencode:memory:clearWorkspace",
  opencodeGetServerDiagnostics: "orxa:opencode:getServerDiagnostics",
  opencodeRepairRuntime: "orxa:opencode:repairRuntime",
  terminalList: "orxa:terminal:list",
  terminalCreate: "orxa:terminal:create",
  terminalConnect: "orxa:terminal:connect",
  terminalWrite: "orxa:terminal:write",
  terminalResize: "orxa:terminal:resize",
  terminalClose: "orxa:terminal:close",
  browserGetState: "orxa:browser:getState",
  browserSetVisible: "orxa:browser:setVisible",
  browserSetBounds: "orxa:browser:setBounds",
  browserOpenTab: "orxa:browser:openTab",
  browserCloseTab: "orxa:browser:closeTab",
  browserSwitchTab: "orxa:browser:switchTab",
  browserNavigate: "orxa:browser:navigate",
  browserBack: "orxa:browser:back",
  browserForward: "orxa:browser:forward",
  browserReload: "orxa:browser:reload",
  browserListHistory: "orxa:browser:listHistory",
  browserClearHistory: "orxa:browser:clearHistory",
  browserPerformAgentAction: "orxa:browser:performAgentAction",
  mcpDevToolsStart: "orxa:mcp:devtools:start",
  mcpDevToolsStop: "orxa:mcp:devtools:stop",
  mcpDevToolsGetStatus: "orxa:mcp:devtools:getStatus",
  mcpDevToolsListTools: "orxa:mcp:devtools:listTools",
  appOpenFile: "orxa:app:openFile",
  appScanPorts: "orxa:app:scanPorts",
  appHttpRequest: "orxa:app:httpRequest",
  codexStart: "orxa:codex:start",
  codexStop: "orxa:codex:stop",
  codexGetState: "orxa:codex:getState",
  codexStartThread: "orxa:codex:startThread",
  codexListThreads: "orxa:codex:listThreads",
  codexStartTurn: "orxa:codex:startTurn",
  codexApprove: "orxa:codex:approve",
  codexDeny: "orxa:codex:deny",
  claudeTerminalCreate: "orxa:claude-terminal:create",
  claudeTerminalWrite: "orxa:claude-terminal:write",
  claudeTerminalResize: "orxa:claude-terminal:resize",
  claudeTerminalClose: "orxa:claude-terminal:close",
  events: "orxa:events",
} as const;

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
  contextModeEnabled?: boolean;
  promptSource?: "user" | "job" | "machine";
  tools?: Record<string, boolean>;
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

export type ArtifactKind = "browser.screenshot" | "context.selection";

export type ArtifactRecord = {
  id: string;
  workspace: string;
  workspaceHash: string;
  sessionID: string;
  kind: ArtifactKind;
  createdAt: number;
  mime?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  title?: string;
  url?: string;
  actionID?: string;
  artifactPath?: string;
  fileUrl?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactListQuery = {
  workspace?: string;
  sessionID?: string;
  kind?: ArtifactKind | ArtifactKind[];
  limit?: number;
};

export type ArtifactSessionSummary = {
  sessionID: string;
  artifacts: number;
  screenshots: number;
  contextSelections: number;
  bytes: number;
  lastCreatedAt?: number;
};

export type WorkspaceArtifactSummary = {
  workspace: string;
  workspaceHash: string;
  sessions: number;
  artifacts: number;
  screenshots: number;
  contextSelections: number;
  bytes: number;
  lastCreatedAt?: number;
};

export type ArtifactRetentionPolicy = {
  maxBytes: number;
  totalBytes: number;
  artifactCount: number;
  fileArtifactCount: number;
  updatedAt: number;
};

export type ArtifactRetentionUpdateInput = {
  maxBytes: number;
};

export type ArtifactPruneResult = {
  removed: number;
  removedBytes: number;
  totalBytes: number;
  artifactCount: number;
  maxBytes: number;
};

export type ArtifactExportBundleInput = {
  workspace: string;
  sessionID?: string;
  kind?: ArtifactKind | ArtifactKind[];
  limit?: number;
};

export type ArtifactExportBundleResult = {
  bundlePath: string;
  manifestPath: string;
  exportedArtifacts: number;
  copiedFiles: number;
  totalBytes: number;
  createdAt: number;
};

export type WorkspaceContextFile = {
  id: string;
  workspace: string;
  filename: string;
  path: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceContextWriteInput = {
  workspace: string;
  id?: string;
  filename?: string;
  title?: string;
  content: string;
};

export type ContextSelectionTrace = {
  id: string;
  workspace: string;
  sessionID: string;
  query: string;
  mode: "hybrid_lexical_v1";
  selected: Array<{
    contextID: string;
    filename: string;
    title: string;
    heading: string;
    score: number;
    snippet: string;
  }>;
  createdAt: number;
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

export type ServerDiagnostics = {
  runtime: RuntimeState;
  activeProfile?: RuntimeProfile;
  health: "connected" | "disconnected" | "error";
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

export type ClaudeTerminalCreateResult = {
  processId: string;
  directory: string;
};

export type ClaudeTerminalMode = "standard" | "full";

export type McpDevToolsServerState = "stopped" | "starting" | "running" | "error";

export type McpDevToolsServerStatus = {
  state: McpDevToolsServerState;
  cdpPort?: number;
  error?: string;
};

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastNavigatedAt?: number;
};

export type BrowserState = {
  partition: string;
  bounds: BrowserBounds;
  tabs: BrowserTab[];
  activeTabID?: string;
};

export type BrowserHistoryItem = {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
};

export type BrowserLocator = {
  selector?: string;
  selectors?: string[];
  text?: string;
  role?: string;
  name?: string;
  label?: string;
  frameSelector?: string;
  includeShadowDom?: boolean;
  exact?: boolean;
};

export type BrowserAgentActionRequest =
  | {
      action: "open_tab";
      url?: string;
      activate?: boolean;
    }
  | {
      action: "close_tab";
      tabID?: string;
    }
  | {
      action: "switch_tab";
      tabID: string;
    }
  | {
      action: "navigate";
      url: string;
      tabID?: string;
    }
  | {
      action: "back";
      tabID?: string;
    }
  | {
      action: "forward";
      tabID?: string;
    }
  | {
      action: "reload";
      tabID?: string;
    }
  | {
      action: "click";
      tabID?: string;
      selector?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
      maxAttempts?: number;
      waitForNavigation?: boolean;
    }
  | {
      action: "type";
      text: string;
      tabID?: string;
      selector?: string;
      locator?: BrowserLocator;
      submit?: boolean;
      clear?: boolean;
      timeoutMs?: number;
      maxAttempts?: number;
    }
  | {
      action: "press";
      key: string;
      tabID?: string;
    }
  | {
      action: "scroll";
      tabID?: string;
      x?: number;
      y?: number;
      top?: number;
      left?: number;
      behavior?: "auto" | "smooth";
    }
  | {
      action: "extract_text";
      selector?: string;
      tabID?: string;
      maxLength?: number;
      locator?: BrowserLocator;
      timeoutMs?: number;
      maxAttempts?: number;
    }
  | {
      action: "exists";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
    }
  | {
      action: "visible";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
    }
  | {
      action: "wait_for";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
      state?: "attached" | "visible" | "hidden";
    }
  | {
      action: "wait_for_navigation";
      tabID?: string;
      timeoutMs?: number;
    }
  | {
      action: "wait_for_idle";
      tabID?: string;
      timeoutMs?: number;
      idleMs?: number;
    }
  | {
      action: "screenshot";
      tabID?: string;
      format?: "png" | "jpeg";
      quality?: number;
      bounds?: Partial<BrowserBounds>;
      workspace?: string;
      sessionID?: string;
      actionID?: string;
    };

export type BrowserAgentActionResult = {
  action: BrowserAgentActionRequest["action"];
  ok: boolean;
  state: BrowserState;
  tabID?: string;
  data?: Record<string, unknown>;
  error?: string;
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
      type: "claude-terminal.output";
      payload: {
        processId: string;
        directory: string;
        chunk: string;
      };
    }
  | {
      type: "claude-terminal.closed";
      payload: {
        processId: string;
        directory: string;
        exitCode: number | null;
      };
    }
  | {
      type: "updater.telemetry";
      payload: {
        phase:
          | "check.start"
          | "check.success"
          | "check.error"
          | "update.available"
          | "download.start"
          | "download.progress"
          | "download.complete"
          | "install.start";
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
    }
  | {
      type: "browser.state";
      payload: BrowserState;
    }
  | {
      type: "browser.history.added";
      payload: BrowserHistoryItem;
    }
  | {
      type: "browser.history.cleared";
      payload: {
        count: number;
      };
    }
  | {
      type: "browser.agent.action";
      payload: BrowserAgentActionResult;
    }
  | {
      type: "artifact.created";
      payload: ArtifactRecord;
    }
  | {
      type: "context.selection";
      payload: ContextSelectionTrace;
    }
  | {
      type: "mcp.devtools.status";
      payload: McpDevToolsServerStatus;
    }
  | {
      type: "codex.state";
      payload: CodexState;
    }
  | {
      type: "codex.notification";
      payload: CodexNotification;
    }
  | {
      type: "codex.approval";
      payload: CodexApprovalRequest;
    };

export type CodexConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type CodexState = {
  status: CodexConnectionStatus;
  serverInfo?: { name: string; version: string };
  lastError?: string;
};

export type CodexThread = {
  id: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  status?: { type: string };
  ephemeral?: boolean;
};

export type CodexNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexApprovalRequest = {
  id: number;
  method: string;
  itemId: string;
  threadId: string;
  turnId: string;
  reason: string;
  command?: string[];
  commandActions?: string[];
  availableDecisions: string[];
  changes?: Array<{
    path: string;
    type: string;
    insertions?: number;
    deletions?: number;
  }>;
};

export type OpenFileOptions = {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export type OpenFileResult = {
  path: string;
  filename: string;
  url: string;
};

export type ListeningPort = {
  port: number;
  pid: number;
  process: string;
  command: string;
};

export type HttpRequestOptions = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

export type HttpRequestResult = {
  status: number;
  headers: Record<string, string>;
  body: string;
  elapsed: number;
};

export interface OrxaBridge {
  app: {
    openExternal: (url: string) => Promise<boolean>;
    openFile: (options?: OpenFileOptions) => Promise<OpenFileResult | undefined>;
    scanPorts: (directory?: string) => Promise<ListeningPort[]>;
    httpRequest: (options: HttpRequestOptions) => Promise<HttpRequestResult>;
  };
  updates: {
    getPreferences: () => Promise<UpdatePreferences>;
    setPreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>;
    checkNow: () => Promise<UpdateCheckResult>;
    downloadAndInstall: () => Promise<UpdateCheckResult>;
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
    readGlobalAgentsMd: () => Promise<AgentsDocument>;
    writeGlobalAgentsMd: (content: string) => Promise<AgentsDocument>;
    listAgentFiles: () => Promise<OpenCodeAgentFile[]>;
    readAgentFile: (filename: string) => Promise<OpenCodeAgentFile>;
    writeAgentFile: (filename: string, content: string) => Promise<OpenCodeAgentFile>;
    deleteAgentFile: (filename: string) => Promise<boolean>;
    openFileIn: (filePath: string, target: OpenDirectoryTarget) => Promise<OpenDirectoryResult>;
    listFiles: (directory: string, relativePath?: string) => Promise<ProjectFileEntry[]>;
    countProjectFiles: (directory: string) => Promise<number>;
    readProjectFile: (directory: string, relativePath: string) => Promise<ProjectFileDocument>;
    listArtifacts: (query?: ArtifactListQuery) => Promise<ArtifactRecord[]>;
    getArtifact: (id: string) => Promise<ArtifactRecord | undefined>;
    deleteArtifact: (id: string) => Promise<boolean>;
    listArtifactSessions: (workspace: string) => Promise<ArtifactSessionSummary[]>;
    listWorkspaceArtifactSummary: (workspace: string) => Promise<WorkspaceArtifactSummary>;
    getArtifactRetentionPolicy: () => Promise<ArtifactRetentionPolicy>;
    setArtifactRetentionPolicy: (input: ArtifactRetentionUpdateInput) => Promise<ArtifactRetentionPolicy>;
    pruneArtifactsNow: (workspace?: string) => Promise<ArtifactPruneResult>;
    exportArtifactBundle: (input: ArtifactExportBundleInput) => Promise<ArtifactExportBundleResult>;
    listWorkspaceContext: (workspace: string) => Promise<WorkspaceContextFile[]>;
    readWorkspaceContext: (workspace: string, id: string) => Promise<WorkspaceContextFile>;
    writeWorkspaceContext: (input: WorkspaceContextWriteInput) => Promise<WorkspaceContextFile>;
    deleteWorkspaceContext: (workspace: string, id: string) => Promise<boolean>;
    getMemorySettings: (directory?: string) => Promise<MemorySettings>;
    updateMemorySettings: (input: MemorySettingsUpdateInput) => Promise<MemorySettings>;
    listMemoryTemplates: () => Promise<MemoryTemplate[]>;
    applyMemoryTemplate: (templateID: string, directory?: string, scope?: "global" | "workspace") => Promise<MemorySettings>;
    getMemoryGraph: (input?: MemoryGraphQuery) => Promise<MemoryGraphSnapshot>;
    backfillMemory: (directory?: string) => Promise<MemoryBackfillStatus>;
    clearWorkspaceMemory: (directory: string) => Promise<boolean>;
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
  claudeTerminal: {
    create: (directory: string, mode: ClaudeTerminalMode, cols?: number, rows?: number) => Promise<ClaudeTerminalCreateResult>;
    write: (processId: string, data: string) => Promise<boolean>;
    resize: (processId: string, cols: number, rows: number) => Promise<boolean>;
    close: (processId: string) => Promise<boolean>;
  };
  browser: {
    getState: () => Promise<BrowserState>;
    setVisible: (visible: boolean) => Promise<BrowserState>;
    setBounds: (bounds: BrowserBounds) => Promise<BrowserState>;
    openTab: (url?: string, activate?: boolean) => Promise<BrowserState>;
    closeTab: (tabID?: string) => Promise<BrowserState>;
    switchTab: (tabID: string) => Promise<BrowserState>;
    navigate: (url: string, tabID?: string) => Promise<BrowserState>;
    back: (tabID?: string) => Promise<BrowserState>;
    forward: (tabID?: string) => Promise<BrowserState>;
    reload: (tabID?: string) => Promise<BrowserState>;
    listHistory: (limit?: number) => Promise<BrowserHistoryItem[]>;
    clearHistory: () => Promise<BrowserHistoryItem[]>;
    performAgentAction: (request: BrowserAgentActionRequest) => Promise<BrowserAgentActionResult>;
  };
  mcpDevTools: {
    start: (directory: string) => Promise<McpDevToolsServerStatus>;
    stop: (directory: string) => Promise<McpDevToolsServerStatus>;
    getStatus: (directory: string) => Promise<McpDevToolsServerStatus>;
    listTools: () => Promise<unknown[]>;
  };
  codex: {
    start: (cwd?: string) => Promise<CodexState>;
    stop: () => Promise<CodexState>;
    getState: () => Promise<CodexState>;
    startThread: (options?: { model?: string; cwd?: string; title?: string }) => Promise<CodexThread>;
    listThreads: (options?: { cursor?: string | null; limit?: number; archived?: boolean }) => Promise<{ threads: CodexThread[]; nextCursor?: string }>;
    startTurn: (threadId: string, prompt: string, cwd?: string) => Promise<void>;
    approve: (requestId: number, decision: string) => Promise<void>;
    deny: (requestId: number) => Promise<void>;
  };
  events: {
    subscribe: (listener: (event: OrxaEvent) => void) => () => void;
  };
}
