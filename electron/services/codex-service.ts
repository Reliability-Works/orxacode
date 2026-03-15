import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodexConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface CodexState {
  status: CodexConnectionStatus;
  serverInfo?: { name: string; version: string };
  lastError?: string;
}

export interface CodexThread {
  id: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  status?: { type: string };
  ephemeral?: boolean;
}

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

export interface CodexApprovalRequest {
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
}

export interface CodexNotification {
  method: string;
  params: Record<string, unknown>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

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

  get state(): CodexState {
    return { ...this._state };
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
      const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
        cwd: cwd ?? process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, LOG_FORMAT: "json" },
      });

      this.process = child;

      child.on("error", (err) => {
        this._state = { status: "error", lastError: err.message };
        this.emit("state", this._state);
        this.cleanup();
      });

      child.on("exit", () => {
        this._state = { status: "disconnected" };
        this.emit("state", this._state);
        this.cleanup();
      });

      // stderr → debug logging
      child.stderr?.on("data", (chunk: Buffer) => {
        this.emit("stderr", chunk.toString());
      });

      // stdout → JSONL messages
      const rl = createInterface({ input: child.stdout!, terminal: false });
      this.readline = rl;
      rl.on("line", (line) => this.handleLine(line));

      // Initialize handshake
      const result = (await this.request("initialize", {
        clientInfo: { name: "orxa_code", title: "Orxa Code", version: "1.0.0" },
        capabilities: { experimentalApi: false, optOutNotificationMethods: [] },
      })) as { server_info?: { name: string; version: string }; serverInfo?: { name: string; version: string } };

      // Send initialized notification (no id — fire-and-forget)
      this.sendNotification("initialized", {});

      const serverInfo = result.serverInfo ?? result.server_info;
      this._state = { status: "connected", serverInfo: serverInfo ?? undefined };
      this.emit("state", this._state);
      return this.state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
    const result = (await this.request("thread/start", params)) as { thread: CodexThread };
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
    approvalPolicy?: string;
    model?: string;
  }): Promise<void> {
    const input = [{ type: "text", text: params.prompt }];
    await this.request("turn/start", {
      threadId: params.threadId,
      input,
      cwd: params.cwd,
      approvalPolicy: params.approvalPolicy ?? "unlessTrusted",
      model: params.model,
    });
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async respondToApproval(requestId: number, decision: string): Promise<void> {
    this.sendResponse(requestId, { decision });
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
      method === "item/fileChange/requestApproval"
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
