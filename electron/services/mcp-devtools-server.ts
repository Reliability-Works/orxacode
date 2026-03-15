import { spawn, type ChildProcess } from "node:child_process";

export type McpDevToolsServerState = "stopped" | "starting" | "running" | "error";

export type McpDevToolsServerStatus = {
  state: McpDevToolsServerState;
  cdpPort?: number;
  error?: string;
};

type McpDevToolsServerOptions = {
  onStateChange?: (status: McpDevToolsServerStatus) => void;
};

/**
 * Manages a chrome-devtools-mcp child process that connects to a local CDP endpoint.
 * Communicates with the MCP server via JSON-RPC over stdio.
 */
export class McpDevToolsServer {
  private process: ChildProcess | null = null;
  private state: McpDevToolsServerState = "stopped";
  private cdpPort: number | undefined;
  private lastError: string | undefined;
  private onStateChange: ((status: McpDevToolsServerStatus) => void) | undefined;
  private pendingRequests = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private nextRequestId = 1;
  private stdoutBuffer = "";

  constructor(options?: McpDevToolsServerOptions) {
    this.onStateChange = options?.onStateChange;
  }

  async start(cdpPort: number): Promise<McpDevToolsServerStatus> {
    if (this.state === "running" && this.cdpPort === cdpPort && this.process) {
      return this.getStatus();
    }

    await this.stop();

    this.cdpPort = cdpPort;
    this.lastError = undefined;
    this.setState("starting");

    try {
      const child = spawn("npx", ["chrome-devtools-mcp", "--browser-url", `http://127.0.0.1:${cdpPort}`], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      });

      this.process = child;

      child.stdout?.on("data", (chunk: Buffer) => {
        this.handleStdoutData(chunk.toString("utf-8"));
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8").trim();
        if (text) {
          console.error("[mcp-devtools-server] stderr:", text);
        }
      });

      child.on("error", (err) => {
        this.lastError = err.message;
        this.setState("error");
        this.rejectAllPending(err);
        this.process = null;
      });

      child.on("exit", (code, signal) => {
        const wasRunning = this.state === "running" || this.state === "starting";
        if (wasRunning && code !== 0 && code !== null) {
          this.lastError = `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`;
          this.setState("error");
        } else if (this.state !== "stopped") {
          this.setState("stopped");
        }
        this.rejectAllPending(new Error("MCP server process exited"));
        this.process = null;
      });

      // Wait a short period for the process to start or fail immediately
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          if (this.process && !this.process.killed) {
            this.setState("running");
            resolve();
          } else {
            reject(new Error(this.lastError ?? "MCP server failed to start"));
          }
        }, 1500);

        const onError = (err: Error) => {
          clearTimeout(timeout);
          cleanup();
          reject(err);
        };

        const onExit = (code: number | null) => {
          if (code !== 0) {
            clearTimeout(timeout);
            cleanup();
            reject(new Error(this.lastError ?? `MCP server exited with code ${code}`));
          }
        };

        const cleanup = () => {
          child.removeListener("error", onError);
          child.removeListener("exit", onExit);
        };

        child.once("error", onError);
        child.once("exit", onExit);
      });

      return this.getStatus();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.setState("error");
      this.process = null;
      return this.getStatus();
    }
  }

  async stop(): Promise<McpDevToolsServerStatus> {
    const child = this.process;
    if (!child) {
      this.setState("stopped");
      return this.getStatus();
    }

    this.process = null;
    this.rejectAllPending(new Error("MCP server stopped"));

    return new Promise<McpDevToolsServerStatus>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        this.setState("stopped");
        resolve(this.getStatus());
      }, 3000);

      child.once("exit", () => {
        clearTimeout(timeout);
        this.setState("stopped");
        resolve(this.getStatus());
      });

      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(timeout);
        this.setState("stopped");
        resolve(this.getStatus());
      }
    });
  }

  getStatus(): McpDevToolsServerStatus {
    return {
      state: this.state,
      cdpPort: this.cdpPort,
      error: this.lastError,
    };
  }

  /**
   * Send a JSON-RPC request to the MCP server and return the result.
   */
  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.process?.stdin?.writable) {
      throw new Error("MCP server is not running");
    }

    const id = this.nextRequestId++;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const payload = JSON.stringify(request) + "\n";
      this.process!.stdin!.write(payload, (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request "${method}" timed out`));
        }
      }, 30_000);
    });
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<unknown[]> {
    if (this.state !== "running") {
      return [];
    }
    try {
      const result = (await this.sendRequest("tools/list")) as { tools?: unknown[] } | null;
      return result?.tools ?? [];
    } catch {
      return [];
    }
  }

  private setState(newState: McpDevToolsServerState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange?.(this.getStatus());
  }

  private handleStdoutData(data: string) {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed) as Record<string, unknown>;
        this.handleJsonRpcMessage(message);
      } catch {
        // Not JSON — log for debugging
        console.log("[mcp-devtools-server] stdout:", trimmed);
      }
    }
  }

  private handleJsonRpcMessage(message: Record<string, unknown>) {
    const id = message.id;
    if (id !== undefined && id !== null) {
      const pending = this.pendingRequests.get(id as string | number);
      if (pending) {
        this.pendingRequests.delete(id as string | number);
        if (message.error) {
          const err = message.error as { message?: string; code?: number };
          pending.reject(new Error(err.message ?? `JSON-RPC error ${err.code ?? "unknown"}`));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // Notifications (no id) are silently ignored for now
  }

  private rejectAllPending(error: Error) {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
