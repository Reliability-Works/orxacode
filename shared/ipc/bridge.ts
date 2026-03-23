import type { Agent, Config, ProviderListResponse, Pty, QuestionAnswer, Session } from "@opencode-ai/sdk/v2/client";

import type {
  ArtifactExportBundleInput,
  ArtifactExportBundleResult,
  ArtifactListQuery,
  ArtifactPruneResult,
  ArtifactRecord,
  ArtifactRetentionPolicy,
  ArtifactRetentionUpdateInput,
  ArtifactSessionSummary,
  WorkspaceArtifactSummary,
  WorkspaceContextFile,
  WorkspaceContextWriteInput,
} from "./artifacts";
import type {
  AgentsDocument,
  ChangeProvenanceRecord,
  ExecutionLedgerSnapshot,
  GitBranchState,
  GitCommitRequest,
  GitCommitResult,
  GitCommitSummary,
  GlobalBootstrap,
  ImageSelection,
  OpenCodeAgentFile,
  OpenDirectoryResult,
  OpenDirectoryTarget,
  ProjectBootstrap,
  ProjectFileDocument,
  ProjectFileEntry,
  PromptRequest,
  RawConfigDocument,
  SessionRuntimeSnapshot,
  SessionMessageBundle,
  SessionPermissionMode,
  SessionProvenanceSnapshot,
  SkillEntry,
  WorktreeSessionResult,
} from "./opencode-core";
import type { RuntimeDependencyReport, RuntimeProfile, RuntimeProfileInput, RuntimeState, ServerDiagnostics } from "./runtime";
import type { BrowserAgentActionRequest, BrowserAgentActionResult, BrowserBounds, BrowserHistoryItem, BrowserState } from "./browser";
import type { ClaudeTerminalCreateResult, ClaudeTerminalMode, TerminalConnectResult } from "./terminal";
import type { McpDevToolsServerStatus } from "./mcp-devtools";
import type { ProviderUsageStats, OpenFileOptions, OpenFileResult, ListeningPort, HttpRequestOptions, HttpRequestResult } from "./app";
import type {
  ClaudeChatApprovalDecision,
  ClaudeChatHealthStatus,
  ClaudeChatHistoryMessage,
  ClaudeChatModelEntry,
  ClaudeChatState,
  ClaudeChatTurnOptions,
} from "./claude-chat";
import type { UpdateCheckResult, UpdatePreferences } from "./updates";
import type {
  CodexCollaborationMode,
  CodexDoctorResult,
  CodexModelEntry,
  CodexRunMetadata,
  CodexState,
  CodexThreadRuntime,
  CodexThread,
  CodexUpdateResult,
} from "./codex";
import type { OrxaEvent } from "./events";

export interface OrxaBridge {
  app: {
    openExternal: (url: string) => Promise<boolean>;
    openFile: (options?: OpenFileOptions) => Promise<OpenFileResult | undefined>;
    readTextFile: (filePath: string) => Promise<string>;
    writeTextFile: (filePath: string, content: string) => Promise<boolean>;
    revealInFinder: (dirPath: string) => Promise<boolean>;
    scanPorts: (directory?: string) => Promise<ListeningPort[]>;
    httpRequest: (options: HttpRequestOptions) => Promise<HttpRequestResult>;
    listSkillsFromDir: (directory: string) => Promise<SkillEntry[]>;
    runAgentCli: (options: { agent: "opencode" | "codex" | "claude"; prompt: string; cwd: string }) => Promise<{ ok: boolean; output: string; exitCode: number }>;
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
    getSessionRuntime: (directory: string, sessionID: string) => Promise<SessionRuntimeSnapshot>;
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
    listAgents: (directory?: string) => Promise<Agent[]>;
    pickImage: () => Promise<ImageSelection | undefined>;
    gitDiff: (directory: string) => Promise<string>;
    gitStatus: (directory: string) => Promise<string>;
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
  claudeChat: {
    health: () => Promise<ClaudeChatHealthStatus>;
    listModels: () => Promise<ClaudeChatModelEntry[]>;
    getState: (sessionKey: string) => Promise<ClaudeChatState>;
    startTurn: (sessionKey: string, directory: string, prompt: string, options?: ClaudeChatTurnOptions) => Promise<void>;
    interruptTurn: (sessionKey: string) => Promise<void>;
    approve: (requestId: string, decision: ClaudeChatApprovalDecision) => Promise<void>;
    respondToUserInput: (requestId: string, response: string) => Promise<void>;
    getSessionMessages: (sessionId: string, directory?: string) => Promise<ClaudeChatHistoryMessage[]>;
    archiveSession: (sessionKey: string) => Promise<void>;
    archiveProviderSession: (sessionId: string, directory?: string) => Promise<void>;
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
    inspectEnable: () => Promise<{ ok: boolean }>;
    inspectDisable: () => Promise<{ ok: boolean }>;
  };
  mcpDevTools: {
    start: (directory: string) => Promise<McpDevToolsServerStatus>;
    stop: (directory: string) => Promise<McpDevToolsServerStatus>;
    getStatus: (directory: string) => Promise<McpDevToolsServerStatus>;
    listTools: () => Promise<unknown[]>;
  };
  usage: {
    getClaudeStats: () => Promise<ProviderUsageStats>;
    getCodexStats: () => Promise<ProviderUsageStats>;
  };
  codex: {
    doctor: () => Promise<CodexDoctorResult>;
    update: () => Promise<CodexUpdateResult>;
    listModels: () => Promise<CodexModelEntry[]>;
    listCollaborationModes: () => Promise<CodexCollaborationMode[]>;
    start: (cwd?: string, options?: { codexPath?: string; codexArgs?: string }) => Promise<CodexState>;
    stop: () => Promise<CodexState>;
    getState: () => Promise<CodexState>;
    startThread: (options?: { model?: string; cwd?: string; title?: string; approvalPolicy?: string; sandbox?: string }) => Promise<CodexThread>;
    listThreads: (options?: { cursor?: string | null; limit?: number; archived?: boolean }) => Promise<{ threads: CodexThread[]; nextCursor?: string }>;
    getThreadRuntime: (threadId: string) => Promise<CodexThreadRuntime>;
    resumeThread: (threadId: string) => Promise<Record<string, unknown>>;
    archiveThreadTree: (threadId: string) => Promise<void>;
    setThreadName: (threadId: string, name: string) => Promise<void>;
    generateRunMetadata: (cwd: string, prompt: string) => Promise<CodexRunMetadata>;
    startTurn: (threadId: string, prompt: string, cwd?: string, model?: string, effort?: string, collaborationMode?: string) => Promise<void>;
    steerTurn: (threadId: string, turnId: string, prompt: string) => Promise<void>;
    approve: (requestId: number, decision: string) => Promise<void>;
    deny: (requestId: number) => Promise<void>;
    respondToUserInput: (requestId: number, response: string) => Promise<void>;
    interruptTurn: (threadId: string, turnId: string) => Promise<void>;
    interruptThreadTree: (threadId: string, turnId?: string) => Promise<void>;
  };
  events: {
    subscribe: (listener: (event: OrxaEvent) => void) => () => void;
  };
}
