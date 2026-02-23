import type {
  Agent,
  Command,
  Config,
  Event,
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
  runtimeGetState: "orxa:runtime:getState",
  runtimeListProfiles: "orxa:runtime:listProfiles",
  runtimeSaveProfile: "orxa:runtime:saveProfile",
  runtimeDeleteProfile: "orxa:runtime:deleteProfile",
  runtimeAttach: "orxa:runtime:attach",
  runtimeStartLocal: "orxa:runtime:startLocal",
  runtimeStopLocal: "orxa:runtime:stopLocal",
  opencodeBootstrap: "orxa:opencode:bootstrap",
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
  opencodeSendPrompt: "orxa:opencode:sendPrompt",
  opencodeReplyPermission: "orxa:opencode:replyPermission",
  opencodeReplyQuestion: "orxa:opencode:replyQuestion",
  opencodeRejectQuestion: "orxa:opencode:rejectQuestion",
  opencodeGetConfig: "orxa:opencode:getConfig",
  opencodeUpdateConfig: "orxa:opencode:updateConfig",
  opencodeReadRawConfig: "orxa:opencode:readRawConfig",
  opencodeWriteRawConfig: "orxa:opencode:writeRawConfig",
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

export type TerminalConnectResult = {
  ptyID: string;
  directory: string;
  connected: boolean;
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
        event: Event;
      };
    }
  | {
      type: "opencode.project";
      payload: {
        directory: string;
        event: Event;
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
    };

export interface OrxaBridge {
  mode: {
    get: () => Promise<AppMode>;
    set: (mode: AppMode) => Promise<AppMode>;
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
    addProjectDirectory: () => Promise<string | undefined>;
    removeProjectDirectory: (directory: string) => Promise<boolean>;
    selectProject: (directory: string) => Promise<ProjectBootstrap>;
    refreshProject: (directory: string) => Promise<ProjectBootstrap>;
    createSession: (directory: string, title?: string) => Promise<Session>;
    deleteSession: (directory: string, sessionID: string) => Promise<boolean>;
    abortSession: (directory: string, sessionID: string) => Promise<boolean>;
    renameSession: (directory: string, sessionID: string, title: string) => Promise<Session>;
    archiveSession: (directory: string, sessionID: string) => Promise<Session>;
    createWorktreeSession: (directory: string, sessionID: string, name?: string) => Promise<WorktreeSessionResult>;
    loadMessages: (directory: string, sessionID: string) => Promise<SessionMessageBundle[]>;
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
