import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";
import { readdirSync, accessSync, constants } from "node:fs";
import path from "node:path";
import type {
  CodexApprovalRequest,
  CodexAttachment,
  CodexCollaborationMode,
  CodexModelEntry,
  CodexNotification,
  CodexRunMetadata,
  CodexState,
  CodexThread,
  CodexThreadRuntime,
} from "@shared/ipc";
import {
  makeProviderRuntimeSessionKey,
  ProviderSessionDirectory,
} from "./provider-session-directory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodexTurnItem {
  type: string;
  id: string;
  content?: Array<{ type: string; text?: string }>;
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number;
  aggregatedOutput?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status: "inProgress" | "completed" | "interrupted" | "failed";
  items: CodexTurnItem[];
  error?: string | null;
  tokenUsage?: { input: number; output: number };
}

// ---------------------------------------------------------------------------
// Model list parser (handles both `data` and `models` response shapes)
// ---------------------------------------------------------------------------

function parseModelListResponse(response: unknown): CodexModelEntry[] {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;

  // The codex app-server returns { data: [...] }
  const items = (() => {
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.models)) return record.models;
    // Some versions nest under result.data
    const result = record.result as Record<string, unknown> | undefined;
    if (result && Array.isArray(result.data)) return result.data;
    return [];
  })();

  return items
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return null;
      const m = item as Record<string, unknown>;
      const id = String(m.id ?? m.model ?? "");
      const model = String(m.model ?? m.id ?? "");
      const rawName = String(m.displayName ?? m.display_name ?? "");
      const name = rawName.trim() || model;
      const isDefault = Boolean(m.isDefault ?? m.is_default ?? false);

      // Parse reasoning efforts
      const effortsRaw = (m.supportedReasoningEfforts ?? m.supported_reasoning_efforts) as unknown;
      const efforts: string[] = Array.isArray(effortsRaw)
        ? effortsRaw
            .map((e: unknown) => {
              if (typeof e === "string") return e;
              if (e && typeof e === "object") {
                const entry = e as Record<string, unknown>;
                return String(entry.reasoningEffort ?? entry.reasoning_effort ?? "");
              }
              return "";
            })
            .filter((e: string) => e.length > 0)
        : [];

      const defaultEffortRaw = m.defaultReasoningEffort ?? m.default_reasoning_effort;
      const defaultEffort = typeof defaultEffortRaw === "string" && defaultEffortRaw.trim() ? defaultEffortRaw.trim() : null;

      return { id, model, name, isDefault, supportedReasoningEfforts: efforts, defaultReasoningEffort: defaultEffort };
    })
    .filter((m): m is CodexModelEntry => m !== null && m.id.length > 0);
}

// ---------------------------------------------------------------------------
// Collaboration mode list parser
// ---------------------------------------------------------------------------

function parseModeListResponse(response: unknown): CodexCollaborationMode[] {
  if (!response || typeof response !== "object") return [];
  const record = response as Record<string, unknown>;

  const items = (() => {
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.modes)) return record.modes;
    const result = record.result as Record<string, unknown> | undefined;
    if (result && Array.isArray(result.data)) return result.data;
    if (result && Array.isArray(result.modes)) return result.modes;
    return [];
  })();

  return items
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return null;
      const m = item as Record<string, unknown>;
      const id = asString(m.id ?? m.mode ?? m.name).trim();
      return {
        id,
        label: asString(m.label ?? m.name ?? m.mode ?? id).trim(),
        mode: asString(m.mode).trim(),
        model: asString(m.model).trim(),
        reasoningEffort: asString(m.reasoningEffort ?? m.reasoning_effort).trim(),
        developerInstructions: asString(m.developerInstructions ?? m.developer_instructions).trim(),
      };
    })
    .filter((m): m is CodexCollaborationMode => m !== null && m.id.length > 0);
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Binary resolver
// ---------------------------------------------------------------------------

function resolveCodexBinary(): string | null {
  const home = process.env.HOME ?? "";
  const candidates = [
    // Direct PATH (works when Electron inherits it)
    "codex",
    // nvm installations
    ...(() => {
      try {
        const nvmDir = path.join(home, ".nvm", "versions", "node");
        const versions = readdirSync(nvmDir);
        return versions.map(v => path.join(nvmDir, v, "bin", "codex"));
      } catch { return []; }
    })(),
    // Homebrew
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    // Volta
    path.join(home, ".volta", "bin", "codex"),
    // pnpm global
    path.join(home, ".local", "share", "pnpm", "codex"),
    // npm global
    "/usr/local/lib/node_modules/.bin/codex",
  ];

  for (const candidate of candidates) {
    try {
      if (candidate === "codex") {
        execSync("which codex", { stdio: "ignore" });
        return "codex";
      }
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 60_000;
const RUN_METADATA_MAX_PROMPT_CHARS = 1200;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function cleanRunMetadataPrompt(prompt: string) {
  if (!prompt) {
    return "";
  }
  const withoutImages = prompt.replace(/\[image(?: x\d+)?\]/gi, " ");
  const withoutSkills = withoutImages.replace(/(^|\s)\$[A-Za-z0-9_-]+(?=\s|$)/g, " ");
  const normalized = withoutSkills.replace(/\s+/g, " ").trim();
  return normalized.length > RUN_METADATA_MAX_PROMPT_CHARS
    ? normalized.slice(0, RUN_METADATA_MAX_PROMPT_CHARS)
    : normalized;
}

function isIgnorableCodexStderr(text: string) {
  return /fail to delete session:.*404 Not Found.*https:\/\/mcp\.expo\.dev\/mcp/i.test(text);
}

export function buildRunMetadataPrompt(cleanedPrompt: string) {
  return [
    "You create concise run metadata for a coding task.",
    "Return ONLY a JSON object with keys:",
    "- title: short, clear, 3-7 words, Title Case",
    "- worktreeName: lower-case, kebab-case slug prefixed with one of: feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.",
    "",
    "Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup.",
    "Use the closest match for chores/tests/docs/refactors/perf/build/ci/style.",
    "Otherwise use feat/.",
    "",
    "Examples:",
    '{"title":"Fix Login Redirect Loop","worktreeName":"fix/login-redirect-loop"}',
    '{"title":"Add Workspace Home View","worktreeName":"feat/workspace-home"}',
    '{"title":"Update Lint Config","worktreeName":"chore/update-lint-config"}',
    '{"title":"Add Coverage Tests","worktreeName":"test/add-coverage-tests"}',
    "",
    "Task:",
    cleanedPrompt,
  ].join("\n");
}

function extractJsonValue(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
}

function sanitizeRunWorktreeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function parseRunMetadataValue(raw: string): CodexRunMetadata {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("No metadata was generated");
  }
  const jsonValue = extractJsonValue(trimmed);
  if (!jsonValue) {
    throw new Error("Failed to parse metadata JSON");
  }
  const title = asString(jsonValue.title).trim();
  const worktreeName = sanitizeRunWorktreeName(asString(jsonValue.worktreeName ?? jsonValue.worktree_name));
  if (!title) {
    throw new Error("Missing title in metadata");
  }
  if (!worktreeName) {
    throw new Error("Missing worktree name in metadata");
  }
  return { title, worktreeName };
}

function extractThreadIdFromResult(result: unknown): string | null {
  const record = asRecord(result);
  if (!record) {
    return null;
  }
  const resultRecord = asRecord(record.result);
  const threadRecord = asRecord(resultRecord?.thread ?? record.thread);
  return (
    asString(resultRecord?.threadId).trim() ||
    asString(threadRecord?.id).trim() ||
    asString(record.threadId).trim() ||
    null
  );
}

function getParentThreadIdFromSource(source: unknown): string | null {
  const sourceRecord = asRecord(source);
  if (!sourceRecord) {
    return null;
  }
  const subAgent = asRecord(sourceRecord.subAgent ?? sourceRecord.sub_agent ?? sourceRecord.subagent);
  if (!subAgent) {
    return null;
  }
  const threadSpawn = asRecord(subAgent.thread_spawn ?? subAgent.threadSpawn);
  if (!threadSpawn) {
    return null;
  }
  return asString(threadSpawn.parent_thread_id ?? threadSpawn.parentThreadId).trim() || null;
}

function getParentThreadIdFromThread(thread: Record<string, unknown>): string | null {
  return (
    getParentThreadIdFromSource(thread.source) ||
    asString(
      thread.parentThreadId ??
      thread.parent_thread_id ??
      thread.parentId ??
      thread.parent_id ??
      thread.senderThreadId ??
      thread.sender_thread_id,
    ).trim() ||
    null
  );
}

function normalizeTurnStatus(value: unknown) {
  return asString(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function getActiveTurnIdFromThread(thread: Record<string, unknown>): string | null {
  const explicit =
    asString(thread.activeTurnId ?? thread.active_turn_id).trim() ||
    asString(asRecord(thread.activeTurn ?? thread.active_turn ?? thread.currentTurn ?? thread.current_turn)?.id).trim();
  if (explicit) {
    return explicit;
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = asRecord(turns[index]);
    if (!turn) {
      continue;
    }
    const status = normalizeTurnStatus(turn.status ?? turn.turnStatus ?? turn.turn_status);
    if (
      status === "inprogress" ||
      status === "running" ||
      status === "processing" ||
      status === "pending" ||
      status === "started" ||
      status === "queued" ||
      status === "waiting" ||
      status === "blocked" ||
      status === "needsinput" ||
      status === "requiresaction" ||
      status === "awaitinginput" ||
      status === "waitingforinput"
    ) {
      return asString(turn.id ?? turn.turnId ?? turn.turn_id).trim() || null;
    }
  }
  return null;
}

function collectDescendantThreadIds(rootThreadId: string, threads: Record<string, unknown>[]) {
  const childrenByParent = new Map<string, string[]>();
  for (const thread of threads) {
    const childId = asString(thread.id).trim();
    const parentId = getParentThreadIdFromThread(thread);
    if (!childId || !parentId || childId === parentId) {
      continue;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(childId);
    childrenByParent.set(parentId, children);
  }

  const visited = new Set<string>([rootThreadId]);
  const descendants: string[] = [];
  const queue = [...(childrenByParent.get(rootThreadId) ?? [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);
    descendants.push(current);
    const children = childrenByParent.get(current) ?? [];
    children.forEach((child) => queue.push(child));
  }

  return descendants;
}

function isMissingCodexThreadArchiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /no rollout found for thread id/i.test(message) || /no thread found for thread id/i.test(message);
}

export class CodexService extends EventEmitter {
  private providerSessionDirectory: ProviderSessionDirectory | null;

  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private _state: CodexState = { status: "disconnected" };
  private _models: CodexModelEntry[] = [];
  private _collaborationModes: CodexCollaborationMode[] = [];
  private readonly hiddenThreadIds = new Set<string>();
  private readonly hiddenThreadListeners = new Map<string, Set<(notification: CodexNotification) => void>>();
  private readonly itemThreadIds = new Map<string, string>();
  private readonly turnThreadIds = new Map<string, string>();
  private readonly threadSettings = new Map<string, { model?: string; reasoningEffort?: string | null }>();
  private readonly hydratedThreadIds = new Set<string>();

  constructor(providerSessionDirectory: ProviderSessionDirectory | null = null) {
    super();
    this.providerSessionDirectory = providerSessionDirectory;
  }

  setProviderSessionDirectory(providerSessionDirectory: ProviderSessionDirectory | null) {
    this.providerSessionDirectory = providerSessionDirectory;
  }

  get state(): CodexState {
    return { ...this._state };
  }

  get models(): CodexModelEntry[] {
    return [...this._models];
  }

  get collaborationModes(): CodexCollaborationMode[] {
    return [...this._collaborationModes];
  }

  private findBindingForThread(threadId: string) {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      return null;
    }
    return (this.providerSessionDirectory?.list("codex") ?? []).find((binding) => {
      const cursor = asRecord(binding.resumeCursor);
      return asString(cursor?.threadId).trim() === normalizedThreadId;
    }) ?? null;
  }

  private seedBindingFromLegacyThread(threadId: string, cwd?: string) {
    const normalizedThreadId = threadId.trim();
    const normalizedCwd = cwd?.trim() || "";
    if (!normalizedThreadId || !normalizedCwd || !this.providerSessionDirectory) {
      return null;
    }
    const sessionKey = makeProviderRuntimeSessionKey("codex", normalizedCwd, normalizedThreadId);
    const raw = this.providerSessionDirectory.getLegacyRendererValue(`orxa:codexSession:v1:${sessionKey}`);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { thread?: { id?: unknown } | null };
      const legacyThreadId = typeof parsed.thread?.id === "string" ? parsed.thread.id.trim() : "";
      if (legacyThreadId !== normalizedThreadId) {
        return null;
      }
      return this.providerSessionDirectory.upsert({
        provider: "codex",
        sessionKey,
        status: "running",
        resumeCursor: { threadId: normalizedThreadId },
        runtimePayload: { directory: normalizedCwd },
      });
    } catch {
      return null;
    }
  }

  private upsertBindingForThread(
    threadId: string,
    input?: {
      cwd?: string;
      model?: string;
      reasoningEffort?: string | null;
      collaborationMode?: string;
      status?: "starting" | "running" | "stopped" | "error";
    },
  ) {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !this.providerSessionDirectory) {
      return null;
    }
    const existing = this.findBindingForThread(normalizedThreadId);
    const normalizedCwd =
      input?.cwd?.trim()
      || asString(asRecord(existing?.runtimePayload)?.directory).trim();
    const sessionKey = existing?.sessionKey
      ?? (normalizedCwd ? makeProviderRuntimeSessionKey("codex", normalizedCwd, normalizedThreadId) : "");
    if (!sessionKey) {
      return existing ?? null;
    }
    return this.providerSessionDirectory.upsert({
      provider: "codex",
      sessionKey,
      status: input?.status ?? "running",
      resumeCursor: { threadId: normalizedThreadId },
      runtimePayload: {
        ...(normalizedCwd ? { directory: normalizedCwd } : {}),
        ...(input?.model ? { model: input.model } : {}),
        ...(input?.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        ...(input?.collaborationMode ? { collaborationMode: input.collaborationMode } : {}),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(cwd?: string, options?: { codexPath?: string; codexArgs?: string }): Promise<CodexState> {
    if (this.process) {
      return this.state;
    }

    this._state = { status: "connecting" };
    this.emit("state", this._state);

    try {
      // Use configured binary path if provided, otherwise resolve from PATH
      const codexBin = (options?.codexPath?.trim()) || resolveCodexBinary();
      if (!codexBin) {
        const message = "codex binary not found in PATH. Install it with: npm install -g @openai/codex";
        console.error("[CodexService]", message);
        this._state = { status: "error", lastError: message };
        this.emit("state", this._state);
        return this.state;
      }

      const extraArgs = options?.codexArgs?.trim().split(/\s+/).filter(Boolean) ?? [];
      const args = ["app-server", ...extraArgs];
      console.info(`[CodexService] Spawning: ${codexBin} ${args.join(" ")}`);
      const child = spawn(codexBin, args, {
        cwd: cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.process = child;

      child.on("error", (err) => {
        console.error("[CodexService] Process error:", err.message);
        this._state = { status: "error", lastError: err.message };
        this.emit("state", this._state);
        this.cleanup();
      });

      child.on("exit", (code, signal) => {
        console.info("[CodexService] Process exited, code:", code, "signal:", signal);
        this._state = { status: "disconnected" };
        this.emit("state", this._state);
        this.cleanup();
      });

      // stderr → debug logging
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (isIgnorableCodexStderr(text)) {
          console.info("[CodexService] ignored stderr:", text.trim());
          return;
        }
        console.error("[CodexService] stderr:", text);
        this.emit("stderr", text);
      });

      // stdout → JSONL messages
      const rl = createInterface({ input: child.stdout!, terminal: false });
      this.readline = rl;
      rl.on("line", (line) => this.handleLine(line));

      // Initialize handshake
      const result = (await this.request("initialize", {
        clientInfo: { name: "orxa_code", title: "Orxa Code", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      })) as {
        server_info?: { name: string; version: string };
        serverInfo?: { name: string; version: string };
        userAgent?: { name: string; version: string };
      };

      // Send initialized notification (no id — fire-and-forget)
      this.sendNotification("initialized", {});

      // Fetch available models (non-blocking — don't fail start if this errors)
      try {
        const modelResult = await this.request("model/list", {});
        this._models = parseModelListResponse(modelResult);
      } catch (err) {
        console.warn("[CodexService] model/list failed (non-fatal):", err);
      }

      // Fetch collaboration modes (non-blocking)
      try {
        const modeResult = await this.request("collaborationMode/list", {});
        this._collaborationModes = parseModeListResponse(modeResult);
      } catch {
        // Non-fatal — server may not support collaboration modes
      }

      const serverInfo = result.serverInfo ?? result.server_info ?? result.userAgent;
      this._state = { status: "connected", serverInfo: serverInfo ?? undefined };
      this.emit("state", this._state);
      return this.state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[CodexService] Failed to start:", message);
      this._state = { status: "error", lastError: message };
      this.emit("state", this._state);
      this.cleanup();
      return this.state;
    }
  }

  async stop(): Promise<CodexState> {
    this.cleanup();
    this._state = { status: "disconnected" };
    this.emit("state", this._state);
    return this.state;
  }

  // -----------------------------------------------------------------------
  // Thread / Turn APIs
  // -----------------------------------------------------------------------

  async startThread(params: {
    model?: string;
    cwd?: string;
    approvalPolicy?: string;
    sandbox?: string;
    title?: string;
  }): Promise<CodexThread> {
    const threadParams: Record<string, unknown> = {
      sandbox: params.sandbox ?? "danger-full-access",
      approvalPolicy: params.approvalPolicy ?? "never",
      experimentalRawEvents: false,
    };
    if (params.model) threadParams.model = params.model;
    if (params.cwd) threadParams.cwd = params.cwd;

    const result = (await this.request("thread/start", threadParams)) as {
      thread: CodexThread;
      model?: string;
      reasoningEffort?: string | null;
      reasoning_effort?: string | null;
    };
    this.threadSettings.set(result.thread.id, {
      model: typeof result.model === "string" ? result.model : undefined,
      reasoningEffort: asString(result.reasoningEffort ?? result.reasoning_effort).trim() || null,
    });
    this.hydratedThreadIds.add(result.thread.id);
    this.upsertBindingForThread(result.thread.id, {
      cwd: params.cwd,
      model: typeof result.model === "string" ? result.model : undefined,
      reasoningEffort: asString(result.reasoningEffort ?? result.reasoning_effort).trim() || null,
      status: "running",
    });
    return result.thread;
  }

  async listThreads(params?: {
    cursor?: string | null;
    limit?: number;
    archived?: boolean;
  }): Promise<{ threads: CodexThread[]; nextCursor?: string }> {
    const result = (await this.request("thread/list", params ?? {})) as {
      threads: CodexThread[];
      nextCursor?: string;
    };
    return result;
  }

  async getThreadRuntime(threadId: string): Promise<CodexThreadRuntime> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    await this.ensureConnected();
    const threadRecords = await this.listThreadRecords();
    const threadRecord = threadRecords.find((candidate) => asString(candidate.id).trim() === normalizedThreadId) ?? null;
    if (!threadRecord) {
      return { thread: null, childThreads: [] };
    }
    const childThreads = threadRecords
      .filter((candidate) => getParentThreadIdFromThread(candidate) === normalizedThreadId)
      .map((candidate) => candidate as unknown as CodexThread);
    return {
      thread: threadRecord as unknown as CodexThread,
      childThreads,
    };
  }

  async resumeThread(threadId: string): Promise<Record<string, unknown>> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    await this.ensureConnected();
    const result = await this.request("thread/resume", { threadId: normalizedThreadId });
    const record = asRecord(result);
    const resumedThread = asRecord(record?.thread);
    const resumedThreadId = asString(resumedThread?.id ?? record?.threadId ?? record?.thread_id).trim() || normalizedThreadId;
    this.threadSettings.set(resumedThreadId, {
      model: asString(record?.model).trim() || undefined,
      reasoningEffort: asString(record?.reasoningEffort ?? record?.reasoning_effort).trim() || null,
    });
    this.hydratedThreadIds.add(resumedThreadId);
    this.upsertBindingForThread(resumedThreadId, {
      model: asString(record?.model).trim() || undefined,
      reasoningEffort: asString(record?.reasoningEffort ?? record?.reasoning_effort).trim() || null,
      status: "running",
    });
    return record ?? {};
  }

  private async listThreadRecords(params?: {
    cursor?: string | null;
    limit?: number;
    archived?: boolean;
  }): Promise<Record<string, unknown>[]> {
    const result = (await this.request("thread/list", params ?? {})) as Record<string, unknown>;
    const threads = Array.isArray(result.threads) ? result.threads : [];
    return threads.map((thread) => asRecord(thread)).filter((thread): thread is Record<string, unknown> => Boolean(thread));
  }

  async archiveThread(threadId: string): Promise<void> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    await this.ensureConnected();
    try {
      await this.request("thread/archive", { threadId: normalizedThreadId });
    } catch (error) {
      if (!isMissingCodexThreadArchiveError(error)) {
        throw error;
      }
    }
    const binding = this.findBindingForThread(normalizedThreadId);
    if (binding) {
      this.providerSessionDirectory?.remove(binding.sessionKey, "codex");
    }
    this.cleanupThreadMappings(normalizedThreadId);
  }

  async archiveThreadTree(rootThreadId: string): Promise<void> {
    const normalizedRootThreadId = rootThreadId.trim();
    if (!normalizedRootThreadId) {
      throw new Error("threadId is required");
    }
    await this.ensureConnected();
    const threadRecords = await this.listThreadRecords();
    const descendants = collectDescendantThreadIds(normalizedRootThreadId, threadRecords);
    for (const descendantId of descendants) {
      await this.archiveThread(descendantId);
    }
    await this.archiveThread(normalizedRootThreadId);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    const normalizedThreadId = threadId.trim();
    const normalizedName = name.replace(/\s+/g, " ").trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    if (!normalizedName) {
      throw new Error("name is required");
    }
    await this.ensureConnected();
    await this.request("thread/name/set", { threadId: normalizedThreadId, name: normalizedName });
  }

  async generateRunMetadata(cwd: string, prompt: string): Promise<CodexRunMetadata> {
    const cleanedPrompt = cleanRunMetadataPrompt(prompt);
    if (!cleanedPrompt) {
      throw new Error("Prompt is required to generate run metadata");
    }

    await this.ensureConnected(cwd);

    const threadResult = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
    });
    const threadId = extractThreadIdFromResult(threadResult);
    if (!threadId) {
      throw new Error("Failed to resolve background Codex thread ID");
    }

    let responseText = "";
    const unsubscribe = this.subscribeHiddenThread(threadId, (notification) => {
      if (notification.method === "item/agentMessage/delta") {
        const delta = asString(notification.params.delta);
        if (delta) {
          responseText += delta;
        }
      }
    });

    try {
      await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: buildRunMetadataPrompt(cleanedPrompt), text_elements: [] }],
        cwd,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
      });

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          release();
          reject(new Error("Timed out generating run metadata"));
        }, REQUEST_TIMEOUT_MS);

        const finish = (error?: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          release();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        const release = this.subscribeHiddenThread(threadId, (notification: CodexNotification) => {
          if (notification.method === "turn/completed") {
            finish();
            return;
          }
          if (notification.method === "turn/error") {
            const message = asString(asRecord(notification.params)?.error).trim() || "Failed to generate run metadata";
            finish(new Error(message));
          }
        });
      });

      return parseRunMetadataValue(responseText);
    } finally {
      unsubscribe();
      await this.archiveHiddenThread(threadId);
      this.cleanupThreadMappings(threadId);
    }
  }

  async captureAssistantReply(threadId: string, prompt: string, cwd?: string): Promise<string> {
    const normalizedThreadId = threadId.trim();
    const normalizedPrompt = prompt.trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    if (!normalizedPrompt) {
      throw new Error("prompt is required");
    }

    await this.ensureConnected(cwd);

    let responseText = "";
    const releaseDelta = this.subscribeHiddenThread(normalizedThreadId, (notification) => {
      if (notification.method === "item/agentMessage/delta") {
        const delta = asString(notification.params.delta);
        if (delta) {
          responseText += delta;
        }
      }
    });

    try {
      await this.startTurn({ threadId: normalizedThreadId, prompt: normalizedPrompt, cwd });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          releaseTurn();
          reject(new Error("Timed out waiting for Codex assistant reply"));
        }, REQUEST_TIMEOUT_MS);

        const finish = (error?: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          releaseTurn();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };

        const releaseTurn = this.subscribeHiddenThread(normalizedThreadId, (notification: CodexNotification) => {
          if (notification.method === "turn/completed") {
            finish();
            return;
          }
          if (notification.method === "turn/error") {
            const message = asString(asRecord(notification.params)?.error).trim() || "Failed to capture Codex assistant reply";
            finish(new Error(message));
          }
        });
      });
      return responseText.trim();
    } finally {
      releaseDelta();
    }
  }

  async startTurn(params: {
    threadId: string;
    prompt: string;
    cwd?: string;
    model?: string;
    effort?: string;
    collaborationMode?: string;
    attachments?: CodexAttachment[];
  }): Promise<void> {
    if (!this.findBindingForThread(params.threadId)) {
      this.seedBindingFromLegacyThread(params.threadId, params.cwd);
    }
    if (this.process && !this.hydratedThreadIds.has(params.threadId)) {
      await this.resumeThread(params.threadId);
    }
    const input: Array<
      | { type: "text"; text: string; text_elements: [] }
      | { type: "image"; url: string }
    > = [];
    if (params.prompt.trim()) {
      input.push({ type: "text", text: params.prompt, text_elements: [] });
    }
    for (const attachment of params.attachments ?? []) {
      if (attachment.type !== "image" || !attachment.url.trim()) {
        continue;
      }
      input.push({ type: "image", url: attachment.url });
    }
    if (input.length === 0) {
      throw new Error("prompt or image attachment is required");
    }
    this.upsertBindingForThread(params.threadId, {
      cwd: params.cwd,
      model: params.model,
      reasoningEffort: params.effort ?? null,
      collaborationMode: params.collaborationMode,
      status: "starting",
    });
    const turnParams: Record<string, unknown> = {
      threadId: params.threadId,
      input,
    };
    if (params.model) turnParams.model = params.model;
    if (params.effort) turnParams.effort = params.effort;
    if (params.collaborationMode) {
      // The Codex app-server expects collaborationMode as an object with mode + settings.
      // When using a built-in preset, developer_instructions must be null so Codex
      // applies the preset instructions instead of reusing a previous turn's mode state.
      const modeId = params.collaborationMode;
      const modeMeta = this._collaborationModes.find((m) => m.id === modeId);
      const threadSettings = this.threadSettings.get(params.threadId);
      const modeModel = modeMeta?.model?.trim() || undefined;
      const modeReasoningEffort = modeMeta?.reasoningEffort?.trim() || null;
      const model = params.model
        ?? modeModel
        ?? threadSettings?.model
        ?? this._models.find((entry) => entry.isDefault)?.model
        ?? "";
      const reasoningEffort = (
        params.effort
        ?? modeReasoningEffort
        ?? threadSettings?.reasoningEffort
        ?? ""
      ) || null;
      const settings: Record<string, unknown> = {
        model,
        reasoning_effort: reasoningEffort,
        developer_instructions: modeMeta?.developerInstructions || null,
      };
      turnParams.collaborationMode = {
        mode: modeMeta?.mode || modeId,
        settings,
      };
    }

    await this.request("turn/start", turnParams);
    this.upsertBindingForThread(params.threadId, {
      cwd: params.cwd,
      model: params.model,
      reasoningEffort: params.effort ?? null,
      collaborationMode: params.collaborationMode,
      status: "running",
    });
  }

  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<void> {
    const normalizedThreadId = threadId.trim();
    const normalizedTurnId = turnId.trim();
    const normalizedPrompt = prompt.trim();
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    if (!normalizedTurnId) {
      throw new Error("turnId is required");
    }
    if (!normalizedPrompt) {
      throw new Error("prompt is required");
    }
    const input = [{ type: "text", text: normalizedPrompt, text_elements: [] }];
    await this.request("turn/steer", {
      threadId: normalizedThreadId,
      expectedTurnId: normalizedTurnId,
      input,
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    // Send as both notification (fire-and-forget) and request (for servers that respond)
    const params: Record<string, string> = { threadId };
    if (turnId) params.turnId = turnId;
    // Try as a request first; if it times out, the notification should have already worked
    this.sendNotification("turn/interrupt", params);
    try {
      await this.request("turn/interrupt", params);
    } catch {
      // Timeout is expected if the server handles interrupt as notification-only
    }
  }

  async interruptThreadTree(rootThreadId: string, rootTurnId?: string): Promise<void> {
    const normalizedRootThreadId = rootThreadId.trim();
    if (!normalizedRootThreadId) {
      throw new Error("threadId is required");
    }
    await this.ensureConnected();
    const threadRecords = await this.listThreadRecords();
    const threadMap = new Map(threadRecords.map((thread) => [asString(thread.id).trim(), thread]));
    const descendants = collectDescendantThreadIds(normalizedRootThreadId, threadRecords);
    const threadIds = [normalizedRootThreadId, ...descendants];
    for (const threadId of threadIds) {
      const threadRecord = threadMap.get(threadId);
      const turnId = threadId === normalizedRootThreadId
        ? (rootTurnId?.trim() || getActiveTurnIdFromThread(threadRecord ?? {}))
        : getActiveTurnIdFromThread(threadRecord ?? {});
      await this.interruptTurn(threadId, turnId ?? "pending");
    }
  }

  async listModels(): Promise<CodexModelEntry[]> {
    if (!this.process) return this._models;
    try {
      const result = await this.request("model/list", {});
      this._models = parseModelListResponse(result);
    } catch {
      // Return cached models
    }
    return this._models;
  }

  async listCollaborationModes(): Promise<CodexCollaborationMode[]> {
    if (!this.process) return this._collaborationModes;
    try {
      const result = await this.request("collaborationMode/list", {});
      this._collaborationModes = parseModeListResponse(result);
    } catch {
      // Return cached modes
    }
    return this._collaborationModes;
  }

  async respondToApproval(requestId: number, decision: string): Promise<void> {
    this.sendResponse(requestId, { decision });
  }

  async respondToUserInput(requestId: number, answers: Record<string, { answers: string[] }>): Promise<void> {
    this.sendResponse(requestId, { answers });
  }

  // -----------------------------------------------------------------------
  // JSON-RPC Transport
  // -----------------------------------------------------------------------

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        return reject(new Error("Codex process is not running"));
      }

      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const msg = { method, id, params };
      this.process.stdin.write(JSON.stringify(msg) + "\n");
    });
  }

  private async ensureConnected(cwd?: string): Promise<void> {
    if (this.process && this._state.status === "connected") {
      return;
    }
    const state = await this.start(cwd);
    if (state.status !== "connected") {
      throw new Error(state.lastError ?? "Codex process is not connected");
    }
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const msg = { method, params };
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private sendResponse(id: number, result: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const msg = { id, result };
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Not valid JSON — skip (could be a log line)
      return;
    }

    // Response to a pending request
    if (typeof msg.id === "number" && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          const err = msg.error as { code?: number; message?: string };
          pending.reject(new Error(err.message ?? `JSON-RPC error ${err.code}`));
        } else {
          pending.resolve(msg.result);
        }
        return;
      }
    }

    // Server request (has id + method → requires a response from us, e.g. approval)
    if (typeof msg.id === "number" && typeof msg.method === "string") {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      this.trackThreadMappings(msg.method, params);
      const threadId = this.extractThreadId(msg.method, params);
      if (threadId && this.hiddenThreadIds.has(threadId)) {
        const notification = { method: msg.method, params } satisfies CodexNotification;
        this.notifyHiddenThread(threadId, notification);
        this.sendResponse(msg.id, {});
        return;
      }
      this.handleServerRequest(msg.id, msg.method, params);
      return;
    }

    // Notification (has method but no id)
    if (typeof msg.method === "string" && msg.id === undefined) {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      this.trackThreadMappings(msg.method, params);
      const notification = {
        method: msg.method,
        params,
      } satisfies CodexNotification;
      const threadId = this.extractThreadId(msg.method, params);
      if (threadId && this.hiddenThreadIds.has(threadId)) {
        this.notifyHiddenThread(threadId, notification);
        return;
      }
      this.emit("notification", notification);
      return;
    }
  }

  private subscribeHiddenThread(threadId: string, listener: (notification: CodexNotification) => void) {
    this.hiddenThreadIds.add(threadId);
    const listeners = this.hiddenThreadListeners.get(threadId) ?? new Set<(notification: CodexNotification) => void>();
    listeners.add(listener);
    this.hiddenThreadListeners.set(threadId, listeners);
    return () => {
      const current = this.hiddenThreadListeners.get(threadId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.hiddenThreadListeners.delete(threadId);
        this.hiddenThreadIds.delete(threadId);
      }
    };
  }

  private notifyHiddenThread(threadId: string, notification: CodexNotification) {
    const listeners = this.hiddenThreadListeners.get(threadId);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(notification);
    }
  }

  private trackThreadMappings(method: string, params: Record<string, unknown>) {
    const threadId = this.extractThreadId(method, params);
    if (method === "item/started" || method === "item/completed") {
      const itemId = asString(params.itemId ?? asRecord(params.item)?.id).trim();
      if (itemId && threadId) {
        this.itemThreadIds.set(itemId, threadId);
      }
      if (method === "item/completed" && itemId) {
        this.itemThreadIds.delete(itemId);
      }
    }
    if (method === "turn/started" || method === "turn/completed") {
      const turnId = asString(params.turnId ?? asRecord(params.turn)?.id).trim();
      if (turnId && threadId) {
        this.turnThreadIds.set(turnId, threadId);
      }
      if (method === "turn/completed" && turnId) {
        this.turnThreadIds.delete(turnId);
      }
    }
    if ((method === "thread/archived" || method === "thread/closed") && threadId) {
      this.cleanupThreadMappings(threadId);
    }
  }

  private extractThreadId(method: string, params: Record<string, unknown>): string | null {
    const itemRecord = asRecord(params.item);
    const turnRecord = asRecord(params.turn);
    const threadRecord = asRecord(params.thread);
    const itemId = asString(params.itemId ?? itemRecord?.id).trim();
    const turnId = asString(params.turnId ?? turnRecord?.id).trim();
    const directThreadId =
      asString(params.threadId ?? params.thread_id).trim() ||
      asString(threadRecord?.id).trim() ||
      asString(turnRecord?.threadId ?? turnRecord?.thread_id).trim() ||
      asString(itemRecord?.threadId ?? itemRecord?.thread_id).trim();

    if (directThreadId) {
      return directThreadId;
    }
    if (itemId && this.itemThreadIds.has(itemId)) {
      return this.itemThreadIds.get(itemId) ?? null;
    }
    if (turnId && this.turnThreadIds.has(turnId)) {
      return this.turnThreadIds.get(turnId) ?? null;
    }
    if (method === "thread/name/updated") {
      return asString(params.threadId ?? params.thread_id ?? threadRecord?.id).trim() || null;
    }
    return null;
  }

  private async archiveHiddenThread(threadId: string) {
    try {
      await this.request("thread/archive", { threadId });
    } catch {
      // Non-fatal cleanup.
    }
    this.hiddenThreadListeners.delete(threadId);
    this.hiddenThreadIds.delete(threadId);
  }

  private cleanupThreadMappings(threadId: string) {
    this.threadSettings.delete(threadId);
    this.hydratedThreadIds.delete(threadId);
    for (const [itemId, ownerThreadId] of this.itemThreadIds.entries()) {
      if (ownerThreadId === threadId) {
        this.itemThreadIds.delete(itemId);
      }
    }
    for (const [turnId, ownerThreadId] of this.turnThreadIds.entries()) {
      if (ownerThreadId === threadId) {
        this.turnThreadIds.delete(turnId);
      }
    }
  }

  private handleServerRequest(id: number, method: string, params: Record<string, unknown>): void {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "item/fileRead/requestApproval"
    ) {
      const approval: CodexApprovalRequest = {
        id,
        method,
        itemId: (params.itemId as string) ?? "",
        threadId: (params.threadId as string) ?? "",
        turnId: (params.turnId as string) ?? "",
        reason: (params.reason as string) ?? "",
        command: params.command as string[] | undefined,
        commandActions: params.commandActions as string[] | undefined,
        availableDecisions: (params.availableDecisions as string[]) ?? [],
        changes: params.changes as CodexApprovalRequest["changes"],
      };
      this.emit("approval", approval);
    } else if (method === "item/tool/requestUserInput") {
      const rawQuestions = Array.isArray(params.questions) ? params.questions : [];
      const questions = rawQuestions.map((q: Record<string, unknown>) => ({
        id: String(q.id ?? ""),
        header: String(q.header ?? ""),
        question: String(q.question ?? ""),
        isOther: Boolean(q.isOther ?? q.is_other),
        options: Array.isArray(q.options)
          ? q.options.map((o: Record<string, unknown>) => ({
              id: String(o.id ?? ""),
              label: String(o.label ?? ""),
              value: String(o.value ?? o.label ?? ""),
            }))
          : undefined,
      }));
      this.emit("userInput", {
        id,
        method,
        threadId: (params.threadId ?? params.thread_id as string) ?? "",
        turnId: (params.turnId ?? params.turn_id as string) ?? "",
        itemId: (params.itemId ?? params.item_id as string) ?? "",
        message: (params.message as string) ?? "",
        questions: questions.length > 0 ? questions : undefined,
      });
    } else {
      // Unknown server request — auto-acknowledge
      this.sendResponse(id, {});
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  private cleanup(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex process terminated"));
    }
    this.pending.clear();

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // already exited
      }
      this.process = null;
    }
    this.hiddenThreadIds.clear();
    this.hiddenThreadListeners.clear();
    this.itemThreadIds.clear();
    this.turnThreadIds.clear();
    this.hydratedThreadIds.clear();
  }
}
