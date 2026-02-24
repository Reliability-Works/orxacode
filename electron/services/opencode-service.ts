import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import {
  createOpencodeClient,
  type Config,
  type Event,
  type OpencodeClient,
  type ProviderListResponse,
  type QuestionAnswer,
  type Pty,
  type Session,
  type Worktree,
} from "@opencode-ai/sdk/v2/client";
import WebSocket from "ws";
import type {
  AgentsDocument,
  GitBranchState,
  GitCommitRequest,
  GitCommitResult,
  GitCommitSummary,
  GlobalBootstrap,
  OpenCodeAgentFile,
  OpenDirectoryResult,
  OpenDirectoryTarget,
  OrxaEvent,
  OrxaAgentDetails,
  OrxaAgentHistoryDocument,
  ProjectListItem,
  ProjectBootstrap,
  PromptRequest,
  OrxaAgentDocument,
  RawConfigDocument,
  RuntimeConnectionStatus,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeState,
  SkillEntry,
  ServerDiagnostics,
  ProjectFileDocument,
  ProjectFileEntry,
  SessionMessageBundle,
  TerminalConnectResult,
  WorktreeSessionResult,
} from "../../shared/ipc";
import { PasswordStore } from "./password-store";
import {
  ORXA_PLUGIN_PACKAGE,
  ORXA_PLUGIN_SPECIFIER,
  canonicalPluginName,
  updateOrxaPluginInConfigDocument,
} from "./plugin-config";
import { ProjectStore } from "./project-store";
import { ProfileStore } from "./profile-store";

const DEFAULT_TIMEOUT_MS = 10_000;
const PROJECT_FILE_SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo"]);
const DEFAULT_COMMIT_GUIDANCE = [
  "Write a high-quality conventional commit message.",
  "Use this format:",
  "1) First line: <type>(optional-scope): concise summary in imperative mood.",
  "2) Blank line.",
  "3) Body bullets grouped by area, clearly describing what changed and why.",
  "4) Mention notable side effects, risk, and follow-up work if relevant.",
  "5) Keep it specific to the included diff and avoid generic phrasing.",
].join("\n");

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function sanitizeError(error: unknown) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  return raw
    .replace(/https?:\/\/[^\s)]+/gi, "[server]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[server]");
}

function parseSimpleYamlFrontmatter(content: string) {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    return {
      metadata: {} as Record<string, string>,
      body: trimmed,
      hasFrontmatter: false,
    };
  }

  const lines = trimmed.split(/\r?\n/);
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) {
    return {
      metadata: {} as Record<string, string>,
      body: trimmed,
      hasFrontmatter: false,
    };
  }

  const metadata: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1]!;
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }

  return {
    metadata,
    body: lines.slice(end + 1).join("\n").trim(),
    hasFrontmatter: true,
  };
}

function toYamlScalar(value: string) {
  if (/^[A-Za-z0-9_.@/-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
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

export class OpencodeService {
  private profileStore = new ProfileStore();
  private projectStore = new ProjectStore();
  private passwordStore = new PasswordStore();

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
    const args = [
      "serve",
      `--hostname=${profile.startHost}`,
      `--port=${profile.startPort}`,
      ...profile.corsOrigins.map((origin) => `--cors=${origin}`),
    ];

    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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

    profile.host = profile.startHost;
    profile.port = profile.startPort;
    profile.https = launchedUrl.startsWith("https://");
    this.profileStore.save(profile);

    return this.attach(profileID);
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

  async addProjectDirectory(directory: string) {
    const normalized = path.resolve(directory);
    const info = await stat(normalized).catch(() => undefined);
    if (!info || !info.isDirectory()) {
      throw new Error("Selected path is not a directory");
    }
    this.projectStore.add(normalized);
    return normalized;
  }

  async removeProjectDirectory(directory: string) {
    this.projectStore.remove(path.resolve(directory));
    return true;
  }

  async ensureOrxaWorkspace(templateRoot: string) {
    const resolvedTemplateRoot = path.resolve(templateRoot);
    const rootInfo = await stat(resolvedTemplateRoot).catch(() => undefined);
    if (!rootInfo || !rootInfo.isDirectory()) {
      throw new Error(`Orxa template directory is missing: ${resolvedTemplateRoot}`);
    }

    const orxaRoot = this.orxaRootDir();
    await this.copyDirectoryIfMissing(resolvedTemplateRoot, orxaRoot);
  }

  async ensureOrxaPluginRegistration() {
    const configDir = path.join(homedir(), ".config", "opencode");
    await mkdir(configDir, { recursive: true });

    await this.addOrxaPluginToConfig();

    await this.ensureOrxaPluginInstalled(configDir);
  }

  async addOrxaPluginToConfig() {
    const configDir = path.join(homedir(), ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    const configPath = this.findConfigFile(configDir);
    const raw = await readFile(configPath, "utf8").catch(() => "{}\n");
    const result = updateOrxaPluginInConfigDocument(raw, "orxa");
    if (result.changed) {
      await writeFile(configPath, result.output, "utf8");
    }
    return { changed: result.changed, configPath };
  }

  async removeOrxaPluginFromConfig() {
    const configDir = path.join(homedir(), ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    const configPath = this.findConfigFile(configDir);
    const raw = await readFile(configPath, "utf8").catch(() => "{}\n");
    const result = updateOrxaPluginInConfigDocument(raw, "standard");
    if (result.changed) {
      await writeFile(configPath, result.output, "utf8");
    }
    return { changed: result.changed, configPath };
  }

  async getServerDiagnostics(): Promise<ServerDiagnostics> {
    const runtime = this.runtimeState();
    const profile = this.profileStore.list().find((item) => item.id === runtime.activeProfileId);
    const configDir = path.join(homedir(), ".config", "opencode");
    const configPath = this.findConfigFile(configDir);
    const raw = await readFile(configPath, "utf8").catch(() => "{}\n");
    const parsed = parseJsonc(raw) as Record<string, unknown> | undefined;
    const configuredPlugins = Array.isArray(parsed?.plugin)
      ? parsed.plugin.filter((item): item is string => typeof item === "string")
      : [];
    const pluginConfigured = configuredPlugins.some((item) => canonicalPluginName(item) === ORXA_PLUGIN_PACKAGE);
    const installedPath = path.join(configDir, "node_modules", "@reliabilityworks", "opencode-orxa");
    const installed = await stat(installedPath).then((item) => item.isDirectory()).catch(() => false);

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
      plugin: {
        specifier: ORXA_PLUGIN_SPECIFIER,
        configPath,
        installedPath,
        configured: pluginConfigured,
        installed,
      },
      lastError: runtime.lastError,
    };
  }

  async repairRuntime(templateRoot: string): Promise<ServerDiagnostics> {
    await this.ensureOrxaWorkspace(templateRoot);
    await this.ensureOrxaPluginRegistration();
    return this.getServerDiagnostics();
  }

  async readOrxaConfig(): Promise<RawConfigDocument> {
    const configPath = this.orxaConfigPath();
    const content = await readFile(configPath, "utf8").catch(() => "{}\n");
    return {
      scope: "global",
      path: configPath,
      content,
    };
  }

  async readOrxaAgentPrompt(agent: "orxa" | "plan"): Promise<string | undefined> {
    const filePath = this.orxaAgentPromptPath(agent);
    const content = await readFile(filePath, "utf8").catch(() => undefined);
    if (!content) {
      return undefined;
    }
    const prompt = this.extractMarkdownBody(content);
    return prompt.length > 0 ? prompt : undefined;
  }

  async listOrxaAgents(): Promise<OrxaAgentDocument[]> {
    const baseRoot = path.join(this.orxaRootDir(), "agents");
    const overrideRoot = path.join(baseRoot, "overrides");
    const customRoot = path.join(baseRoot, "custom");

    const discovered = new Map<string, { path: string; source: OrxaAgentDocument["source"]; priority: number }>();
    const collect = async (root: string, source: OrxaAgentDocument["source"], priority: number) => {
      const files = await this.scanAgentFiles(root);
      for (const filePath of files) {
        const name = path.basename(filePath).replace(/\.(yaml|yml)$/i, "");
        const existing = discovered.get(name);
        const existingIsSubagent = existing ? existing.path.includes(`${path.sep}subagents${path.sep}`) : false;
        const nextIsSubagent = filePath.includes(`${path.sep}subagents${path.sep}`);
        const replaceSubagentWithPrimary = existing
          ? priority === existing.priority && existingIsSubagent && !nextIsSubagent
          : false;

        if (!existing || priority > existing.priority || replaceSubagentWithPrimary) {
          discovered.set(name, { path: filePath, source, priority });
        }
      }
    };

    const pluginRoot = path.join(
      homedir(),
      ".config",
      "opencode",
      "node_modules",
      "@reliabilityworks",
      "opencode-orxa",
      "agents",
    );
    await collect(pluginRoot, "base", 0);
    await collect(baseRoot, "base", 1);
    await collect(overrideRoot, "override", 2);
    await collect(customRoot, "custom", 3);

    const orxaConfigDoc = await this.readOrxaConfig().catch(() => undefined);
    const orxaConfig = orxaConfigDoc
      ? (parseJsonc(orxaConfigDoc.content) as {
          model?: string;
          small_model?: string;
          orxa?: { model?: string };
          plan?: { model?: string };
        })
      : undefined;

    const entries = Array.from(discovered.entries());
    const output: OrxaAgentDocument[] = [];
    for (const [name, item] of entries) {
      const raw = await readFile(item.path, "utf8").catch(() => "");
      const parsed = parseSimpleYamlFrontmatter(raw);

      const inferredMode: OrxaAgentDocument["mode"] =
        parsed.metadata.mode === "primary" || parsed.metadata.mode === "subagent" || parsed.metadata.mode === "all"
          ? parsed.metadata.mode
          : (name === "orxa" || name === "plan" ? "primary" : item.path.includes(`${path.sep}subagents${path.sep}`) ? "subagent" : "subagent");
      const modelFromConfig =
        name === "orxa"
          ? (orxaConfig?.orxa?.model ?? orxaConfig?.model)
          : name === "plan"
            ? (orxaConfig?.plan?.model ?? orxaConfig?.small_model)
            : undefined;
      output.push({
        name: parsed.metadata.name || name,
        mode: inferredMode,
        description: parsed.metadata.description || undefined,
        model: modelFromConfig ?? parsed.metadata.model ?? undefined,
        prompt: parsed.body || undefined,
        path: item.path,
        source: item.source,
      });
    }

    return output.sort((a, b) => {
      const rankA = a.mode === "primary" ? 0 : 1;
      const rankB = b.mode === "primary" ? 0 : 1;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async getOrxaAgentDetails(nameInput: string): Promise<OrxaAgentDetails> {
    const name = nameInput.trim();
    const models = await this.loadOrxaConfigModels();
    const basePath = this.resolveAgentPath("base", name);
    const overridePath = this.resolveAgentPath("override", name);

    const base = basePath ? await this.loadAgentDocument(basePath, "base", name, models).catch(() => undefined) : undefined;
    const override = overridePath ? await this.loadAgentDocument(overridePath, "override", name, models).catch(() => undefined) : undefined;

    const currentList = await this.listOrxaAgents();
    const current = currentList.find((item) => item.name === name);
    const history = await this.listOrxaAgentHistory(name);

    return {
      current,
      base,
      override,
      history,
    };
  }

  async resetOrxaAgent(nameInput: string): Promise<OrxaAgentDocument | undefined> {
    const name = nameInput.trim();
    if (!name) {
      throw new Error("Agent name is required");
    }
    const overridePath = this.resolveAgentPath("override", name);
    if (overridePath) {
      await rm(overridePath, { force: true });
    }

    const basePath = this.resolveAgentPath("base", name);
    if ((name === "orxa" || name === "plan") && basePath) {
      const baseDoc = await this.loadAgentDocument(basePath, "base", name, await this.loadOrxaConfigModels());
      if (baseDoc.model) {
        const current = await this.readOrxaConfig();
        const parsed = parseJsonc(current.content) as Record<string, unknown>;
        const safe = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        const scoped = (safe[name] as Record<string, unknown> | undefined) ?? {};
        scoped.model = baseDoc.model;
        safe[name] = scoped;
        await this.writeOrxaConfig(`${JSON.stringify(safe, null, 2)}\n`);
      }
    }

    const list = await this.listOrxaAgents();
    return list.find((item) => item.name === name);
  }

  async restoreOrxaAgentHistory(nameInput: string, historyID: string): Promise<OrxaAgentDocument | undefined> {
    const name = nameInput.trim();
    const historyPath = path.join(this.orxaAgentHistoryDir(name), `${historyID}.yaml`);
    const raw = await readFile(historyPath, "utf8").catch(() => undefined);
    if (!raw) {
      throw new Error("History snapshot not found");
    }

    const overrideRoot = path.join(this.orxaRootDir(), "agents", "overrides");
    await mkdir(overrideRoot, { recursive: true });
    const overridePath = path.join(overrideRoot, `${name}.yaml`);
    const current = await readFile(overridePath, "utf8").catch(() => undefined);
    if (current) {
      await this.captureAgentHistory(name, current);
    }
    await writeFile(overridePath, raw, "utf8");

    if (name === "orxa" || name === "plan") {
      const parsed = parseSimpleYamlFrontmatter(raw);
      if (parsed.metadata.model) {
        const config = await this.readOrxaConfig();
        const safe = (parseJsonc(config.content) as Record<string, unknown>) ?? {};
        const scope = (safe[name] as Record<string, unknown> | undefined) ?? {};
        scope.model = parsed.metadata.model;
        safe[name] = scope;
        await this.writeOrxaConfig(`${JSON.stringify(safe, null, 2)}\n`);
      }
    }

    const list = await this.listOrxaAgents();
    return list.find((item) => item.name === name);
  }

  async saveOrxaAgent(input: {
    name: string;
    mode: "primary" | "subagent" | "all";
    description?: string;
    model?: string;
    prompt?: string;
  }): Promise<OrxaAgentDocument> {
    const name = input.name.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new Error("Invalid agent name");
    }

    const overridesRoot = path.join(this.orxaRootDir(), "agents", "overrides");
    await mkdir(overridesRoot, { recursive: true });
    const targetPath = path.join(overridesRoot, `${name}.yaml`);
    const previous = await readFile(targetPath, "utf8").catch(() => undefined);
    if (previous) {
      await this.captureAgentHistory(name, previous);
    }

    const lines = [
      "---",
      `name: ${toYamlScalar(name)}`,
      `description: ${toYamlScalar((input.description ?? "").trim())}`,
      `mode: ${toYamlScalar(input.mode)}`,
    ];
    if (input.model && input.model.trim().length > 0) {
      lines.push(`model: ${toYamlScalar(input.model.trim())}`);
    }
    lines.push("---", "", (input.prompt ?? "").trim(), "");
    await writeFile(targetPath, `${lines.join("\n")}`, "utf8");

    if ((name === "orxa" || name === "plan") && input.model) {
      const doc = await this.readOrxaConfig();
      const errors: Parameters<typeof parseJsonc>[1] = [];
      const parsed = parseJsonc(doc.content, errors, { allowTrailingComma: true }) as Record<string, unknown>;
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Invalid orxa.json: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
      }
      const safe = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      const scoped = (safe[name] as Record<string, unknown> | undefined) ?? {};
      scoped.model = input.model.trim();
      safe[name] = scoped;
      await this.writeOrxaConfig(`${JSON.stringify(safe, null, 2)}\n`);
    }

    const all = await this.listOrxaAgents();
    return all.find((item) => item.name === name) ?? {
      name,
      mode: input.mode,
      description: input.description,
      model: input.model,
      prompt: input.prompt,
      path: targetPath,
      source: "override",
    };
  }

  async writeOrxaConfig(content: string): Promise<RawConfigDocument> {
    const parseErrors: Parameters<typeof parseJsonc>[1] = [];
    parseJsonc(content, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length > 0) {
      const first = parseErrors[0];
      throw new Error(`Invalid JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
    }

    const configPath = this.orxaConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, content, "utf8");

    return {
      scope: "global",
      path: configPath,
      content,
    };
  }

  async selectProject(directory: string) {
    await this.addProjectDirectory(directory).catch(() => undefined);
    this.startProjectStream(directory);
    return this.refreshProject(directory);
  }

  async refreshProject(directory: string): Promise<ProjectBootstrap> {
    const client = this.client(directory);

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
      this.unwrap(client.path.get({ directory })).catch(() => ({
        home: homedir(),
        state: path.join(homedir(), ".local", "share", "opencode"),
        config: path.join(homedir(), ".config", "opencode"),
        worktree: directory,
        directory,
      })),
      this.unwrap(client.session.list({ directory, roots: true, limit: 120 })).catch(() => []),
      this.unwrap(client.session.status({ directory })).catch(() => ({})),
      this.unwrap(client.provider.list({ directory })).catch(() => ({ all: [], connected: [], default: {} })),
      this.unwrap(client.app.agents({ directory })).catch(() => []),
      this.unwrap(client.config.get({ directory })).catch(() => ({})),
      this.unwrap(client.permission.list({ directory })).catch(() => []),
      this.unwrap(client.question.list({ directory })).catch(() => []),
      this.unwrap(client.command.list({ directory })).catch(() => []),
      this.unwrap(client.mcp.status({ directory })).catch(() => ({})),
      this.unwrap(client.lsp.status({ directory })).catch(() => []),
      this.unwrap(client.formatter.status({ directory })).catch(() => []),
      this.unwrap(client.vcs.get({ directory })).catch(() => undefined),
      this.unwrap(client.pty.list({ directory })).catch(() => []),
    ]);

    return {
      directory,
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

  async createSession(directory: string, title?: string) {
    const response = await this.client(directory).session.create({ directory, title });
    return this.unwrap(response);
  }

  async deleteSession(directory: string, sessionID: string) {
    await this.client(directory).session.delete({ directory, sessionID });
    return true;
  }

  async abortSession(directory: string, sessionID: string) {
    await this.client(directory).session.abort({ directory, sessionID });
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

  async sendPrompt(input: PromptRequest) {
    const parts: Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "file";
          mime: string;
          url: string;
          filename?: string;
        }
    > = [
      {
        type: "text",
        text: input.text,
      },
    ];

    for (const attachment of input.attachments ?? []) {
      if (!attachment.url || !attachment.mime) {
        continue;
      }
      parts.push({
        type: "file",
        mime: attachment.mime,
        url: attachment.url,
        filename: attachment.filename,
      });
    }

    await this.client(input.directory).session.prompt({
      directory: input.directory,
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      parts,
    });
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
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      return "Not a git repository.";
    }
    const unstaged = await this.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "diff", "--", "."], cwd).catch(
      (error) => `Failed to load unstaged diff: ${sanitizeError(error)}`,
    );
    const staged = await this.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "diff", "--staged", "--", "."], cwd).catch(
      (error) => `Failed to load staged diff: ${sanitizeError(error)}`,
    );

    const sections: string[] = [];
    if (unstaged.trim().length > 0) {
      sections.push("## Unstaged\n", unstaged.trimEnd());
    }
    if (staged.trim().length > 0) {
      sections.push("## Staged\n", staged.trimEnd());
    }
    if (sections.length === 0) {
      return "No local changes.";
    }
    return sections.join("\n\n");
  }

  async gitLog(directory: string) {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      return "Not a git repository.";
    }
    const output = await this.runCommandWithOutput("git", ["-C", repoRoot, "--no-pager", "log", "--oneline", "--decorate", "-n", "40"], cwd)
      .catch((error) => `Unable to load git log: ${sanitizeError(error)}`);
    return output.trim().length > 0 ? output.trimEnd() : "No commit history found.";
  }

  async gitIssues(directory: string) {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      return "Not a git repository.";
    }
    const output = await this.runCommandWithOutput("gh", ["issue", "list", "--limit", "30"], repoRoot).catch((error) => {
      const message = sanitizeError(error);
      if (message.toLowerCase().includes("enoent") || message.includes("gh ")) {
        return "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
      }
      return `Unable to load issues: ${message}`;
    });
    return output.trim().length > 0 ? output.trimEnd() : "No open issues.";
  }

  async gitPrs(directory: string) {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      return "Not a git repository.";
    }
    const output = await this.runCommandWithOutput("gh", ["pr", "list", "--limit", "30"], repoRoot).catch((error) => {
      const message = sanitizeError(error);
      if (message.toLowerCase().includes("enoent") || message.includes("gh ")) {
        return "GitHub CLI is not available. Install `gh` and run `gh auth login`.";
      }
      return `Unable to load pull requests: ${message}`;
    });
    return output.trim().length > 0 ? output.trimEnd() : "No open pull requests.";
  }

  async openDirectoryIn(directory: string, target: OpenDirectoryTarget): Promise<OpenDirectoryResult> {
    const cwd = path.resolve(directory);
    const info = await stat(cwd).catch(() => undefined);
    if (!info?.isDirectory()) {
      throw new Error("Directory not found");
    }

    const platform = process.platform;
    const attempts: Array<{ command: string; args: string[]; label: string }> = [];

    if (platform === "darwin") {
      if (target === "finder") {
        attempts.push({ command: "open", args: [cwd], label: "Finder" });
      }
      if (target === "cursor") {
        attempts.push({ command: "open", args: ["-a", "Cursor", cwd], label: "Cursor" });
        attempts.push({ command: "cursor", args: [cwd], label: "Cursor CLI" });
      }
      if (target === "antigravity") {
        attempts.push({ command: "open", args: ["-a", "Antigravity", cwd], label: "Antigravity" });
      }
      if (target === "terminal") {
        attempts.push({ command: "open", args: ["-a", "Terminal", cwd], label: "Terminal" });
      }
      if (target === "ghostty") {
        attempts.push({ command: "open", args: ["-a", "Ghostty", cwd], label: "Ghostty" });
      }
      if (target === "xcode") {
        attempts.push({ command: "open", args: ["-a", "Xcode", cwd], label: "Xcode" });
      }
      if (target === "zed") {
        attempts.push({ command: "open", args: ["-a", "Zed", cwd], label: "Zed" });
        attempts.push({ command: "zed", args: [cwd], label: "Zed CLI" });
      }
    } else {
      if (target === "finder") {
        attempts.push({ command: "xdg-open", args: [cwd], label: "File manager" });
      }
      if (target === "cursor") {
        attempts.push({ command: "cursor", args: [cwd], label: "Cursor" });
      }
      if (target === "antigravity") {
        attempts.push({ command: "antigravity", args: [cwd], label: "Antigravity" });
      }
      if (target === "terminal") {
        attempts.push({ command: "ghostty", args: ["--working-directory", cwd], label: "Ghostty" });
        attempts.push({ command: "x-terminal-emulator", args: ["--working-directory", cwd], label: "Terminal" });
      }
      if (target === "ghostty") {
        attempts.push({ command: "ghostty", args: ["--working-directory", cwd], label: "Ghostty" });
      }
      if (target === "xcode") {
        attempts.push({ command: "xdg-open", args: [cwd], label: "Editor" });
      }
      if (target === "zed") {
        attempts.push({ command: "zed", args: [cwd], label: "Zed" });
      }
    }

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
    const agentsDir = path.join(homedir(), ".config", "opencode", "agents");
    const dirInfo = await stat(agentsDir).catch(() => undefined);
    if (!dirInfo?.isDirectory()) {
      return [];
    }

    const entries = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
    const output: OpenCodeAgentFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const filePath = path.join(agentsDir, entry.name);
      const raw = await readFile(filePath, "utf8").catch(() => "");
      if (!raw) {
        continue;
      }
      output.push(this.parseOpenCodeAgentFile(entry.name, filePath, raw));
    }

    return output;
  }

  async readOpenCodeAgentFile(filename: string): Promise<OpenCodeAgentFile> {
    const agentsDir = path.join(homedir(), ".config", "opencode", "agents");
    const filePath = path.join(agentsDir, filename);
    const rel = path.relative(agentsDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid filename");
    }
    const raw = await readFile(filePath, "utf8");
    return this.parseOpenCodeAgentFile(filename, filePath, raw);
  }

  async writeOpenCodeAgentFile(filename: string, content: string): Promise<OpenCodeAgentFile> {
    const agentsDir = path.join(homedir(), ".config", "opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    const filePath = path.join(agentsDir, filename);
    const rel = path.relative(agentsDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid filename");
    }
    await writeFile(filePath, content, "utf8");
    return this.parseOpenCodeAgentFile(filename, filePath, content);
  }

  async deleteOpenCodeAgentFile(filename: string): Promise<boolean> {
    const agentsDir = path.join(homedir(), ".config", "opencode", "agents");
    const filePath = path.join(agentsDir, filename);
    const rel = path.relative(agentsDir, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid filename");
    }
    await rm(filePath, { force: true });
    return true;
  }

  async openFileIn(filePath: string, target: OpenDirectoryTarget): Promise<OpenDirectoryResult> {
    const resolved = path.resolve(filePath);
    const info = await stat(resolved).catch(() => undefined);
    if (!info) {
      throw new Error("File not found");
    }

    const platform = process.platform;
    const attempts: Array<{ command: string; args: string[]; label: string }> = [];

    if (platform === "darwin") {
      if (target === "finder") {
        attempts.push({ command: "open", args: ["-R", resolved], label: "Finder" });
      }
      if (target === "cursor") {
        attempts.push({ command: "open", args: ["-a", "Cursor", resolved], label: "Cursor" });
        attempts.push({ command: "cursor", args: [resolved], label: "Cursor CLI" });
      }
      if (target === "antigravity") {
        attempts.push({ command: "open", args: ["-a", "Antigravity", resolved], label: "Antigravity" });
      }
      if (target === "terminal") {
        attempts.push({ command: "open", args: ["-a", "Terminal", resolved], label: "Terminal" });
      }
      if (target === "ghostty") {
        attempts.push({ command: "open", args: ["-a", "Ghostty", resolved], label: "Ghostty" });
      }
      if (target === "xcode") {
        attempts.push({ command: "open", args: ["-a", "Xcode", resolved], label: "Xcode" });
      }
      if (target === "zed") {
        attempts.push({ command: "open", args: ["-a", "Zed", resolved], label: "Zed" });
        attempts.push({ command: "zed", args: [resolved], label: "Zed CLI" });
      }
    } else {
      if (target === "finder") {
        attempts.push({ command: "xdg-open", args: [resolved], label: "File manager" });
      }
      if (target === "cursor") {
        attempts.push({ command: "cursor", args: [resolved], label: "Cursor" });
      }
      if (target === "antigravity") {
        attempts.push({ command: "antigravity", args: [resolved], label: "Antigravity" });
      }
      if (target === "terminal") {
        attempts.push({ command: "ghostty", args: [resolved], label: "Ghostty" });
        attempts.push({ command: "x-terminal-emulator", args: [resolved], label: "Terminal" });
      }
      if (target === "ghostty") {
        attempts.push({ command: "ghostty", args: [resolved], label: "Ghostty" });
      }
      if (target === "xcode") {
        attempts.push({ command: "xdg-open", args: [resolved], label: "Editor" });
      }
      if (target === "zed") {
        attempts.push({ command: "zed", args: [resolved], label: "Zed" });
      }
    }

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
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    const branch = await this.currentBranch(repoRoot);
    const stats = await this.collectGitStats(repoRoot, includeUnstaged);
    return {
      repoRoot,
      branch,
      filesChanged: stats.filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
    };
  }

  async gitGenerateCommitMessage(directory: string, includeUnstaged: boolean, guidancePrompt: string): Promise<string> {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    const branch = await this.currentBranch(repoRoot);
    const stats = await this.collectGitStats(repoRoot, includeUnstaged);
    const status = await this.runCommandWithOutput("git", ["-C", repoRoot, "status", "--short"], repoRoot).catch(() => "");
    const diffArgs = includeUnstaged
      ? ["-C", repoRoot, "--no-pager", "diff", "--compact-summary", "HEAD", "--", "."]
      : ["-C", repoRoot, "--no-pager", "diff", "--compact-summary", "--cached", "--", "."];
    const diff = await this.runCommandWithOutput("git", diffArgs, repoRoot).catch(() => "");
    const payload = [
      "Generate a commit message for this repository update.",
      "",
      "Guidance:",
      guidancePrompt.trim().length > 0 ? guidancePrompt.trim() : DEFAULT_COMMIT_GUIDANCE,
      "",
      `Branch: ${branch}`,
      `Files changed: ${stats.filesChanged}`,
      `Insertions: ${stats.insertions}`,
      `Deletions: ${stats.deletions}`,
      "",
      "git status --short:",
      status.trim().length > 0 ? status.slice(0, 3000) : "(no output)",
      "",
      "git diff summary:",
      diff.trim().length > 0 ? diff.slice(0, 14_000) : "(no output)",
      "",
      "Return only the commit message text, with no markdown fences.",
    ].join("\n");

    const generated = await this.generateCommitMessageWithAgent(directory, payload).catch(() => undefined);
    if (generated && generated.trim().length > 0) {
      return generated.trim();
    }

    return this.fallbackCommitMessage(stats);
  }

  async gitCommit(directory: string, request: GitCommitRequest): Promise<GitCommitResult> {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }

    const branch = await this.currentBranch(repoRoot);
    if (request.includeUnstaged) {
      await this.runCommand("git", ["-C", repoRoot, "add", "-A"], repoRoot);
    }

    const staged = await this.runCommandWithOutput("git", ["-C", repoRoot, "diff", "--cached", "--name-only"], repoRoot).catch(() => "");
    if (staged.trim().length === 0) {
      throw new Error(request.includeUnstaged ? "No changes to commit." : "No staged changes to commit.");
    }

    const guidancePrompt =
      request.guidancePrompt && request.guidancePrompt.trim().length > 0
        ? request.guidancePrompt.trim()
        : DEFAULT_COMMIT_GUIDANCE;
    const message =
      request.message && request.message.trim().length > 0
        ? request.message.trim()
        : await this.gitGenerateCommitMessage(directory, request.includeUnstaged, guidancePrompt);

    if (!message || message.trim().length === 0) {
      throw new Error("Commit message cannot be empty.");
    }

    const commitArgs = ["-C", repoRoot, "commit", ...this.toCommitMessageArgs(message.trim())];
    await this.runCommand("git", commitArgs, repoRoot);
    const commitHash = (await this.runCommandWithOutput("git", ["-C", repoRoot, "rev-parse", "HEAD"], repoRoot)).trim();

    let pushed = false;
    let prUrl: string | undefined;

    if (request.nextStep === "commit_and_push" || request.nextStep === "commit_and_create_pr") {
      await this.pushBranch(repoRoot, branch);
      pushed = true;
    }

    if (request.nextStep === "commit_and_create_pr") {
      const output = await this.runCommandWithOutput("gh", ["pr", "create", "--fill"], repoRoot).catch((error) => {
        const detail = sanitizeError(error);
        if (detail.toLowerCase().includes("enoent") || detail.includes("gh ")) {
          throw new Error("GitHub CLI is not available. Install `gh` and run `gh auth login`.");
        }
        throw new Error(`Unable to create PR: ${detail}`);
      });
      const urlMatch = output.match(/https?:\/\/[^\s]+/i);
      prUrl = urlMatch ? urlMatch[0] : undefined;
    }

    return {
      repoRoot,
      branch,
      commitHash,
      message: message.trim(),
      pushed,
      prUrl,
    };
  }

  async gitBranches(directory: string): Promise<GitBranchState> {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }

    const current = await this.currentBranch(repoRoot);
    const localOutput = await this.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
      repoRoot,
    ).catch(() => "");
    const remoteOutput = await this.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
      repoRoot,
    ).catch(() => "");
    const localBranches = localOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .sort((left, right) => left.localeCompare(right));
    const remoteBranches = remoteOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.endsWith("/HEAD"))
      .map((line) => line.replace(/^origin\//, ""));
    const branches = [...new Set([...localBranches, ...remoteBranches])].sort((left, right) => left.localeCompare(right));
    if (!branches.includes(current)) {
      branches.unshift(current);
    }

    return {
      repoRoot,
      current,
      branches,
    };
  }

  async gitCheckoutBranch(directory: string, branch: string): Promise<GitBranchState> {
    const nextBranch = branch.trim();
    if (!nextBranch) {
      throw new Error("Branch name is required.");
    }

    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }

    await this.runCommand("git", ["-C", repoRoot, "check-ref-format", "--branch", nextBranch], repoRoot).catch(() => {
      throw new Error("Invalid branch name.");
    });

    const existing = await this.runCommandWithOutput(
      "git",
      ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/heads", nextBranch],
      repoRoot,
    ).catch(() => "");
    if (existing.trim() === nextBranch) {
      await this.runCommand("git", ["-C", repoRoot, "checkout", nextBranch], repoRoot);
    } else {
      const hasRemote = await this.runCommandWithOutput(
        "git",
        ["-C", repoRoot, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin", `origin/${nextBranch}`],
        repoRoot,
      ).catch(() => "");
      if (hasRemote.trim() === `origin/${nextBranch}`) {
        await this.runCommand("git", ["-C", repoRoot, "checkout", "-b", nextBranch, "--track", `origin/${nextBranch}`], repoRoot);
      } else {
        await this.runCommand("git", ["-C", repoRoot, "checkout", "-b", nextBranch], repoRoot);
      }
    }

    return this.gitBranches(repoRoot);
  }

  async gitStageAll(directory: string): Promise<boolean> {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    await this.runCommand("git", ["-C", repoRoot, "add", "-A", "--", "."], repoRoot);
    return true;
  }

  async gitRestoreAllUnstaged(directory: string): Promise<boolean> {
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    await this.runCommand("git", ["-C", repoRoot, "restore", "--worktree", "--", "."], repoRoot);
    return true;
  }

  async gitStagePath(directory: string, filePath: string): Promise<boolean> {
    const targetPath = filePath.trim();
    if (!targetPath) {
      throw new Error("File path is required.");
    }
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    await this.runCommand("git", ["-C", repoRoot, "add", "--", targetPath], repoRoot);
    return true;
  }

  async gitRestorePath(directory: string, filePath: string): Promise<boolean> {
    const targetPath = filePath.trim();
    if (!targetPath) {
      throw new Error("File path is required.");
    }
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    await this.runCommand("git", ["-C", repoRoot, "restore", "--worktree", "--", targetPath], repoRoot);
    return true;
  }

  async gitUnstagePath(directory: string, filePath: string): Promise<boolean> {
    const targetPath = filePath.trim();
    if (!targetPath) {
      throw new Error("File path is required.");
    }
    const cwd = path.resolve(directory);
    const repoRoot = await this.resolveGitRepoRoot(cwd);
    if (!repoRoot) {
      throw new Error("Not a git repository.");
    }
    await this.runCommand("git", ["-C", repoRoot, "restore", "--staged", "--", targetPath], repoRoot);
    return true;
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
      const lines = file.split(/\r?\n/).map((line) => line.trim());
      const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || entry.name;
      const description =
        lines.find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("```")) || "No description available.";
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
    const root = path.resolve(directory);
    const agentsPath = path.join(root, "AGENTS.md");
    const info = await stat(agentsPath).catch(() => undefined);
    if (!info?.isFile()) {
      return {
        path: agentsPath,
        content: "",
        exists: false,
      };
    }

    const content = await readFile(agentsPath, "utf8").catch(() => "");
    return {
      path: agentsPath,
      content,
      exists: true,
    };
  }

  async writeAgentsMd(directory: string, content: string): Promise<AgentsDocument> {
    const root = path.resolve(directory);
    const agentsPath = path.join(root, "AGENTS.md");
    const normalized = content.endsWith("\n") ? content : `${content}\n`;
    await mkdir(path.dirname(agentsPath), { recursive: true });
    await writeFile(agentsPath, normalized, "utf8");
    return {
      path: agentsPath,
      content: normalized,
      exists: true,
    };
  }

  async listFiles(directory: string, relativePath = ""): Promise<ProjectFileEntry[]> {
    const root = path.resolve(directory);
    const resolved = this.resolveWithinRoot(root, relativePath);
    const info = await stat(resolved).catch(() => undefined);
    if (!info?.isDirectory()) {
      throw new Error("Directory not found");
    }

    const entries = await readdir(resolved, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => !entry.name.startsWith(".DS_Store"))
      .filter((entry) => !(entry.isDirectory() && PROJECT_FILE_SKIP_DIRS.has(entry.name)))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) {
          return -1;
        }
        if (!a.isDirectory() && b.isDirectory()) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const absolutePath = path.join(resolved, entry.name);
        const rel = path.relative(root, absolutePath);
        return {
          name: entry.name,
          path: absolutePath,
          relativePath: rel,
          type: entry.isDirectory() ? "directory" : "file",
          hasChildren: entry.isDirectory() ? true : undefined,
        };
      });
  }

  async countProjectFiles(directory: string): Promise<number> {
    const root = path.resolve(directory);
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) {
      throw new Error("Directory not found");
    }

    const countDirectory = async (directoryPath: string): Promise<number> => {
      const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
      let total = 0;
      for (const entry of entries) {
        if (entry.name.startsWith(".DS_Store")) {
          continue;
        }
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          if (PROJECT_FILE_SKIP_DIRS.has(entry.name)) {
            continue;
          }
          total += await countDirectory(absolutePath);
          continue;
        }
        total += 1;
      }
      return total;
    };

    return countDirectory(root);
  }

  async readProjectFile(directory: string, relativePath: string): Promise<ProjectFileDocument> {
    const root = path.resolve(directory);
    const filePath = this.resolveWithinRoot(root, relativePath);
    const info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile()) {
      throw new Error("File not found");
    }

    const maxBytes = 220_000;
    const raw = await readFile(filePath);
    const binary = raw.includes(0);
    const truncated = raw.byteLength > maxBytes;
    const content = binary
      ? "[Binary file preview unavailable]"
      : raw.subarray(0, maxBytes).toString("utf8");

    return {
      path: filePath,
      relativePath: path.relative(root, filePath),
      content,
      binary,
      truncated,
    };
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
      return this.unwrap(response, fallback);
    } catch {
      return fallback;
    }
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
      const properties = (event as { properties?: { error?: { message?: string } } }).properties;
      return {
        type: String(event.type),
        properties: {
          error: {
            message: properties?.error?.message,
          },
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

    try {
      return await this.attach(activeID);
    } catch (error) {
      if (activeProfile.startCommand) {
        try {
          return await this.startLocal(activeID);
        } catch (startError) {
          const message = `Failed to connect or start local OpenCode: ${sanitizeError(startError)}`;
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
    return this.projectStore.list().map((worktree) => ({
      id: `local:${worktree}`,
      name: path.basename(worktree),
      worktree: path.resolve(worktree),
      source: "local",
    }));
  }

  private orxaRootDir() {
    return path.join(homedir(), ".config", "opencode", "orxa");
  }

  private orxaConfigPath() {
    return path.join(this.orxaRootDir(), "orxa.json");
  }

  private async ensureOrxaPluginInstalled(configDir: string) {
    const installedPath = path.join(configDir, "node_modules", "@reliabilityworks", "opencode-orxa");
    const existing = await stat(installedPath).catch(() => undefined);
    if (existing?.isDirectory()) {
      return;
    }

    const packageJsonPath = path.join(configDir, "package.json");
    const packageJsonExists = existsSync(packageJsonPath);
    if (!packageJsonExists) {
      await writeFile(packageJsonPath, "{\n  \"private\": true\n}\n", "utf8");
    }

    const packageSpec = ORXA_PLUGIN_SPECIFIER;
    const installAttempts: Array<{ command: string; args: string[] }> = [
      { command: "bun", args: ["add", packageSpec, "--exact"] },
      { command: "pnpm", args: ["add", packageSpec, "--save-exact"] },
      { command: "npm", args: ["install", packageSpec, "--save-exact"] },
    ];

    let lastError: Error | undefined;
    for (const attempt of installAttempts) {
      try {
        await this.runCommand(attempt.command, attempt.args, configDir);
        const installed = await stat(installedPath).catch(() => undefined);
        if (installed?.isDirectory()) {
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw new Error(`Failed to install ${packageSpec}: ${lastError?.message ?? "unknown error"}`);
  }

  private async runCommand(command: string, args: string[], cwd: string) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr?.on("data", (chunk) => {
        stderr.push(String(chunk));
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const tail = [...stdout, ...stderr].join("").trim().slice(-2000);
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${tail ? `: ${tail}` : ""}`));
      });
    });
  }

  private async runCommandWithOutput(command: string, args: string[], cwd: string) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (chunk) => {
        stdout.push(String(chunk));
      });
      child.stderr?.on("data", (chunk) => {
        stderr.push(String(chunk));
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.join(""));
          return;
        }
        const details = `${stdout.join("")}\n${stderr.join("")}`.trim().slice(-2000);
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${details ? `: ${details}` : ""}`));
      });
    });
  }

  private async runCommandAttempts(attempts: Array<{ command: string; args: string[]; label: string }>, cwd: string) {
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await this.runCommand(attempt.command, attempt.args, cwd);
        return `Opened in ${attempt.label}`;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(sanitizeError(lastError ?? "Unable to open directory"));
  }

  private async collectGitStats(repoRoot: string, includeUnstaged: boolean) {
    const namesArgs = includeUnstaged
      ? ["-C", repoRoot, "status", "--porcelain"]
      : ["-C", repoRoot, "diff", "--cached", "--name-only"];
    const statsArgs = includeUnstaged
      ? ["-C", repoRoot, "diff", "--numstat", "HEAD", "--", "."]
      : ["-C", repoRoot, "diff", "--cached", "--numstat", "--", "."];

    const names = await this.runCommandWithOutput("git", namesArgs, repoRoot).catch(() => "");
    const numstat = await this.runCommandWithOutput("git", statsArgs, repoRoot).catch(() => "");
    const parsed = this.sumNumstat(numstat);

    const filesChanged = includeUnstaged
      ? names
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0).length
      : names
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0).length;

    return {
      filesChanged,
      insertions: parsed.insertions,
      deletions: parsed.deletions,
    };
  }

  private sumNumstat(output: string) {
    let insertions = 0;
    let deletions = 0;
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      const [addedRaw, removedRaw] = line.split(/\s+/);
      const added = Number.parseInt(addedRaw ?? "0", 10);
      const removed = Number.parseInt(removedRaw ?? "0", 10);
      if (!Number.isNaN(added)) {
        insertions += added;
      }
      if (!Number.isNaN(removed)) {
        deletions += removed;
      }
    }

    return { insertions, deletions };
  }

  private async currentBranch(repoRoot: string) {
    const branch = await this.runCommandWithOutput("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], repoRoot).catch(
      () => "HEAD",
    );
    return branch.trim() || "HEAD";
  }

  private fallbackCommitMessage(stats: { filesChanged: number; insertions: number; deletions: number }) {
    const files = Math.max(stats.filesChanged, 1);
    return [
      `chore: update ${files} file${files === 1 ? "" : "s"}`,
      "",
      `- apply local working tree updates across ${files} file${files === 1 ? "" : "s"}`,
      `- add ${stats.insertions} line${stats.insertions === 1 ? "" : "s"} and remove ${stats.deletions} line${stats.deletions === 1 ? "" : "s"}`,
    ].join("\n");
  }

  private toCommitMessageArgs(message: string) {
    const normalized = message.replace(/\r\n/g, "\n").trim();
    const blocks = normalized
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (blocks.length === 0) {
      return ["-m", normalized];
    }
    const args: string[] = [];
    for (const block of blocks) {
      args.push("-m", block);
    }
    return args;
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
        agent: "orxa",
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

  private resolveWithinRoot(root: string, relativePath: string) {
    const normalized = relativePath.trim();
    if (!normalized) {
      return root;
    }
    const candidate = path.resolve(root, normalized);
    const rel = path.relative(root, candidate);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid file path");
    }
    return candidate;
  }

  private async scanAgentFiles(root: string): Promise<string[]> {
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) {
      return [];
    }

    const output: string[] = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory() && entry.name === "subagents") {
        const nested = await readdir(entryPath, { withFileTypes: true });
        for (const child of nested) {
          if (!child.isFile()) {
            continue;
          }
          if (!/\.(yaml|yml)$/i.test(child.name)) {
            continue;
          }
          output.push(path.join(entryPath, child.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!/\.(yaml|yml)$/i.test(entry.name)) {
        continue;
      }
      output.push(entryPath);
    }
    return output;
  }

  private orxaAgentHistoryDir(name: string) {
    return path.join(this.orxaRootDir(), "agents", "history", name);
  }

  private resolveAgentPath(source: "base" | "override" | "custom", name: string) {
    const baseRoot = path.join(this.orxaRootDir(), "agents");
    const root =
      source === "override"
        ? path.join(baseRoot, "overrides")
        : source === "custom"
          ? path.join(baseRoot, "custom")
          : baseRoot;
    const candidates = [
      path.join(root, `${name}.yaml`),
      path.join(root, `${name}.yml`),
      path.join(root, "subagents", `${name}.yaml`),
      path.join(root, "subagents", `${name}.yml`),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  private async loadOrxaConfigModels() {
    const orxaDoc = await this.readOrxaConfig().catch(() => undefined);
    const parsed = orxaDoc
      ? (parseJsonc(orxaDoc.content) as {
          model?: string;
          small_model?: string;
          orxa?: { model?: string };
          plan?: { model?: string };
        })
      : undefined;
    return {
      orxa: parsed?.orxa?.model ?? parsed?.model,
      plan: parsed?.plan?.model ?? parsed?.small_model,
    };
  }

  private async loadAgentDocument(
    filePath: string,
    source: OrxaAgentDocument["source"],
    fallbackName: string,
    modelOverrides?: { orxa?: string; plan?: string },
  ): Promise<OrxaAgentDocument> {
    const raw = await readFile(filePath, "utf8");
    const parsed = parseSimpleYamlFrontmatter(raw);
    const name = parsed.metadata.name || fallbackName;
    const inferredMode: OrxaAgentDocument["mode"] =
      parsed.metadata.mode === "primary" || parsed.metadata.mode === "subagent" || parsed.metadata.mode === "all"
        ? parsed.metadata.mode
        : (name === "orxa" || name === "plan" ? "primary" : filePath.includes(`${path.sep}subagents${path.sep}`) ? "subagent" : "subagent");
    const model = name === "orxa"
      ? modelOverrides?.orxa ?? parsed.metadata.model
      : name === "plan"
        ? modelOverrides?.plan ?? parsed.metadata.model
        : parsed.metadata.model;

    return {
      name,
      mode: inferredMode,
      description: parsed.metadata.description || undefined,
      model: model || undefined,
      prompt: parsed.body || undefined,
      path: filePath,
      source,
    };
  }

  private async listOrxaAgentHistory(name: string): Promise<OrxaAgentHistoryDocument[]> {
    const dir = this.orxaAgentHistoryDir(name);
    const exists = await stat(dir).then((item) => item.isDirectory()).catch(() => false);
    if (!exists) {
      return [];
    }

    const entries = await readdir(dir, { withFileTypes: true });
    const output: OrxaAgentHistoryDocument[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(yaml|yml)$/i.test(entry.name)) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const raw = await readFile(filePath, "utf8").catch(() => "");
      const parsed = parseSimpleYamlFrontmatter(raw);
      const info = await stat(filePath).catch(() => undefined);
      output.push({
        id: entry.name.replace(/\.(yaml|yml)$/i, ""),
        path: filePath,
        updatedAt: info?.mtimeMs ?? Date.now(),
        model: parsed.metadata.model || undefined,
        prompt: parsed.body || undefined,
      });
    }

    return output.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async captureAgentHistory(name: string, content: string) {
    const historyDir = this.orxaAgentHistoryDir(name);
    await mkdir(historyDir, { recursive: true });
    const id = `${Date.now()}`;
    const snapshotPath = path.join(historyDir, `${id}.yaml`);
    await writeFile(snapshotPath, content, "utf8");
  }

  private orxaAgentPromptPath(agent: "orxa" | "plan") {
    return path.join(this.orxaRootDir(), "agents", `${agent}.yaml`);
  }

  private parseOpenCodeAgentFile(filename: string, filePath: string, raw: string): OpenCodeAgentFile {
    const parsed = parseSimpleYamlFrontmatter(raw);
    const name = filename.replace(/\.md$/i, "");
    const temperature = parsed.metadata.temperature ? Number.parseFloat(parsed.metadata.temperature) : undefined;
    return {
      name,
      filename,
      path: filePath,
      description: parsed.metadata.description ?? "",
      mode: parsed.metadata.mode ?? "",
      model: parsed.metadata.model ?? "",
      temperature: temperature !== undefined && !Number.isNaN(temperature) ? temperature : undefined,
      content: raw,
    };
  }

  private extractMarkdownBody(content: string) {
    const trimmed = content.trim();
    if (!trimmed.startsWith("---")) {
      return trimmed;
    }

    const end = trimmed.indexOf("---", 3);
    if (end < 0) {
      return trimmed;
    }

    return trimmed.slice(end + 3).trim();
  }

  private async copyDirectoryIfMissing(sourceDir: string, targetDir: string) {
    await mkdir(targetDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectoryIfMissing(sourcePath, targetPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const existing = await stat(targetPath).catch(() => undefined);
      if (existing?.isFile()) {
        continue;
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}
