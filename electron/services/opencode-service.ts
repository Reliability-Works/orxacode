import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { cp, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import {
  type Agent,
  createOpencodeClient,
  type Config,
  type Event,
  type OpencodeClient,
  type ProviderListResponse,
  type QuestionAnswer,
  type Pty,
  type Session,
  type SessionStatus,
  type Worktree,
} from "@opencode-ai/sdk/v2/client";
import WebSocket from "ws";
import type {
  ArtifactListQuery,
  ArtifactExportBundleInput,
  ArtifactExportBundleResult,
  ArtifactPruneResult,
  ArtifactRecord,
  ArtifactRetentionPolicy,
  ArtifactRetentionUpdateInput,
  ArtifactSessionSummary,
  AgentsDocument,
  ChangeProvenanceRecord,
  ExecutionEventActor,
  ExecutionEventKind,
  ExecutionEventRecord,
  ExecutionLedgerSnapshot,
  GitBranchState,
  GitCommitRequest,
  GitCommitResult,
  GitCommitSummary,
  GlobalBootstrap,
  OpenCodeAgentFile,
  OpenDirectoryResult,
  OpenDirectoryTarget,
  MemoryBackfillStatus,
  MemoryGraphQuery,
  MemoryGraphSnapshot,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemoryTemplate,
  OrxaEvent,
  ProjectListItem,
  ProjectBootstrap,
  PromptRequest,
  RawConfigDocument,
  RuntimeConnectionStatus,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeDependencyReport,
  RuntimeState,
  SkillEntry,
  ServerDiagnostics,
  SessionProvenanceSnapshot,
  SessionRuntimeSnapshot,
  SessionPermissionMode,
  ProjectFileDocument,
  ProjectFileEntry,
  SessionMessageBundle,
  TerminalConnectResult,
  WorkspaceArtifactSummary,
  WorkspaceContextFile,
  WorkspaceContextWriteInput,
  WorktreeSessionResult,
} from "../../shared/ipc";
import { PasswordStore } from "./password-store";
import { ExecutionLedgerStore } from "./execution-ledger-store";
import { ProjectStore } from "./project-store";
import { ProfileStore } from "./profile-store";
import { ProvenanceIndex } from "./provenance-index";
import { hasRecentMatchingUserPrompt } from "./prompt-dedupe";
import { MemoryStore } from "./memory-store";
import { ArtifactStore } from "./artifact-store";
import { WorkspaceContextStore } from "./workspace-context-store";
import { buildOpenTargetAttempts } from "./open-target-attempts";
import { OpencodeCommandHelpers } from "./opencode-command-helpers";
import {
  fallbackCommitMessage,
  gitBranchesWorkflow,
  gitCheckoutBranchWorkflow,
  gitCommitSummaryWorkflow,
  gitCommitWorkflow,
  gitDiffWorkflow,
  gitGenerateCommitMessageWorkflow,
  gitIssuesWorkflow,
  gitLogWorkflow,
  gitPrsWorkflow,
  gitRestoreAllUnstagedWorkflow,
  gitRestorePathWorkflow,
  gitStageAllWorkflow,
  gitStagePathWorkflow,
  gitUnstagePathWorkflow,
  normalizeGitHubRemote,
  parseGitPatchStats,
  toCommitMessageArgs,
} from "./opencode-git-workflows";
import {
  countProjectFiles,
  listProjectFiles,
  readProjectFile,
} from "./opencode-project-files";
import {
  deleteOpenCodeAgentFile as deleteOpenCodeAgentFileInternal,
  listOpenCodeAgentFiles as listOpenCodeAgentFilesInternal,
  readGlobalAgentsMd as readGlobalAgentsMdInternal,
  readOpenCodeAgentFile as readOpenCodeAgentFileInternal,
  readWorkspaceAgentsMd as readWorkspaceAgentsMdInternal,
  writeGlobalAgentsMd as writeGlobalAgentsMdInternal,
  writeOpenCodeAgentFile as writeOpenCodeAgentFileInternal,
  writeWorkspaceAgentsMd as writeWorkspaceAgentsMdInternal,
} from "./opencode-agent-files";
import { buildPromptDedupeKey, buildPromptParts, composeSystemPrompt } from "./opencode-prompting";
import {
  DEFAULT_TIMEOUT_MS,
  OPENCODE_INSTALL_COMMAND,
  OPENCODE_SOURCE_URL,
  delay,
  isTransientPromptError,
  sanitizeError,
} from "./opencode-runtime-helpers";

function toSessionPermissionRules(mode?: SessionPermissionMode) {
  if (!mode) {
    return undefined;
  }
  const action = mode === "yolo-write" ? ("allow" as const) : ("ask" as const);
  return [
    {
      permission: "edit",
      pattern: "*",
      action,
    },
    {
      permission: "bash",
      pattern: "*",
      action,
    },
  ];
}

function normalizeSessionTitleFromText(text: string, maxLength = 56) {
  const compact = text
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, "")
    .trim();
  if (!compact) {
    return "New session";
  }
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3).trimEnd()}...` : compact;
}

function normalizeWorktreeName(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  if (slug) {
    return slug;
  }
  return `session-${Date.now().toString(36)}`;
}

function toWorkspaceRelativePath(directory: string, target: string) {
  const normalizedDirectory = path.resolve(directory).replace(/\\/g, "/");
  const normalizedTarget = target.replace(/\\/g, "/");
  if (normalizedTarget.startsWith(`${normalizedDirectory}/`)) {
    return normalizedTarget.slice(normalizedDirectory.length + 1);
  }
  if (normalizedTarget === normalizedDirectory) {
    return ".";
  }
  if (normalizedTarget.startsWith("./")) {
    return normalizedTarget.slice(2);
  }
  return normalizedTarget.replace(/^\/+/, "");
}

function isTaskToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "task" || normalized.endsWith("/task");
}

function collectStringPaths(input: unknown, output: string[]) {
  if (typeof input === "string") {
    const value = input.trim();
    if (value.length > 0) {
      output.push(value);
    }
    return;
  }
  if (!input || typeof input !== "object") {
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectStringPaths(item, output);
    }
    return;
  }
  const record = input as Record<string, unknown>;
  const keys = [
    "path",
    "paths",
    "filePath",
    "filepath",
    "file_path",
    "relativePath",
    "file",
    "filename",
    "target",
    "targetPath",
    "destination",
    "from",
    "to",
    "oldPath",
    "newPath",
  ];
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    collectStringPaths(record[key], output);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      collectStringPaths(value, output);
    }
  }
}

function parsePatchMutations(patchText: string, directory: string) {
  const lines = patchText.split(/\r?\n/);
  const mutations: Array<{ operation: "edit" | "create" | "delete"; filePath: string }> = [];
  for (const line of lines) {
    const match = line.match(/^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/i);
    if (!match) {
      continue;
    }
    const action = (match[1] ?? "").toLowerCase();
    const file = (match[2] ?? "").trim();
    if (!file) {
      continue;
    }
    mutations.push({
      operation: action === "add" ? "create" : action === "delete" ? "delete" : "edit",
      filePath: toWorkspaceRelativePath(directory, file),
    });
  }
  return mutations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listProviderEnvKeys(provider: unknown) {
  if (!isRecord(provider) || !Array.isArray(provider.env)) {
    return [];
  }

  return provider.env.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

const MANAGED_SERVER_ENV_BLOCKLIST = new Set([
  "INIT_CWD",
  "PNPM_SCRIPT_SRC_DIR",
  "VITE_DEV_SERVER_URL",
]);

const MANAGED_SERVER_ENV_BLOCKLIST_PREFIXES = [
  "npm_lifecycle_",
  "npm_package_",
];

export function buildManagedServerEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(nextEnv)) {
    if (MANAGED_SERVER_ENV_BLOCKLIST.has(key) || MANAGED_SERVER_ENV_BLOCKLIST_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete nextEnv[key];
    }
  }
  return nextEnv;
}

type ManagedRuntimePaths = {
  root: string;
  dataHome: string;
  configHome: string;
  stateHome: string;
  cacheHome: string;
  authPath: string;
  configDir: string;
};

const MANAGED_RUNTIME_CONFIG_DIRS = ["agent", "agents"] as const;

function managedRuntimePaths(profileID: string): ManagedRuntimePaths {
  const root = path.join(homedir(), ".orxa-code", "managed-opencode", profileID);
  const dataHome = path.join(root, "data");
  const configHome = path.join(root, "config");
  const stateHome = path.join(root, "state");
  const cacheHome = path.join(root, "cache");
  return {
    root,
    dataHome,
    configHome,
    stateHome,
    cacheHome,
    authPath: path.join(dataHome, "opencode", "auth.json"),
    configDir: path.join(configHome, "opencode"),
  };
}

export function sanitizeManagedRuntimeConfig(rawContent: string) {
  const parseErrors: Parameters<typeof parseJsonc>[1] = [];
  const parsed = parseJsonc(rawContent, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0 || !isRecord(parsed)) {
    return "{}\n";
  }

  const next = { ...parsed };
  delete next.plugin;
  return `${JSON.stringify(next, null, 2)}\n`;
}

async function canListenOnPort(host: string, port: number) {
  if (!Number.isInteger(port) || port <= 0) {
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveManagedServerLaunchPort(host: string, preferredPort: number) {
  if (!Number.isInteger(preferredPort) || preferredPort <= 0) {
    return 0;
  }
  return await canListenOnPort(host, preferredPort) ? preferredPort : 0;
}

function classifyTool(
  toolName: string,
  stateInput: unknown,
  directory: string,
): {
  kind: ExecutionEventKind;
  operation?: "edit" | "create" | "delete";
  summary: string;
  paths: string[];
} {
  const normalizedTool = toolName.toLowerCase();
  const gathered: string[] = [];
  collectStringPaths(stateInput, gathered);
  const paths = [...new Set(gathered.map((item) => toWorkspaceRelativePath(directory, item)))].filter(Boolean);
  const patchMutations = typeof stateInput === "string" ? parsePatchMutations(stateInput, directory) : [];
  const mutationPaths = patchMutations.map((item) => item.filePath);
  const allPaths = [...new Set([...paths, ...mutationPaths])];

  if (normalizedTool.includes("todo")) {
    return { kind: "todo", summary: "Updated todo list", paths: [] };
  }
  if (normalizedTool.includes("git")) {
    return { kind: "git", summary: "Checked git state", paths: allPaths };
  }
  if (normalizedTool.includes("read") || normalizedTool.includes("cat")) {
    return { kind: "read", summary: `Read ${allPaths[0] ?? "workspace file"}`, paths: allPaths };
  }
  if (normalizedTool.includes("rg") || normalizedTool.includes("grep") || normalizedTool.includes("find") || normalizedTool.includes("search")) {
    return { kind: "search", summary: `Searched ${allPaths[0] ?? "workspace"}`, paths: allPaths };
  }
  if (normalizedTool.includes("delete") || normalizedTool.includes("remove")) {
    return { kind: "delete", operation: "delete", summary: `Deleted ${allPaths[0] ?? "file"}`, paths: allPaths };
  }
  if (normalizedTool.includes("create") || normalizedTool.includes("mkdir") || normalizedTool.includes("touch")) {
    return { kind: "create", operation: "create", summary: `Created ${allPaths[0] ?? "file"}`, paths: allPaths };
  }
  if (normalizedTool.includes("write") || normalizedTool.includes("edit") || normalizedTool.includes("replace")) {
    return { kind: "edit", operation: "edit", summary: `Edited ${allPaths[0] ?? "file"}`, paths: allPaths };
  }
  if (normalizedTool.includes("apply_patch")) {
    const mutation = patchMutations[0];
    if (mutation?.operation === "create") {
      return { kind: "create", operation: "create", summary: `Created ${mutation.filePath}`, paths: allPaths };
    }
    if (mutation?.operation === "delete") {
      return { kind: "delete", operation: "delete", summary: `Deleted ${mutation.filePath}`, paths: allPaths };
    }
    return { kind: "edit", operation: "edit", summary: `Edited ${mutation?.filePath ?? allPaths[0] ?? "file"}`, paths: allPaths };
  }
  return { kind: "run", summary: "Ran command", paths: allPaths };
}

export class OpencodeService {
  private profileStore = new ProfileStore();
  private projectStore = new ProjectStore();
  private passwordStore = new PasswordStore();
  private ledgerStore = new ExecutionLedgerStore();
  private provenanceIndex = new ProvenanceIndex();
  private memoryStore = new MemoryStore();
  private artifactStore = new ArtifactStore();
  private workspaceContextStore = new WorkspaceContextStore();
  private commandHelpers = new OpencodeCommandHelpers();

  private managedProcess: ChildProcess | undefined;
  private state: RuntimeState = {
    status: "disconnected",
    managedServer: false,
  };

  private activeProfile: RuntimeProfile | undefined;
  private authHeader: string | undefined;
  private globalAbort: AbortController | undefined;
  private projectAbort: AbortController | undefined;
  private ptySockets = new Map<string, WebSocket>();
  private sessionSyncFingerprint = new Map<string, string>();
  private sessionSyncInFlight = new Map<string, Promise<void>>();
  private promptFence = new Map<string, number>();
  private memoryIngestInFlight = new Map<string, Promise<void>>();
  private memoryIngestAt = new Map<string, number>();
  private memoryBackfill: MemoryBackfillStatus = {
    running: false,
    progress: 0,
    scannedSessions: 0,
    totalSessions: 0,
    inserted: 0,
    updated: 0,
  };

  onEvent?: (event: OrxaEvent) => void;

  runtimeState() {
    return { ...this.state };
  }

  listProfiles() {
    return this.profileStore.list();
  }

  async saveProfile(input: RuntimeProfileInput) {
    const existing = input.id ? this.profileStore.list().find((item) => item.id === input.id) : undefined;
    let hasPassword = existing?.hasPassword ?? false;

    if (input.password !== undefined) {
      if (input.password.length > 0) {
        hasPassword = true;
      } else {
        hasPassword = false;
      }
    }

    const profiles = this.profileStore.save(input, { hasPassword });
    const savedProfile = profiles.find((item) => item.id === (input.id ?? profiles[profiles.length - 1]?.id));

    if (input.password !== undefined && savedProfile) {
      if (input.password.length > 0) {
        await this.passwordStore.set(savedProfile.id, input.password);
      } else {
        await this.passwordStore.remove(savedProfile.id);
      }
    }

    if (this.activeProfile?.id === savedProfile?.id) {
      this.activeProfile = savedProfile;
      this.authHeader = await this.basicAuthHeader(savedProfile);
    }

    return profiles;
  }

  async deleteProfile(profileID: string) {
    await this.passwordStore.remove(profileID);
    const profiles = this.profileStore.remove(profileID);
    if (this.state.activeProfileId === profileID) {
      await this.disconnect();
    }
    return profiles;
  }

  async attach(profileID: string) {
    const profile = this.profileStore.list().find((item) => item.id === profileID);
    if (!profile) {
      throw new Error("Profile not found");
    }

    this.profileStore.setActiveProfileId(profileID);
    this.activeProfile = profile;
    this.authHeader = await this.basicAuthHeader(profile);
    this.setState({
      status: "connecting",
      activeProfileId: profileID,
      managedServer: !!this.managedProcess,
      baseUrl: this.baseUrl(profile),
      lastError: undefined,
    });

    const client = this.client();
    await this.unwrap(client.global.health());

    this.setState({
      status: "connected",
      activeProfileId: profileID,
      managedServer: !!this.managedProcess,
      baseUrl: this.baseUrl(profile),
      lastError: undefined,
    });

    this.startGlobalStream();
    return this.runtimeState();
  }

  async startLocal(profileID: string) {
    const profile = this.profileStore.list().find((item) => item.id === profileID);
    if (!profile) {
      throw new Error("Profile not found");
    }

    if (!profile.startCommand) {
      return this.attach(profileID);
    }

    await this.stopLocal();
    this.setState({
      status: "starting",
      activeProfileId: profileID,
      managedServer: true,
      baseUrl: this.baseUrl(profile),
      lastError: undefined,
    });

    const binary = await this.resolveBinary(profile.cliPath);
    const launchPort = await resolveManagedServerLaunchPort(profile.startHost, profile.startPort);
    const runtimePaths = await this.prepareManagedRuntimeHome(profile.id);
    const args = [
      "serve",
      `--hostname=${profile.startHost}`,
      `--port=${launchPort}`,
      ...profile.corsOrigins.map((origin) => `--cors=${origin}`),
    ];

    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: this.buildManagedRuntimeEnv(process.env, runtimePaths),
    });

    this.managedProcess = child;

    const launchedUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for local server start (${DEFAULT_TIMEOUT_MS}ms)`));
      }, DEFAULT_TIMEOUT_MS);

      const onError = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };

      child.once("error", onError);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`OpenCode server exited early with code ${code ?? "unknown"}`));
      });

      const readChunk = (chunk: Buffer) => {
        const text = chunk.toString();
        const match = text.match(/opencode server listening on\s+(https?:\/\/[^\s]+)/i);
        if (!match) {
          return;
        }
        clearTimeout(timeout);
        resolve(match[1]);
      };

      child.stdout?.on("data", readChunk);
      child.stderr?.on("data", readChunk);
    });

    this.setState({
      status: "connecting",
      activeProfileId: profileID,
      managedServer: true,
      baseUrl: launchedUrl,
      lastError: undefined,
    });

    const launchedEndpoint = new URL(launchedUrl);
    profile.host = launchedEndpoint.hostname || profile.startHost;
    profile.port = launchedEndpoint.port ? Number.parseInt(launchedEndpoint.port, 10) : launchPort || profile.startPort;
    profile.https = launchedEndpoint.protocol === "https:";
    this.profileStore.save(profile);

    return this.attach(profileID);
  }

  private buildManagedRuntimeEnv(baseEnv: NodeJS.ProcessEnv, runtimePaths: ManagedRuntimePaths) {
    const env = buildManagedServerEnv(baseEnv);
    delete env.OPENCODE_CONFIG_DIR;
    delete env.OPENCODE_CONFIG_CONTENT;
    env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true";
    env.OPENCODE_TEST_HOME = runtimePaths.root;
    env.XDG_DATA_HOME = runtimePaths.dataHome;
    env.XDG_CONFIG_HOME = runtimePaths.configHome;
    env.XDG_STATE_HOME = runtimePaths.stateHome;
    env.XDG_CACHE_HOME = runtimePaths.cacheHome;
    return env;
  }

  private async prepareManagedRuntimeHome(profileID: string) {
    const runtimePaths = managedRuntimePaths(profileID);
    await rm(runtimePaths.root, { recursive: true, force: true });
    await mkdir(path.dirname(runtimePaths.authPath), { recursive: true });
    await mkdir(runtimePaths.configDir, { recursive: true });
    await mkdir(runtimePaths.stateHome, { recursive: true });
    await mkdir(runtimePaths.cacheHome, { recursive: true });

    const authSource = path.join(homedir(), ".local", "share", "opencode", "auth.json");
    if (existsSync(authSource)) {
      await copyFile(authSource, runtimePaths.authPath);
    }

    const globalConfigRoot = path.join(homedir(), ".config", "opencode");
    const globalConfigPath = this.findConfigFile(globalConfigRoot);
    if (existsSync(globalConfigPath)) {
      const rawConfig = await readFile(globalConfigPath, "utf8");
      const sanitizedConfig = sanitizeManagedRuntimeConfig(rawConfig);
      await writeFile(path.join(runtimePaths.configDir, "opencode.json"), sanitizedConfig, "utf8");
    }

    for (const directoryName of MANAGED_RUNTIME_CONFIG_DIRS) {
      const source = path.join(globalConfigRoot, directoryName);
      if (!existsSync(source) || !statSync(source).isDirectory()) {
        continue;
      }
      await cp(source, path.join(runtimePaths.configDir, directoryName), {
        force: true,
        recursive: true,
      });
    }

    return runtimePaths;
  }

  async stopLocal() {
    this.stopProjectStream();
    this.stopGlobalStream();

    if (this.managedProcess) {
      this.managedProcess.kill();
      this.managedProcess = undefined;
    }

    for (const socket of this.ptySockets.values()) {
      socket.close();
    }
    this.ptySockets.clear();

    this.setState({
      status: "disconnected",
      activeProfileId: this.state.activeProfileId,
      managedServer: false,
      baseUrl: this.state.baseUrl,
      lastError: undefined,
    });

    return this.runtimeState();
  }

  async disconnect() {
    this.stopProjectStream();
    this.stopGlobalStream();

    for (const socket of this.ptySockets.values()) {
      socket.close();
    }
    this.ptySockets.clear();

    this.setState({
      status: "disconnected",
      activeProfileId: undefined,
      managedServer: !!this.managedProcess,
      baseUrl: undefined,
      lastError: undefined,
    });
    this.authHeader = undefined;
  }

  async bootstrap(): Promise<GlobalBootstrap> {
    const projects = this.listStoredProjects();
    return {
      projects,
      runtime: this.runtimeState(),
    };
  }

  async checkRuntimeDependencies(): Promise<RuntimeDependencyReport> {
    const opencodeInstalled = await this.canRunCommandWithFallbacks("opencode", ["--version"], homedir());

    const dependencies: RuntimeDependencyReport["dependencies"] = [
      {
        key: "opencode",
        label: "OpenCode CLI",
        required: true,
        installed: opencodeInstalled,
        description: "Core runtime and CLI backend used by the app for sessions, tools, and streaming.",
        reason: "Required. Orxa Code depends on the OpenCode server and CLI APIs.",
        installCommand: OPENCODE_INSTALL_COMMAND,
        sourceUrl: OPENCODE_SOURCE_URL,
      },
    ];

    const missingRequired = dependencies.some((item) => item.required && !item.installed);
    const missingAny = missingRequired; // Only required deps matter now
    return {
      checkedAt: Date.now(),
      dependencies,
      missingAny,
      missingRequired,
    };
  }

  async addProjectDirectory(directory: string) {
    const normalized = this.ensureWorkspaceDirectory(directory, "Selected path is not a directory");
    this.projectStore.add(normalized);
    return normalized;
  }

  async removeProjectDirectory(directory: string) {
    this.projectStore.remove(path.resolve(directory));
    return true;
  }

  async getServerDiagnostics(): Promise<ServerDiagnostics> {
    const runtime = this.runtimeState();
    const profile = this.profileStore.list().find((item) => item.id === runtime.activeProfileId);

    let health: ServerDiagnostics["health"] = "disconnected";
    if (runtime.status === "connected") {
      try {
        await this.unwrap(this.client().global.health());
        health = "connected";
      } catch {
        health = "error";
      }
    } else if (runtime.status === "error") {
      health = "error";
    }

    return {
      runtime,
      activeProfile: profile,
      health,
      lastError: runtime.lastError,
    };
  }

  async repairRuntime(): Promise<ServerDiagnostics> {
    return this.getServerDiagnostics();
  }

  async selectProject(directory: string) {
    const normalized = this.ensureWorkspaceDirectory(directory);
    await this.addProjectDirectory(normalized);
    this.startProjectStream(normalized);
    return this.refreshProject(normalized);
  }

  async refreshProject(directory: string): Promise<ProjectBootstrap> {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const client = this.client(normalizedDirectory);

    const [
      pathInfo,
      sessions,
      sessionStatus,
      providers,
      agents,
      config,
      permissions,
      questions,
      commands,
      mcp,
      lsp,
      formatter,
      vcs,
      ptys,
    ] = await Promise.all([
      this.unwrap(client.path.get({ directory: normalizedDirectory })).catch(() => ({
        home: homedir(),
        state: path.join(homedir(), ".local", "share", "opencode"),
        config: path.join(homedir(), ".config", "opencode"),
        worktree: normalizedDirectory,
        directory: normalizedDirectory,
      })),
      this.unwrap(client.session.list({ directory: normalizedDirectory, roots: true, limit: 120 })).catch(() => []),
      this.unwrap(client.session.status({ directory: normalizedDirectory })).catch(() => ({})),
      this.unwrap(client.provider.list({ directory: normalizedDirectory })).catch(() => ({ all: [], connected: [], default: {} })),
      this.unwrap(client.app.agents({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.config.get({ directory: normalizedDirectory })).catch(() => ({})),
      this.unwrap(client.permission.list({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.question.list({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.command.list({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.mcp.status({ directory: normalizedDirectory })).catch(() => ({})),
      this.unwrap(client.lsp.status({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.formatter.status({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.vcs.get({ directory: normalizedDirectory })).catch(() => undefined),
      this.unwrap(client.pty.list({ directory: normalizedDirectory })).catch(() => []),
    ]);

    return {
      directory: normalizedDirectory,
      path: pathInfo,
      sessions,
      sessionStatus,
      providers,
      agents,
      config,
      permissions,
      questions,
      commands,
      mcp,
      lsp,
      formatter,
      vcs,
      ptys,
    };
  }

  async createSession(directory: string, title?: string, permissionMode?: SessionPermissionMode) {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const response = await this.client(normalizedDirectory).session.create({
      directory: normalizedDirectory,
      title,
      permission: toSessionPermissionRules(permissionMode),
    });
    return this.unwrap(response);
  }

  async deleteSession(directory: string, sessionID: string) {
    await this.client(directory).session.delete({ directory, sessionID });
    return true;
  }

  async abortSession(directory: string, sessionID: string) {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const abortTree = await this.collectAbortableSessionTree(normalizedDirectory, sessionID);
    const client = this.client(normalizedDirectory);
    for (const targetSessionID of abortTree) {
      await client.session.abort({ directory: normalizedDirectory, sessionID: targetSessionID }).catch(() => undefined);
    }
    return true;
  }

  async renameSession(directory: string, sessionID: string, title: string): Promise<Session> {
    const nextTitle = title.trim();
    if (!nextTitle) {
      throw new Error("Session title cannot be empty");
    }
    const response = await this.client(directory).session.update({
      directory,
      sessionID,
      title: nextTitle,
    });
    return this.unwrap(response);
  }

  async archiveSession(directory: string, sessionID: string): Promise<Session> {
    const response = await this.client(directory).session.update({
      directory,
      sessionID,
      time: {
        archived: Date.now(),
      },
    });
    return this.unwrap(response);
  }

  async createWorktreeSession(directory: string, sessionID: string, name?: string): Promise<WorktreeSessionResult> {
    const source = await this.unwrap(this.client(directory).session.get({ directory, sessionID }));
    const baseName = normalizeWorktreeName(name ?? source.title ?? source.slug ?? sessionID.slice(0, 8));

    let worktree: Worktree | undefined;
    let lastError: unknown;
    for (let index = 0; index < 8; index += 1) {
      const candidate = index === 0 ? baseName : `${baseName}-${index + 1}`;
      try {
        worktree = await this.unwrap(
          this.client(directory).worktree.create({
            directory,
            worktreeCreateInput: { name: candidate },
          }),
        );
        break;
      } catch (error) {
        lastError = error;
        const message = sanitizeError(error).toLowerCase();
        const isNameCollision =
          message.includes("already exists") ||
          message.includes("exists") ||
          message.includes("already used") ||
          message.includes("duplicate");
        if (!isNameCollision) {
          throw error;
        }
      }
    }

    if (!worktree) {
      throw new Error(sanitizeError(lastError ?? "Failed to create worktree"));
    }

    this.projectStore.add(worktree.directory);

    const sessionTitle = normalizeSessionTitleFromText(source.title || source.slug || "Worktree session");
    const session = await this.unwrap(
      this.client(worktree.directory).session.create({
        directory: worktree.directory,
        title: `Worktree: ${sessionTitle}`,
      }),
    );

    return { worktree, session };
  }

  async loadMessages(directory: string, sessionID: string): Promise<SessionMessageBundle[]> {
    const response = await this.client(directory).session.messages({ directory, sessionID });
    return this.unwrap(response);
  }

  async getSessionRuntime(directory: string, sessionID: string): Promise<SessionRuntimeSnapshot> {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const client = this.client(normalizedDirectory);
    const [session, sessionStatusMap, permissions, questions, commands, messages, executionLedger, changeProvenance] = await Promise.all([
      this.unwrap(client.session.get({ directory: normalizedDirectory, sessionID })).catch(() => null),
      this.unwrap(client.session.status({ directory: normalizedDirectory })).catch(() => ({})),
      this.unwrap(client.permission.list({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.question.list({ directory: normalizedDirectory })).catch(() => []),
      this.unwrap(client.command.list({ directory: normalizedDirectory })).catch(() => []),
      this.loadMessages(normalizedDirectory, sessionID).catch(() => []),
      this.loadExecutionLedger(normalizedDirectory, sessionID, 0).catch(() => ({ cursor: 0, records: [] })),
      this.loadChangeProvenance(normalizedDirectory, sessionID, 0).catch(() => ({ cursor: 0, records: [] })),
    ]);

    const filterBySession = <T extends { sessionID?: string; sessionId?: string; session_id?: string }>(items: T[]) =>
      items.filter((item) => {
        const sessionValue = item.sessionID ?? item.sessionId ?? item.session_id;
        return typeof sessionValue !== "string" || sessionValue === sessionID;
      });
    const sessionStatusRecord = sessionStatusMap as Record<string, SessionStatus>;

    return {
      directory: normalizedDirectory,
      sessionID,
      session,
      sessionStatus: sessionStatusRecord[sessionID],
      permissions: filterBySession(permissions),
      questions: filterBySession(questions),
      commands,
      messages,
      executionLedger,
      changeProvenance,
    };
  }

  async loadExecutionLedger(directory: string, sessionID: string, cursor = 0): Promise<ExecutionLedgerSnapshot> {
    await this.syncSessionExecutionArtifacts(directory, sessionID);
    return this.ledgerStore.loadSnapshot(directory, sessionID, cursor);
  }

  async clearExecutionLedger(directory: string, sessionID: string) {
    await Promise.all([
      this.ledgerStore.clear(directory, sessionID),
      this.provenanceIndex.clear(directory, sessionID),
    ]);
    this.sessionSyncFingerprint.delete(`${directory}::${sessionID}`);
    return true;
  }

  async loadChangeProvenance(directory: string, sessionID: string, cursor = 0): Promise<SessionProvenanceSnapshot> {
    await this.syncSessionExecutionArtifacts(directory, sessionID);
    return this.provenanceIndex.loadSnapshot(directory, sessionID, cursor);
  }

  async getFileProvenance(directory: string, sessionID: string, relativePath: string): Promise<ChangeProvenanceRecord[]> {
    await this.syncSessionExecutionArtifacts(directory, sessionID);
    return this.provenanceIndex.getFileHistory(directory, sessionID, toWorkspaceRelativePath(directory, relativePath));
  }

  async listArtifacts(query?: ArtifactListQuery): Promise<ArtifactRecord[]> {
    const normalized: ArtifactListQuery | undefined = query
      ? {
          ...query,
          workspace: query.workspace ? path.resolve(query.workspace) : undefined,
        }
      : undefined;
    return this.artifactStore.list(normalized);
  }

  async getArtifact(id: string): Promise<ArtifactRecord | undefined> {
    return this.artifactStore.get(id);
  }

  async deleteArtifact(id: string): Promise<boolean> {
    return this.artifactStore.delete(id);
  }

  async listArtifactSessions(workspace: string): Promise<ArtifactSessionSummary[]> {
    return this.artifactStore.listSessions(path.resolve(workspace));
  }

  async listWorkspaceArtifactSummary(workspace: string): Promise<WorkspaceArtifactSummary> {
    return this.artifactStore.listWorkspaceSummary(path.resolve(workspace));
  }

  async getArtifactRetentionPolicy(): Promise<ArtifactRetentionPolicy> {
    return this.artifactStore.getRetentionPolicy();
  }

  async setArtifactRetentionPolicy(input: ArtifactRetentionUpdateInput): Promise<ArtifactRetentionPolicy> {
    return this.artifactStore.setRetentionPolicy(input);
  }

  async pruneArtifactsNow(workspace?: string): Promise<ArtifactPruneResult> {
    return this.artifactStore.prune({
      workspace: workspace ? path.resolve(workspace) : undefined,
    });
  }

  async exportArtifactBundle(input: ArtifactExportBundleInput): Promise<ArtifactExportBundleResult> {
    return this.artifactStore.exportBundle({
      ...input,
      workspace: path.resolve(input.workspace),
    });
  }

  async listWorkspaceContext(workspace: string): Promise<WorkspaceContextFile[]> {
    return this.workspaceContextStore.list(path.resolve(workspace));
  }

  async readWorkspaceContext(workspace: string, id: string): Promise<WorkspaceContextFile> {
    return this.workspaceContextStore.read(path.resolve(workspace), id);
  }

  async writeWorkspaceContext(input: WorkspaceContextWriteInput): Promise<WorkspaceContextFile> {
    return this.workspaceContextStore.write({
      ...input,
      workspace: path.resolve(input.workspace),
    });
  }

  async deleteWorkspaceContext(workspace: string, id: string): Promise<boolean> {
    return this.workspaceContextStore.delete(path.resolve(workspace), id);
  }

  async getMemorySettings(directory?: string): Promise<MemorySettings> {
    const normalized = directory ? path.resolve(directory) : undefined;
    return this.memoryStore.getSettings(normalized);
  }

  async updateMemorySettings(input: MemorySettingsUpdateInput): Promise<MemorySettings> {
    const normalized: MemorySettingsUpdateInput = {
      ...input,
      directory: input.directory ? path.resolve(input.directory) : undefined,
    };
    return this.memoryStore.updateSettings(normalized);
  }

  async listMemoryTemplates(): Promise<MemoryTemplate[]> {
    return this.memoryStore.getTemplates();
  }

  async applyMemoryTemplate(templateID: string, directory?: string, scope?: "global" | "workspace"): Promise<MemorySettings> {
    const normalized = directory ? path.resolve(directory) : undefined;
    return this.memoryStore.applyTemplate(templateID, normalized, scope);
  }

  async getMemoryGraph(input?: MemoryGraphQuery): Promise<MemoryGraphSnapshot> {
    const normalized: MemoryGraphQuery | undefined = input
      ? {
          ...input,
          workspace: input.workspace ? path.resolve(input.workspace) : undefined,
        }
      : undefined;
    return this.memoryStore.getGraph(normalized);
  }

  async clearWorkspaceMemory(directory: string): Promise<boolean> {
    return this.memoryStore.clearWorkspace(path.resolve(directory));
  }

  private emitMemoryBackfill(status: MemoryBackfillStatus) {
    this.memoryBackfill = status;
    this.emit({
      type: "memory.backfill",
      payload: status,
    });
  }

  async backfillMemory(directory?: string): Promise<MemoryBackfillStatus> {
    if (this.memoryBackfill.running) {
      return this.memoryBackfill;
    }

    const workspaces = directory
      ? [path.resolve(directory)]
      : this.listStoredProjects().map((item) => path.resolve(item.worktree));
    const workspaceAllowlist = [...new Set(workspaces.map((item) => path.resolve(item)))];

    const initial: MemoryBackfillStatus = {
      running: true,
      progress: 0,
      scannedSessions: 0,
      totalSessions: 0,
      inserted: 0,
      updated: 0,
      startedAt: Date.now(),
      message: "Starting memory backfill",
    };
    this.emitMemoryBackfill(initial);

    try {
      const queue: Array<{ workspace: string; sessionID: string; updatedAt: number }> = [];
      for (const workspace of workspaces) {
        const sessions = await this.unwrap(this.client(workspace).session.list({ directory: workspace, limit: 180 })).catch(() => []);
        for (const session of sessions) {
          queue.push({
            workspace,
            sessionID: session.id,
            updatedAt: session.time.updated,
          });
        }
      }

      const totalSessions = queue.length;
      this.emitMemoryBackfill({
        ...initial,
        totalSessions,
        message: totalSessions === 0 ? "No sessions found for backfill" : "Backfilling session history",
      });

      let scannedSessions = 0;
      let inserted = 0;
      let updated = 0;
      for (const item of queue.sort((a, b) => a.updatedAt - b.updatedAt)) {
        const bundles = await this.loadMessages(item.workspace, item.sessionID).catch(() => []);
        const ingest = await this.memoryStore.ingestSessionMessages(item.workspace, item.sessionID, bundles, {
          workspaceAllowlist,
        });
        inserted += ingest.inserted;
        updated += ingest.updated;
        scannedSessions += 1;
        await this.memoryStore.setIngestCursor(item.workspace, String(item.updatedAt));
        this.emitMemoryBackfill({
          running: true,
          progress: totalSessions > 0 ? scannedSessions / totalSessions : 1,
          scannedSessions,
          totalSessions,
          inserted,
          updated,
          startedAt: initial.startedAt,
          message: `Backfilled ${scannedSessions} / ${totalSessions} sessions`,
        });
      }

      const done: MemoryBackfillStatus = {
        running: false,
        progress: 1,
        scannedSessions,
        totalSessions,
        inserted,
        updated,
        startedAt: initial.startedAt,
        completedAt: Date.now(),
        message: "Memory backfill completed",
      };
      this.emitMemoryBackfill(done);
      return done;
    } catch (error) {
      const failed: MemoryBackfillStatus = {
        ...this.memoryBackfill,
        running: false,
        completedAt: Date.now(),
        message: `Memory backfill failed: ${sanitizeError(error)}`,
      };
      this.emitMemoryBackfill(failed);
      return failed;
    }
  }

  async sendPrompt(input: PromptRequest) {
    const normalizedDirectory = this.ensureWorkspaceDirectory(input.directory);
    const promptSentAt = Date.now();
    const dedupeKey = buildPromptDedupeKey(input, normalizedDirectory);
    const lastAttemptAt = this.promptFence.get(dedupeKey);
    if (lastAttemptAt && promptSentAt - lastAttemptAt < 8_000) {
      return true;
    }
    this.promptFence.set(dedupeKey, promptSentAt);
    const parts = buildPromptParts(input);

    const promptSource = input.promptSource ?? "user";
    const memoryContext = promptSource === "machine"
      ? ""
      : await this.memoryStore.buildPromptContext(normalizedDirectory, input.text).catch(() => "");
    const systemPrompt = composeSystemPrompt([input.system, memoryContext]);

    const request = {
      directory: normalizedDirectory,
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      system: systemPrompt,
      tools: input.tools,
      parts,
    };

    try {
      await this.client(normalizedDirectory).session.prompt(request);
    } catch (error) {
      if (!isTransientPromptError(error)) {
        throw error;
      }
      const pollStartedAt = Date.now();
      while (Date.now() - pollStartedAt < 2_400) {
        const recentMessages = await this.loadMessages(normalizedDirectory, input.sessionID).catch(() => undefined);
        if (recentMessages && hasRecentMatchingUserPrompt(recentMessages, input.text, promptSentAt)) {
          return true;
        }
        await delay(280);
      }
      await delay(320);
      await this.client(normalizedDirectory).session.prompt(request);
    } finally {
      setTimeout(() => {
        this.promptFence.delete(dedupeKey);
      }, 15_000);
    }
    void this.scheduleSessionMemoryIngest(normalizedDirectory, input.sessionID, "prompt.sent");
    return true;
  }

  async replyPermission(directory: string, requestID: string, reply: "once" | "always" | "reject", message?: string) {
    await this.client(directory).permission.reply({ directory, requestID, reply, message });
    return true;
  }

  async replyQuestion(directory: string, requestID: string, answers: QuestionAnswer[]) {
    await this.client(directory).question.reply({ directory, requestID, answers });
    return true;
  }

  async rejectQuestion(directory: string, requestID: string) {
    await this.client(directory).question.reject({ directory, requestID });
    return true;
  }

  async gitDiff(directory: string) {
    return gitDiffWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
      renderUntrackedDiff: (repoRoot, relativePath) => this.renderUntrackedDiff(repoRoot, relativePath),
    });
  }

  async gitStatus(directory: string) {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      return "Not a git repository.";
    }
    const output = await this.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "status", "--porcelain=v1", "--untracked-files=all", "--renames"],
      cwd,
    ).catch((error) => `Unable to load git status: ${sanitizeError(error)}`);
    return output.trim().length > 0 ? output.trimEnd() : "";
  }

  async gitLog(directory: string) {
    return gitLogWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
    });
  }

  async gitIssues(directory: string) {
    return gitIssuesWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
    });
  }

  async gitPrs(directory: string) {
    return gitPrsWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
    });
  }

  async openDirectoryIn(directory: string, target: OpenDirectoryTarget): Promise<OpenDirectoryResult> {
    const cwd = path.resolve(directory);
    const info = await stat(cwd).catch(() => undefined);
    if (!info?.isDirectory()) {
      throw new Error("Directory not found");
    }

    const platform = process.platform;
    const attempts = buildOpenTargetAttempts({
      platform,
      target,
      resolvedPath: cwd,
      mode: "directory",
    });

    if (attempts.length === 0) {
      throw new Error(`No open strategy found for target "${target}" on ${platform}`);
    }

    const detail = await this.runCommandAttempts(attempts, cwd);
    return {
      target,
      ok: true,
      detail,
    };
  }

  async listOpenCodeAgentFiles(): Promise<OpenCodeAgentFile[]> {
    return listOpenCodeAgentFilesInternal();
  }

  async readOpenCodeAgentFile(filename: string): Promise<OpenCodeAgentFile> {
    return readOpenCodeAgentFileInternal(filename);
  }

  async writeOpenCodeAgentFile(filename: string, content: string): Promise<OpenCodeAgentFile> {
    return writeOpenCodeAgentFileInternal(filename, content);
  }

  async deleteOpenCodeAgentFile(filename: string): Promise<boolean> {
    return deleteOpenCodeAgentFileInternal(filename);
  }

  async openFileIn(filePath: string, target: OpenDirectoryTarget): Promise<OpenDirectoryResult> {
    const resolved = path.resolve(filePath);
    const info = await stat(resolved).catch(() => undefined);
    if (!info) {
      throw new Error("File not found");
    }

    const platform = process.platform;
    const attempts = buildOpenTargetAttempts({
      platform,
      target,
      resolvedPath: resolved,
      mode: "file",
    });

    if (attempts.length === 0) {
      throw new Error(`No open strategy found for target "${target}" on ${platform}`);
    }

    const detail = await this.runCommandAttempts(attempts, path.dirname(resolved));
    return {
      target,
      ok: true,
      detail,
    };
  }

  async gitCommitSummary(directory: string, includeUnstaged: boolean): Promise<GitCommitSummary> {
    return gitCommitSummaryWorkflow(directory, includeUnstaged, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      currentBranch: (repoRoot) => this.currentBranch(repoRoot),
      collectGitStats: (repoRoot, includeAll) => this.collectGitStats(repoRoot, includeAll),
    });
  }

  async gitGenerateCommitMessage(
    directory: string,
    includeUnstaged: boolean,
    guidancePrompt: string,
    options: { requireGeneratedMessage?: boolean } = {},
  ): Promise<string> {
    return gitGenerateCommitMessageWorkflow(directory, includeUnstaged, guidancePrompt, options, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      currentBranch: (repoRoot) => this.currentBranch(repoRoot),
      collectGitStats: (repoRoot, includeAll) => this.collectGitStats(repoRoot, includeAll),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
      generateCommitMessageWithAgent: (targetDirectory, prompt) => this.generateCommitMessageWithAgent(targetDirectory, prompt),
      fallbackCommitMessage: (stats) => this.fallbackCommitMessage(stats),
    });
  }

  async gitCommit(directory: string, request: GitCommitRequest): Promise<GitCommitResult> {
    return gitCommitWorkflow(directory, request, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      currentBranch: (repoRoot) => this.currentBranch(repoRoot),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
      resolveCommandPath: (command, cwd) => this.resolveCommandPath(command, cwd),
      gitGenerateCommitMessage: (targetDirectory, includeUnstaged, guidancePrompt, options) =>
        this.gitGenerateCommitMessage(targetDirectory, includeUnstaged, guidancePrompt, options),
      toCommitMessageArgs: (message) => this.toCommitMessageArgs(message),
      pushBranch: (repoRoot, branch) => this.pushBranch(repoRoot, branch),
      buildManualPrUrl: (repoRoot, branch, baseBranch) => this.buildManualPrUrl(repoRoot, branch, baseBranch),
    });
  }

  async gitBranches(directory: string): Promise<GitBranchState> {
    return gitBranchesWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommandWithOutput: (command, args, cwd) => this.runCommandWithOutput(command, args, cwd),
      currentBranch: (repoRoot) => this.currentBranch(repoRoot),
    });
  }

  async gitCheckoutBranch(directory: string, branch: string): Promise<GitBranchState> {
    return gitCheckoutBranchWorkflow(directory, branch, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
      gitRefExists: (repoRoot, ref) => this.gitRefExists(repoRoot, ref),
      gitBranches: (target) => this.gitBranches(target),
    });
  }

  async gitStageAll(directory: string): Promise<boolean> {
    return gitStageAllWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
    });
  }

  async gitRestoreAllUnstaged(directory: string): Promise<boolean> {
    return gitRestoreAllUnstagedWorkflow(directory, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
    });
  }

  async gitStagePath(directory: string, filePath: string): Promise<boolean> {
    return gitStagePathWorkflow(directory, filePath, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
    });
  }

  async gitRestorePath(directory: string, filePath: string): Promise<boolean> {
    return gitRestorePathWorkflow(directory, filePath, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
    });
  }

  async gitUnstagePath(directory: string, filePath: string): Promise<boolean> {
    return gitUnstagePathWorkflow(directory, filePath, {
      resolveGitRepoRoot: (target) => this.resolveGitRepoRoot(target),
      runCommand: (command, args, cwd) => this.runCommand(command, args, cwd),
    });
  }

  async listSkills(): Promise<SkillEntry[]> {
    const root = path.join(homedir(), ".config", "opencode", "skill");
    const rootInfo = await stat(root).catch(() => undefined);
    if (!rootInfo?.isDirectory()) {
      return [];
    }

    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const skills: SkillEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillPath = path.join(root, entry.name);
      const filePath = path.join(skillPath, "SKILL.md");
      const file = await readFile(filePath, "utf8").catch(() => "");
      if (!file) {
        continue;
      }
      const rawLines = file.split(/\r?\n/).map((line) => line.trim());
      // Skip YAML frontmatter (lines between opening and closing ---)
      let lines = rawLines;
      if (rawLines[0] === "---") {
        const closeIdx = rawLines.indexOf("---", 1);
        if (closeIdx > 0) {
          lines = rawLines.slice(closeIdx + 1);
        }
      }
      const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || entry.name;
      const description =
        lines.find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("```") && line !== "---") || "No description available.";
      skills.push({
        id: entry.name,
        name: title,
        description,
        path: skillPath,
      });
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  async readAgentsMd(directory: string): Promise<AgentsDocument> {
    return readWorkspaceAgentsMdInternal(directory);
  }

  async writeAgentsMd(directory: string, content: string): Promise<AgentsDocument> {
    return writeWorkspaceAgentsMdInternal(directory, content);
  }

  async readGlobalAgentsMd(): Promise<AgentsDocument> {
    return readGlobalAgentsMdInternal();
  }

  async writeGlobalAgentsMd(content: string): Promise<AgentsDocument> {
    return writeGlobalAgentsMdInternal(content);
  }

  async listFiles(directory: string, relativePath = ""): Promise<ProjectFileEntry[]> {
    return listProjectFiles(directory, relativePath);
  }

  async countProjectFiles(directory: string): Promise<number> {
    return countProjectFiles(directory);
  }

  async readProjectFile(directory: string, relativePath: string): Promise<ProjectFileDocument> {
    return readProjectFile(directory, relativePath);
  }

  async getConfig(scope: "project" | "global", directory?: string) {
    if (scope === "global") {
      const response = await this.client(directory).global.config.get();
      return this.unwrap(response);
    }

    if (!directory) {
      throw new Error("Directory is required for project config");
    }

    const response = await this.client(directory).config.get({ directory });
    return this.unwrap(response);
  }

  async updateConfig(scope: "project" | "global", patch: Config, directory?: string) {
    if (scope === "global") {
      const response = await this.client(directory).global.config.update({ config: patch });
      return this.unwrap(response);
    }

    if (!directory) {
      throw new Error("Directory is required for project config");
    }

    const response = await this.client(directory).config.update({ directory, config: patch });
    return this.unwrap(response);
  }

  async readRawConfig(scope: "project" | "global", directory?: string): Promise<RawConfigDocument> {
    const resolved = await this.resolveRawConfigPath(scope, directory);
    const content = await readFile(resolved.path, "utf8").catch(() => "{}\n");
    return {
      scope,
      directory,
      path: resolved.path,
      content,
    };
  }

  async writeRawConfig(scope: "project" | "global", content: string, directory?: string): Promise<RawConfigDocument> {
    const parseErrors: Parameters<typeof parseJsonc>[1] = [];
    parseJsonc(content, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length > 0) {
      const first = parseErrors[0];
      throw new Error(`Invalid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
    }

    const resolved = await this.resolveRawConfigPath(scope, directory);
    await mkdir(path.dirname(resolved.path), { recursive: true });
    await writeFile(resolved.path, content, "utf8");

    if (scope === "global") {
      await this.client(directory).global.dispose().catch(() => undefined);
    } else if (directory) {
      await this.client(directory).instance.dispose({ directory }).catch(() => undefined);
    }

    return {
      scope,
      directory,
      path: resolved.path,
      content,
    };
  }

  async listProviders(directory?: string): Promise<ProviderListResponse> {
    const fallback: ProviderListResponse = { all: [], connected: [], default: {} };
    try {
      const response = await this.client(directory).provider.list(directory ? { directory } : undefined);
      const providers = await this.unwrap(response, fallback);
      return await this.filterAuthenticatedProviders(providers);
    } catch {
      return fallback;
    }
  }

  async listAgents(directory?: string): Promise<Agent[]> {
    try {
      const response = await this.client(directory).app.agents(directory ? { directory } : undefined);
      return this.unwrap(response, []);
    } catch {
      return [];
    }
  }

  // ── MCP DevTools (SDK-managed) ─────────────────────────────────────

  async registerMcpDevTools(directory: string, cdpPort: number): Promise<void> {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const client = this.client(normalizedDirectory);
    await client.mcp.add({
      name: "chrome-devtools",
      directory: normalizedDirectory,
      config: {
        type: "local",
        command: ["npx", "chrome-devtools-mcp", "--browser-url", `http://127.0.0.1:${cdpPort}`],
      },
    });
    await client.mcp.connect({ name: "chrome-devtools", directory: normalizedDirectory });
  }

  async disconnectMcpDevTools(directory: string): Promise<void> {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const client = this.client(normalizedDirectory);
    await client.mcp.disconnect({ name: "chrome-devtools", directory: normalizedDirectory });
  }

  async getMcpDevToolsStatus(directory: string): Promise<unknown> {
    const normalizedDirectory = this.ensureWorkspaceDirectory(directory);
    const client = this.client(normalizedDirectory);
    return this.unwrap(client.mcp.status({ directory: normalizedDirectory })).catch(() => ({}));
  }

  async listPtys(directory: string) {
    const response = await this.client(directory).pty.list({ directory });
    return this.unwrap<Pty[]>(response);
  }

  async createPty(directory: string, cwd?: string, title?: string) {
    const response = await this.client(directory).pty.create({
      directory,
      cwd,
      title,
    });
    return this.unwrap<Pty>(response);
  }

  async connectPty(directory: string, ptyID: string): Promise<TerminalConnectResult> {
    const key = this.ptyKey(directory, ptyID);
    const existing = this.ptySockets.get(key);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return {
        ptyID,
        directory,
        connected: true,
      };
    }

    const url = this.baseWsUrl();
    url.pathname = `/pty/${ptyID}/connect`;
    url.searchParams.set("directory", directory);

    const authHeader = this.authHeader;
    const socket = new WebSocket(url, {
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", (error) => reject(error));
    });

    socket.on("message", (chunk) => {
      const str = chunk.toString();
      if (/^\s*\{"cursor"\s*:\s*\d+\}\s*%?\s*$/.test(str)) {
        return;
      }
      this.emit({
        type: "pty.output",
        payload: {
          ptyID,
          directory,
          chunk: str,
        },
      });
    });

    socket.on("close", () => {
      this.ptySockets.delete(key);
      this.emit({
        type: "pty.closed",
        payload: {
          ptyID,
          directory,
        },
      });
    });

    socket.on("error", (error) => {
      this.emitRuntimeError(`PTY socket error: ${sanitizeError(error)}`);
    });

    this.ptySockets.set(key, socket);

    return {
      ptyID,
      directory,
      connected: true,
    };
  }

  async writePty(directory: string, ptyID: string, data: string) {
    const socket = this.ptySockets.get(this.ptyKey(directory, ptyID));
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(data);
    return true;
  }

  async resizePty(directory: string, ptyID: string, cols: number, rows: number) {
    await this.client(directory).pty.update({
      directory,
      ptyID,
      size: { cols, rows },
    });
    return true;
  }

  async closePty(directory: string, ptyID: string) {
    const socketKey = this.ptyKey(directory, ptyID);
    const socket = this.ptySockets.get(socketKey);
    if (socket) {
      socket.close();
      this.ptySockets.delete(socketKey);
    }

    await this.client(directory).pty.remove({ directory, ptyID }).catch(() => undefined);
    return true;
  }

  private async syncSessionExecutionArtifacts(directory: string, sessionID: string) {
    const syncKey = `${directory}::${sessionID}`;
    const inFlight = this.sessionSyncInFlight.get(syncKey);
    if (inFlight) {
      await inFlight;
      return;
    }

    const run = (async () => {
      const bundles = await this.loadMessages(directory, sessionID).catch(() => []);
      const sorted = [...bundles].sort((a, b) => a.info.time.created - b.info.time.created);
      const fingerprint = sorted.map((item) => `${item.info.id}:${item.parts.length}:${item.info.time.created}`).join("|");
      if (this.sessionSyncFingerprint.get(syncKey) === fingerprint) {
        return;
      }

      const executionRecords: ExecutionEventRecord[] = [];
      const provenanceRecords: ChangeProvenanceRecord[] = [];

      for (const bundle of sorted) {
        let actor: ExecutionEventActor = { type: "main", name: "Main agent" };
        let delegationID: string | undefined;
        const timestampBase = bundle.info.time.created;

        for (let partIndex = 0; partIndex < bundle.parts.length; partIndex += 1) {
          const part = bundle.parts[partIndex] as Record<string, unknown> & { id: string; type: string };
          const timestamp = timestampBase + partIndex;

          if (part.type === "agent") {
            const name = typeof part.name === "string" ? part.name : "Agent";
            const isMain = name.trim().toLowerCase() === "main agent" || name.trim().toLowerCase() === "main";
            actor = { type: isMain ? "main" : "subagent", name };
            if (isMain) {
              delegationID = undefined;
            }
            continue;
          }

          if (part.type === "subtask") {
            const agentName = typeof part.agent === "string" ? part.agent : "subagent";
            const description = typeof part.description === "string" ? part.description : "Delegated task";
            const recordID = `${bundle.info.id}:${part.id}:delegate`;
            delegationID = part.id;
            actor = { type: "subagent", name: agentName };
            executionRecords.push({
              id: recordID,
              directory,
              sessionID,
              timestamp,
              kind: "delegate",
              summary: `Delegated to ${agentName}: ${description}`,
              detail: typeof part.prompt === "string" ? part.prompt : undefined,
              actor: { type: "main", name: "Main agent" },
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
            });
            continue;
          }

          if (part.type === "tool") {
            const state = (part.state ?? {}) as { status?: string; input?: unknown };
            if (state.status === "pending") {
              continue;
            }
            const toolName = typeof part.tool === "string" ? part.tool : "tool";
            const classified = classifyTool(toolName, state.input, directory);
            const recordID = `${bundle.info.id}:${part.id}:tool:${classified.kind}`;
            executionRecords.push({
              id: recordID,
              directory,
              sessionID,
              timestamp,
              kind: classified.kind,
              summary: classified.summary,
              actor,
              tool: toolName,
              operation: classified.operation,
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
              paths: classified.paths,
            });

            if (classified.operation) {
              for (const filePath of classified.paths) {
                if (!filePath || filePath === ".") {
                  continue;
                }
                provenanceRecords.push({
                  filePath,
                  operation: classified.operation,
                  actorType: actor.type,
                  actorName: actor.name,
                  tool: toolName,
                  delegationID,
                  turnID: bundle.info.id,
                  eventID: `${recordID}:${filePath}`,
                  timestamp,
                  reason: classified.summary,
                });
              }
            }
            continue;
          }

          if (part.type === "patch") {
            const files = Array.isArray(part.files)
              ? part.files.filter((item): item is string => typeof item === "string")
              : [];
            const normalizedPaths = files.map((item) => toWorkspaceRelativePath(directory, item));
            const recordID = `${bundle.info.id}:${part.id}:patch`;
            executionRecords.push({
              id: recordID,
              directory,
              sessionID,
              timestamp,
              kind: "edit",
              summary: normalizedPaths.length > 0 ? `Edited ${normalizedPaths.length} files` : "Edited files",
              actor,
              operation: "edit",
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
              paths: normalizedPaths,
            });
            for (const filePath of normalizedPaths) {
              provenanceRecords.push({
                filePath,
                operation: "edit",
                actorType: actor.type,
                actorName: actor.name,
                delegationID,
                turnID: bundle.info.id,
                eventID: `${recordID}:${filePath}`,
                timestamp,
                reason: "Patch update",
              });
            }
            continue;
          }

          if (part.type === "step-start") {
            executionRecords.push({
              id: `${bundle.info.id}:${part.id}:step-start`,
              directory,
              sessionID,
              timestamp,
              kind: "step",
              summary: "Step started",
              actor,
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
            });
            continue;
          }

          if (part.type === "step-finish") {
            const tokens = (part.tokens ?? {}) as { input?: number; output?: number; cache?: { read?: number } };
            const reason = typeof part.reason === "string" ? part.reason : "completed";
            executionRecords.push({
              id: `${bundle.info.id}:${part.id}:step-finish`,
              directory,
              sessionID,
              timestamp,
              kind: "step",
              summary: "Step finished",
              detail: `reason: ${reason} | input: ${tokens.input ?? 0} | output: ${tokens.output ?? 0} | cache read: ${tokens.cache?.read ?? 0}`,
              actor,
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
            });
            continue;
          }

          if (part.type === "reasoning") {
            const text = typeof part.text === "string" ? part.text.trim() : "";
            executionRecords.push({
              id: `${bundle.info.id}:${part.id}:reasoning`,
              directory,
              sessionID,
              timestamp,
              kind: "reasoning",
              summary: "Reasoning update",
              detail: text.length > 0 ? text.slice(0, 240) : undefined,
              actor,
              turnID: bundle.info.id,
              delegationID,
              eventID: part.id,
            });
            continue;
          }
        }
      }

      await this.ledgerStore.appendMany(directory, sessionID, executionRecords);
      await this.provenanceIndex.appendMany(directory, sessionID, provenanceRecords);
      this.sessionSyncFingerprint.set(syncKey, fingerprint);
    })();

    this.sessionSyncInFlight.set(syncKey, run);
    try {
      await run;
    } finally {
      this.sessionSyncInFlight.delete(syncKey);
    }
  }

  private toObjectRecord(input: unknown) {
    if (!input) {
      return null;
    }
    if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input) as Record<string, unknown>;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    if (typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    return null;
  }

  private extractStringByKeys(input: unknown, keys: string[]): string | undefined {
    if (!input || typeof input !== "object") {
      return undefined;
    }
    if (Array.isArray(input)) {
      for (const value of input) {
        const nested = this.extractStringByKeys(value, keys);
        if (nested) {
          return nested;
        }
      }
      return undefined;
    }
    const record = input as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    for (const value of Object.values(record)) {
      const nested = this.extractStringByKeys(value, keys);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  private extractTaskChildSessionID(part: SessionMessageBundle["parts"][number]) {
    if (part.type !== "tool" || !isTaskToolName(part.tool)) {
      return undefined;
    }
    const state = part.state as Record<string, unknown>;
    const metadata = this.toObjectRecord(state.metadata);
    const fromMetadata = metadata
      ? this.extractStringByKeys(metadata, ["sessionId", "sessionID", "task_id", "taskId", "session_id"])
      : undefined;
    if (fromMetadata) {
      return fromMetadata;
    }
    const output = state.output;
    const outputRecord = this.toObjectRecord(output);
    const fromOutputRecord = outputRecord
      ? this.extractStringByKeys(outputRecord, ["sessionId", "sessionID", "task_id", "taskId", "session_id"])
      : undefined;
    if (fromOutputRecord) {
      return fromOutputRecord;
    }
    if (typeof output !== "string") {
      return undefined;
    }
    const trimmed = output.trim();
    if (!trimmed) {
      return undefined;
    }
    return (
      trimmed.match(/<task_id>\s*([A-Za-z0-9._:-]+)\s*<\/task_id>/i)?.[1]?.trim() ??
      trimmed.match(/\b(?:task[_-]?id|session[_-]?id|taskId|sessionId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1]?.trim()
    );
  }

  private async collectAbortableSessionTree(directory: string, sessionID: string, seen = new Set<string>()) {
    if (!sessionID || seen.has(sessionID)) {
      return [];
    }
    seen.add(sessionID);
    const bundles = await this.loadMessages(directory, sessionID).catch(() => []);
    const childSessionIDs = new Set<string>();
    for (const bundle of bundles) {
      if (bundle.info.role !== "assistant") {
        continue;
      }
      for (const part of bundle.parts) {
        if (part.type === "subtask" && typeof part.sessionID === "string" && part.sessionID.trim()) {
          childSessionIDs.add(part.sessionID.trim());
          continue;
        }
        const taskChildSessionID = this.extractTaskChildSessionID(part);
        if (taskChildSessionID) {
          childSessionIDs.add(taskChildSessionID);
        }
      }
    }
    const descendants: string[] = [];
    for (const childSessionID of childSessionIDs) {
      descendants.push(...await this.collectAbortableSessionTree(directory, childSessionID, seen));
    }
    return [...descendants, sessionID];
  }

  private extractSessionIDFromStreamEvent(event: Event) {
    const asRecord = event as unknown as { properties?: Record<string, unknown> };
    const properties = asRecord.properties;
    if (!properties || typeof properties !== "object") {
      return undefined;
    }
    if (typeof properties.sessionID === "string") {
      return properties.sessionID;
    }
    const info = properties.info;
    if (info && typeof info === "object") {
      const infoRecord = info as Record<string, unknown>;
      if (typeof infoRecord.sessionID === "string") {
        return infoRecord.sessionID;
      }
    }
    const part = properties.part;
    if (part && typeof part === "object") {
      const partRecord = part as Record<string, unknown>;
      if (typeof partRecord.sessionID === "string") {
        return partRecord.sessionID;
      }
    }
    const message = properties.message;
    if (message && typeof message === "object") {
      const messageRecord = message as Record<string, unknown>;
      if (typeof messageRecord.sessionID === "string") {
        return messageRecord.sessionID;
      }
    }
    return undefined;
  }

  private shouldIngestMemoryForEventType(type: string) {
    return (
      type === "session.idle" ||
      type === "session.status" ||
      type === "message.created" ||
      type === "message.updated" ||
      type === "message.part.created" ||
      type === "message.part.updated" ||
      type === "message.part.added"
    );
  }

  private async scheduleSessionMemoryIngest(directoryInput: string, sessionID: string, reason: string) {
    const directory = path.resolve(directoryInput);
    const key = `${directory}::${sessionID}`;
    const inFlight = this.memoryIngestInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }
    const lastAt = this.memoryIngestAt.get(key) ?? 0;
    const nowAt = Date.now();
    if (reason !== "session.idle" && nowAt - lastAt < 1_800) {
      return;
    }
    const run = (async () => {
      try {
        const bundles = await this.loadMessages(directory, sessionID).catch(() => []);
        const workspaceAllowlist = this.listStoredProjects().map((item) => path.resolve(item.worktree));
        await this.memoryStore.ingestSessionMessages(directory, sessionID, bundles, {
          workspaceAllowlist,
        });
        this.memoryIngestAt.set(key, Date.now());
      } catch {
        // Best-effort memory ingestion should never break session operations.
      }
    })();
    this.memoryIngestInFlight.set(key, run);
    try {
      await run;
    } finally {
      this.memoryIngestInFlight.delete(key);
    }
  }

  private setState(next: RuntimeState) {
    this.state = next;
    this.emit({
      type: "runtime.status",
      payload: this.runtimeState(),
    });
  }

  private emitRuntimeError(message: string) {
    this.state.lastError = message;
    this.emit({
      type: "runtime.error",
      payload: { message },
    });
  }

  private emit(event: OrxaEvent) {
    this.onEvent?.(event);
  }

  private summarizeStreamEvent(event: Event) {
    if (event.type === "session.error") {
      const properties = (event as { properties?: { sessionID?: string; error?: Record<string, unknown> } }).properties;
      const errorRecord = properties?.error && typeof properties.error === "object"
        ? properties.error
        : undefined;
      return {
        type: String(event.type),
        properties: {
          sessionID: properties?.sessionID,
          error: errorRecord
            ? {
                ...errorRecord,
                message: typeof errorRecord.message === "string" ? errorRecord.message : undefined,
                code: typeof errorRecord.code === "string" ? errorRecord.code : undefined,
                name: typeof errorRecord.name === "string" ? errorRecord.name : undefined,
                cause: errorRecord.cause,
              }
            : undefined,
        },
      };
    }

    if (event.type === "session.status") {
      const properties = (
        event as { properties?: { sessionID?: string; status?: { type?: string; message?: string; attempt?: number } } }
      ).properties;
      return {
        type: String(event.type),
        properties: {
          sessionID: properties?.sessionID,
          status: properties?.status
            ? {
                type: properties.status.type,
                message: properties.status.message,
                attempt: properties.status.attempt,
              }
            : undefined,
        },
      };
    }

    if (event.type === "session.idle") {
      const properties = (event as { properties?: { sessionID?: string } }).properties;
      return {
        type: String(event.type),
        properties: {
          sessionID: properties?.sessionID,
        },
      };
    }
    return { type: String(event.type) };
  }

  private baseUrl(profile: RuntimeProfile) {
    const protocol = profile.https ? "https" : "http";
    return `${protocol}://${profile.host}:${profile.port}`;
  }

  private baseWsUrl() {
    const active = this.requireProfile();
    const protocol = active.https ? "wss" : "ws";
    return new URL(`${protocol}://${active.host}:${active.port}`);
  }

  private requireProfile() {
    if (this.activeProfile) {
      return this.activeProfile;
    }

    const activeID = this.profileStore.activeProfileId();
    const profile = this.profileStore.list().find((item) => item.id === activeID) ?? this.profileStore.list()[0];
    if (!profile) {
      throw new Error("No runtime profile configured");
    }

    this.activeProfile = profile;
    this.profileStore.setActiveProfileId(profile.id);
    return profile;
  }

  private async basicAuthHeader(profileInput?: RuntimeProfile) {
    const profile = profileInput ?? this.requireProfile();
    if (!profile.username || !profile.hasPassword) {
      return undefined;
    }

    const password = await this.passwordStore.get(profile.id);
    if (!password) {
      return undefined;
    }

    const token = Buffer.from(`${profile.username}:${password}`).toString("base64");
    return `Basic ${token}`;
  }

  private client(directory?: string, signal?: AbortSignal): OpencodeClient {
    const profile = this.requireProfile();
    const baseUrl = this.baseUrl(profile);

    const headers: Record<string, string> = {};
    if (this.authHeader) {
      headers.Authorization = this.authHeader;
    }

    const options = {
      baseUrl,
      directory,
      signal,
      throwOnError: true,
      headers,
    } as const;

    return createOpencodeClient(options);
  }

  private async resolveBinary(customPath: string | undefined) {
    if (customPath && customPath.length > 0) {
      return customPath;
    }

    return "opencode";
  }

  private unwrap<T>(promise: Promise<{ data?: T }> | { data?: T }): Promise<T>;
  private unwrap<T>(promise: Promise<{ data?: T }> | { data?: T }, fallback: T): Promise<T>;
  private async unwrap<T>(promise: Promise<{ data?: T }> | { data?: T }, fallback?: T): Promise<T> {
    const result = await promise;
    if (result.data !== undefined) {
      return result.data;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("OpenCode API returned no data");
  }

  private async listAuthenticatedProviderIDs() {
    const authPath = path.join(homedir(), ".local", "share", "opencode", "auth.json");
    const content = await readFile(authPath, "utf8").catch(() => "");
    if (!content.trim()) {
      return new Set<string>();
    }

    const parsed = parseJsonc(content);
    if (!isRecord(parsed)) {
      return new Set<string>();
    }

    return new Set(
      Object.entries(parsed)
        .filter(([, value]) => isRecord(value))
        .map(([providerID]) => providerID),
    );
  }

  private providerHasSatisfiedEnv(provider: unknown) {
    const envKeys = listProviderEnvKeys(provider);
    if (envKeys.length === 0) {
      return false;
    }

    return envKeys.some((envKey) => {
      const value = process.env[envKey];
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  private async filterAuthenticatedProviders(providers: ProviderListResponse): Promise<ProviderListResponse> {
    const authIDs = await this.listAuthenticatedProviderIDs();
    const connectedIDs = Array.isArray(providers.connected)
      ? providers.connected.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    const allowed = new Set<string>([...connectedIDs, ...authIDs]);
    const all = Array.isArray(providers.all)
      ? providers.all.filter((provider) => {
        if (!isRecord(provider) || typeof provider.id !== "string" || provider.id.trim().length === 0) {
          return false;
        }
        return allowed.has(provider.id) || this.providerHasSatisfiedEnv(provider);
      })
      : [];

    const authenticatedIDs = new Set<string>();
    for (const provider of all) {
      if (isRecord(provider) && typeof provider.id === "string" && provider.id.trim().length > 0) {
        authenticatedIDs.add(provider.id);
      }
    }

    const nextDefault = isRecord(providers.default)
      ? Object.fromEntries(
        Object.entries(providers.default).filter(([providerID]) => authenticatedIDs.has(providerID)),
      )
      : {};

    return {
      all,
      connected: [...authenticatedIDs].sort((a, b) => a.localeCompare(b)),
      default: nextDefault,
    };
  }

  private ptyKey(directory: string, ptyID: string) {
    return `${directory}::${ptyID}`;
  }

  private stopGlobalStream() {
    if (this.globalAbort) {
      this.globalAbort.abort();
      this.globalAbort = undefined;
    }
  }

  private stopProjectStream() {
    if (this.projectAbort) {
      this.projectAbort.abort();
      this.projectAbort = undefined;
    }
  }

  private startGlobalStream() {
    this.stopGlobalStream();
    const abort = new AbortController();
    this.globalAbort = abort;

    const loop = async () => {
      while (!abort.signal.aborted) {
        try {
          const stream = await this.client(undefined, abort.signal).global.event();
          for await (const packet of stream.stream) {
            if (abort.signal.aborted) {
              break;
            }

            const event = packet.payload;
            const directory = packet.directory;
            this.emit({
              type: "opencode.global",
              payload: {
                directory,
                event: this.summarizeStreamEvent(event),
              },
            });
          }
        } catch (error) {
          if (abort.signal.aborted) {
            return;
          }
          this.emitRuntimeError(`Global event stream error: ${sanitizeError(error)}`);
          await delay(1200);
        }
      }
    };

    void loop();
  }

  private startProjectStream(directory: string) {
    this.stopProjectStream();
    const abort = new AbortController();
    this.projectAbort = abort;

    const loop = async () => {
      while (!abort.signal.aborted) {
        try {
          const stream = await this.client(directory, abort.signal).event.subscribe({ directory });
          for await (const event of stream.stream) {
            if (abort.signal.aborted) {
              break;
            }

            const eventType = String(event.type);
            const eventSessionID = this.extractSessionIDFromStreamEvent(event);
            if (eventSessionID && this.shouldIngestMemoryForEventType(eventType)) {
              void this.scheduleSessionMemoryIngest(directory, eventSessionID, eventType);
            }

            this.emit({
              type: "opencode.project",
              payload: {
                directory,
                event: this.summarizeStreamEvent(event),
              },
            });
          }
        } catch (error) {
          if (abort.signal.aborted) {
            return;
          }
          this.emitRuntimeError(`Project event stream error (${directory}): ${sanitizeError(error)}`);
          await delay(1200);
        }
      }
    };

    void loop();
  }

  private async resolveRawConfigPath(scope: "project" | "global", directory?: string) {
    if (scope === "project") {
      if (!directory) {
        throw new Error("Directory is required for project config access");
      }

      return {
        path: this.findConfigFile(directory),
      };
    }

    const base = await (async () => {
      if (directory) {
        const pathInfo = await this.unwrap(this.client(directory).path.get({ directory })).catch(() => undefined);
        if (pathInfo?.config) {
          return pathInfo.config;
        }
      }
      return path.join(homedir(), ".config", "opencode");
    })();

    return {
      path: this.findConfigFile(base),
    };
  }

  private findConfigFile(base: string) {
    const candidates = ["opencode.jsonc", "opencode.json", "config.json"].map((filename) => path.join(base, filename));
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0]!;
  }

  async initializeFromStoredProfile() {
    const profiles = this.profileStore.list();
    const activeID = this.profileStore.activeProfileId() ?? profiles[0]?.id;
    if (!activeID) {
      return this.runtimeState();
    }

    const activeProfile = profiles.find((item) => item.id === activeID);
    if (!activeProfile) {
      return this.runtimeState();
    }

    if (activeProfile.startCommand) {
      try {
        return await this.startLocal(activeID);
      } catch (startError) {
        const message = `Failed to start managed local OpenCode: ${sanitizeError(startError)}`;
        this.setState({
          status: "error",
          activeProfileId: activeID,
          managedServer: !!this.managedProcess,
          baseUrl: this.baseUrl(activeProfile),
          lastError: message,
        });
        return this.runtimeState();
      }
    }

    try {
      return await this.attach(activeID);
    } catch (error) {
      const message = sanitizeError(error);
      this.setState({
        status: "error",
        activeProfileId: activeID,
        managedServer: !!this.managedProcess,
        baseUrl: this.baseUrl(activeProfile),
        lastError: message,
      });
      return this.runtimeState();
    }
  }

  setErrorStatus(message: string) {
    this.setState({
      status: "error",
      activeProfileId: this.state.activeProfileId,
      managedServer: !!this.managedProcess,
      baseUrl: this.state.baseUrl,
      lastError: message,
    });
  }

  connectionStatus(): RuntimeConnectionStatus {
    return this.state.status;
  }

  private listStoredProjects(): ProjectListItem[] {
    const available: string[] = [];
    for (const worktree of this.projectStore.list()) {
      if (existsSync(worktree)) {
        available.push(worktree);
      } else {
        this.projectStore.remove(worktree);
      }
    }
    return available.map((worktree) => ({
      id: `local:${worktree}`,
      name: path.basename(worktree),
      worktree: path.resolve(worktree),
      source: "local",
    }));
  }

  private ensureWorkspaceDirectory(directoryInput: string, invalidMessage?: string) {
    const normalized = path.resolve(directoryInput);
    let info: ReturnType<typeof statSync> | undefined;
    try {
      info = statSync(normalized);
    } catch {
      info = undefined;
    }
    if (!info) {
      throw new Error(invalidMessage ?? `Workspace directory is no longer accessible: ${normalized}`);
    }
    if (!info.isDirectory()) {
      throw new Error(invalidMessage ?? `Workspace directory is no longer accessible: ${normalized}`);
    }
    return normalized;
  }

  private async runCommand(command: string, args: string[], cwd: string) {
    return this.commandHelpers.runCommand(command, args, cwd);
  }

  private async canRunCommand(command: string, args: string[], cwd: string) {
    return this.commandHelpers.canRunCommand(command, args, cwd);
  }

  private async canRunCommandWithFallbacks(command: string, args: string[], cwd: string) {
    const direct = await this.canRunCommand(command, args, cwd);
    if (direct) {
      return true;
    }
    const candidates = await this.commandPathCandidates(command);
    for (const candidate of candidates) {
      if (await this.canRunCommand(candidate, args, cwd)) {
        return true;
      }
    }
    return this.canRunCommandViaLoginShell(command, args, cwd);
  }

  private async commandPathCandidates(command: string) {
    return this.commandHelpers.commandPathCandidates(command);
  }

  private async canRunCommandViaLoginShell(command: string, args: string[], cwd: string) {
    return this.commandHelpers.canRunCommandViaLoginShell(command, args, cwd);
  }

  private async resolveCommandPath(command: string, cwd: string) {
    if (await this.canRunCommand(command, ["--version"], cwd)) {
      return command;
    }

    const candidates = await this.commandPathCandidates(command);
    for (const candidate of candidates) {
      if (await this.canRunCommand(candidate, ["--version"], cwd)) {
        return candidate;
      }
    }

    return this.commandPathViaLoginShell(command, cwd);
  }

  private async commandPathViaLoginShell(command: string, cwd: string) {
    return this.commandHelpers.commandPathViaLoginShell(command, cwd);
  }

  private async runCommandWithOutput(command: string, args: string[], cwd: string) {
    return this.commandHelpers.runCommandWithOutput(command, args, cwd);
  }

  private async renderUntrackedDiff(repoRoot: string, relativePath: string) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const fullPath = path.resolve(repoRoot, relativePath);
    const baseHeader = [`diff --git a/${normalizedPath} b/${normalizedPath}`, "new file mode 100644"];
    try {
      const content = await readFile(fullPath);
      if (content.includes(0)) {
        return [...baseHeader, `Binary files /dev/null and b/${normalizedPath} differ`].join("\n");
      }

      const text = content.toString("utf8").replace(/\r\n/g, "\n");
      const hasTrailingNewline = text.endsWith("\n");
      const rawLines = text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
      const diffLines = [
        ...baseHeader,
        "--- /dev/null",
        `+++ b/${normalizedPath}`,
      ];
      if (rawLines.length > 0) {
        diffLines.push(`@@ -0,0 +1,${rawLines.length} @@`);
        diffLines.push(...rawLines.map((line) => `+${line}`));
      }
      if (!hasTrailingNewline && rawLines.length > 0) {
        diffLines.push("\\ No newline at end of file");
      }
      return diffLines.join("\n");
    } catch {
      return [...baseHeader, `Binary files /dev/null and b/${normalizedPath} differ`].join("\n");
    }
  }

  private async runCommandAttempts(attempts: Array<{ command: string; args: string[]; label: string }>, cwd: string) {
    return this.commandHelpers.runCommandAttempts(attempts, cwd, (command, args, attemptCwd) =>
      this.runCommand(command, args, attemptCwd),
    );
  }

  private async collectGitStats(repoRoot: string, includeUnstaged: boolean) {
    if (includeUnstaged) {
      const combined = await this.gitDiff(repoRoot);
      return this.parseGitPatchStats(combined);
    }

    const staged = await this.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "diff", "--staged", "--", "."], repoRoot).catch(
      () => "",
    );
    return this.parseGitPatchStats(staged);
  }

  private parseGitPatchStats(output: string) {
    return parseGitPatchStats(output);
  }

  private async currentBranch(repoRoot: string) {
    const branch = await this.runCommandWithOutput("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], repoRoot).catch(
      () => "HEAD",
    );
    return branch.trim() || "HEAD";
  }

  private fallbackCommitMessage(stats: { filesChanged: number; insertions: number; deletions: number }) {
    return fallbackCommitMessage(stats);
  }

  private toCommitMessageArgs(message: string) {
    return toCommitMessageArgs(message);
  }

  private async pushBranch(repoRoot: string, branch: string) {
    try {
      await this.runCommand("git", ["-C", repoRoot, "push"], repoRoot);
      return;
    } catch (error) {
      const message = sanitizeError(error).toLowerCase();
      if (!message.includes("no upstream branch") && !message.includes("set-upstream")) {
        throw error;
      }
    }
    await this.runCommand("git", ["-C", repoRoot, "push", "-u", "origin", branch], repoRoot);
  }

  private normalizeGitHubRemote(remoteUrl: string) {
    return normalizeGitHubRemote(remoteUrl);
  }

  private async resolveOriginBaseBranch(repoRoot: string) {
    const symbolic = await this.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      repoRoot,
    ).catch(() => "");
    const normalized = symbolic.trim();
    if (normalized.startsWith("origin/")) {
      const branch = normalized.slice("origin/".length).trim();
      if (branch) {
        return branch;
      }
    }
    return undefined;
  }

  private async buildManualPrUrl(repoRoot: string, branch: string, baseBranch?: string) {
    const remote = await this.runCommandWithOutput("git", ["-C", repoRoot, "remote", "get-url", "origin"], repoRoot).catch(() => "");
    const remoteWebBase = this.normalizeGitHubRemote(remote);
    if (!remoteWebBase) {
      return undefined;
    }
    const base = baseBranch?.trim() || (await this.resolveOriginBaseBranch(repoRoot)) || "main";
    return `${remoteWebBase}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
  }

  private async generateCommitMessageWithAgent(directory: string, prompt: string) {
    const helperSession = await this.unwrap(
      this.client(directory).session.create({
        directory,
        title: "Commit message helper",
      }),
    );

    try {
      await this.client(directory).session.prompt({
        directory,
        sessionID: helperSession.id,
        parts: [
          {
            type: "text",
            text: prompt,
          },
        ],
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt < 45_000) {
        await delay(900);
        const status = await this.unwrap(this.client(directory).session.status({ directory })).catch(() => ({}));
        const sessionState = (status as Record<string, { type?: string }>)[helperSession.id]?.type;
        if (sessionState === "idle" || sessionState === "error") {
          break;
        }
      }

      const bundles = await this.loadMessages(directory, helperSession.id).catch(() => []);
      return this.extractAssistantText(bundles);
    } finally {
      await this.client(directory).session.delete({ directory, sessionID: helperSession.id }).catch(() => undefined);
    }
  }

  private extractAssistantText(messages: SessionMessageBundle[]) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const bundle = messages[messageIndex];
      const info = bundle.info as { role?: string };
      if (info.role !== "assistant") {
        continue;
      }
      const chunks: string[] = [];
      for (const part of bundle.parts) {
        if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
          chunks.push(part.text.trim());
        }
      }
      if (chunks.length > 0) {
        return chunks.join("\n\n");
      }
    }
    return undefined;
  }

  private async resolveGitRepoRoot(directory: string) {
    const output = await this.runCommandWithOutput("git", ["-C", directory, "rev-parse", "--show-toplevel"], directory).catch(
      () => undefined,
    );
    const resolved = output?.trim();
    if (!resolved) {
      return undefined;
    }
    return resolved;
  }

  private async gitRefExists(repoRoot: string, ref: string) {
    try {
      await this.runCommand("git", ["-C", repoRoot, "show-ref", "--verify", "--quiet", ref], repoRoot);
      return true;
    } catch {
      return false;
    }
  }

}
