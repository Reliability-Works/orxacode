import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";
import { readdirSync, accessSync, constants } from "node:fs";
import path from "node:path";
import type {
  CodexApprovalRequest,
  CodexCollaborationMode,
  CodexModelEntry,
  CodexNotification,
  CodexState,
  CodexThread,
} from "@shared/ipc";

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
      return {
        id: String(m.id ?? ""),
        label: String(m.label ?? m.name ?? m.id ?? ""),
        mode: String(m.mode ?? ""),
        model: String(m.model ?? ""),
        reasoningEffort: String(m.reasoningEffort ?? m.reasoning_effort ?? ""),
        developerInstructions: String(m.developerInstructions ?? m.developer_instructions ?? ""),
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

export class CodexService extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private _state: CodexState = { status: "disconnected" };
  private _models: CodexModelEntry[] = [];
  private _collaborationModes: CodexCollaborationMode[] = [];

  get state(): CodexState {
    return { ...this._state };
  }

  get models(): CodexModelEntry[] {
    return [...this._models];
  }

  get collaborationModes(): CodexCollaborationMode[] {
    return [...this._collaborationModes];
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async start(cwd?: string): Promise<CodexState> {
    if (this.process) {
      return this.state;
    }

    this._state = { status: "connecting" };
    this.emit("state", this._state);

    try {
      // Resolve the codex binary, checking common install locations
      const codexBin = resolveCodexBinary();
      if (!codexBin) {
        const message = "codex binary not found in PATH. Install it with: npm install -g @openai/codex";
        console.error("[CodexService]", message);
        this._state = { status: "error", lastError: message };
        this.emit("state", this._state);
        return this.state;
      }

      console.info(`[CodexService] Spawning: ${codexBin} app-server`);
      const child = spawn(codexBin, ["app-server"], {
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

    const result = (await this.request("thread/start", threadParams)) as { thread: CodexThread };
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

  async startTurn(params: {
    threadId: string;
    prompt: string;
    cwd?: string;
    model?: string;
    effort?: string;
    collaborationMode?: string;
  }): Promise<void> {
    const input = [{ type: "text", text: params.prompt, text_elements: [] }];
    const turnParams: Record<string, unknown> = {
      threadId: params.threadId,
      input,
    };
    if (params.model) turnParams.model = params.model;
    if (params.effort) turnParams.effort = params.effort;
    if (params.collaborationMode) turnParams.collaborationMode = params.collaborationMode;

    await this.request("turn/start", turnParams);
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
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

  async respondToUserInput(requestId: number, response: string): Promise<void> {
    this.sendResponse(requestId, { response });
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
      this.handleServerRequest(msg.id, msg.method, (msg.params ?? {}) as Record<string, unknown>);
      return;
    }

    // Notification (has method but no id)
    if (typeof msg.method === "string" && msg.id === undefined) {
      this.emit("notification", {
        method: msg.method,
        params: (msg.params ?? {}) as Record<string, unknown>,
      } satisfies CodexNotification);
      return;
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
      this.emit("userInput", {
        id,
        method,
        threadId: (params.threadId as string) ?? "",
        turnId: (params.turnId as string) ?? "",
        itemId: (params.itemId as string) ?? "",
        message: (params.message as string) ?? "",
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
  }
}
