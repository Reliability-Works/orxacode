import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  getSessionMessages,
  query,
  type Options as ClaudeQueryOptions,
  type ElicitationRequest,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeChatApprovalDecision,
  ClaudeChatApprovalRequest,
  ClaudeChatHealthStatus,
  ClaudeChatHistoryMessage,
  ClaudeChatModelEntry,
  ClaudeChatNotification,
  ClaudeChatState,
  ClaudeChatTurnOptions,
  ClaudeChatUserInputRequest,
} from "@shared/ipc";

type PendingApproval = {
  sessionKey: string;
  turnId: string;
  itemId: string;
  toolName: string;
  resolve: (result: PermissionResult) => void;
};

type PendingUserInput = {
  sessionKey: string;
  turnId: string;
  request: ElicitationRequest;
  resolve: (result: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }) => void;
};

type ClaudeSubagentRuntime = {
  id: string;
  description: string;
  prompt?: string;
  taskType?: string;
  childSessionId?: string;
  status: "thinking" | "awaiting_instruction" | "completed" | "idle";
  statusText: string;
  summary?: string;
};

type ClaudeSessionRuntime = {
  state: ClaudeChatState;
  directory: string;
  activeQuery: Query | null;
  runningTasks: ClaudeSubagentRuntime[];
  mainProviderThreadId?: string;
};

const CLAUDE_MODELS: ClaudeChatModelEntry[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    isDefault: false,
    supportsFastMode: true,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ["low", "medium", "high", "max", "ultrathink"],
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    isDefault: true,
    supportsFastMode: false,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ["low", "medium", "high", "ultrathink"],
    defaultReasoningEffort: "high",
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    isDefault: false,
    supportsFastMode: false,
    supportsThinkingToggle: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  },
];

function supportsClaudeFastMode(model: string | null | undefined) {
  return model?.trim() === "claude-opus-4-6";
}

function supportsClaudeAdaptiveReasoning(model: string | null | undefined) {
  const normalized = model?.trim();
  return normalized === "claude-opus-4-6" || normalized === "claude-sonnet-4-6";
}

function supportsClaudeMaxEffort(model: string | null | undefined) {
  return model?.trim() === "claude-opus-4-6";
}

function mapPermissionMode(input: string | undefined): PermissionMode | undefined {
  if (input === "plan") {
    return "plan";
  }
  if (input === "yolo-write") {
    return "bypassPermissions";
  }
  if (input === "ask-write") {
    return "default";
  }
  return undefined;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => extractTextFromUnknown(entry)).filter(Boolean).join("");
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return record.content.map((entry) => extractTextFromUnknown(entry)).filter(Boolean).join("");
  }
  return Object.values(record)
    .map((entry) => extractTextFromUnknown(entry))
    .filter(Boolean)
    .join("");
}

function extractAssistantText(message: SDKAssistantMessage) {
  return extractTextFromUnknown(message.message).trim();
}

function extractPartialAssistantText(message: SDKMessage) {
  if (message.type !== "stream_event") {
    return "";
  }
  const event = message.event as Record<string, unknown> | undefined;
  if (!event || event.type !== "content_block_delta") {
    return "";
  }
  const delta = event.delta as Record<string, unknown> | undefined;
  if (!delta) {
    return "";
  }
  if (typeof delta.text === "string") {
    return delta.text;
  }
  if (typeof delta.partial_json === "string") {
    return delta.partial_json;
  }
  return "";
}

function buildHistoryMessages(messages: SessionMessage[]): ClaudeChatHistoryMessage[] {
  return messages.map((message, index) => ({
    id: message.uuid,
    role: message.type === "assistant" ? "assistant" : "user",
    content: extractTextFromUnknown(message.message).trim(),
    timestamp: index,
    sessionId: message.session_id,
  }));
}

function extractQuestionOptionsFromSchema(schema: Record<string, unknown> | undefined) {
  const properties =
    schema && typeof schema === "object" && !Array.isArray(schema)
      ? ((schema.properties as Record<string, unknown> | undefined) ?? {})
      : {};
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const record = value as Record<string, unknown>;
    const enumValues = Array.isArray(record.enum)
      ? record.enum.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    if (enumValues.length > 0) {
      return enumValues.map((entry) => ({ label: entry, value: entry }));
    }
    const oneOf = Array.isArray(record.oneOf) ? record.oneOf : [];
    const options = oneOf
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const option = entry as Record<string, unknown>;
        const value = typeof option.const === "string" ? option.const : typeof option.value === "string" ? option.value : undefined;
        const label = typeof option.title === "string" ? option.title : value;
        return label && value ? { label, value } : null;
      })
      .filter((entry): entry is { label: string; value: string } => entry !== null);
    if (options.length > 0) {
      return options;
    }
  }
  return undefined;
}

async function runClaudeCommand(args: string[]) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync("claude", args, {
    timeout: 15_000,
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export class ClaudeChatService extends EventEmitter {
  private readonly sessions = new Map<string, ClaudeSessionRuntime>();

  private readonly pendingApprovals = new Map<string, PendingApproval>();

  private readonly pendingUserInputs = new Map<string, PendingUserInput>();

  getState(sessionKey: string): ClaudeChatState {
    return (
      this.sessions.get(sessionKey)?.state ?? {
        sessionKey,
        status: "disconnected",
      }
    );
  }

  async health(): Promise<ClaudeChatHealthStatus> {
    try {
      const version = await runClaudeCommand(["--version"]);
      const versionLine = `${version.stdout}\n${version.stderr}`.trim().split(/\r?\n/)[0]?.trim();
      try {
        const auth = await runClaudeCommand(["auth", "status"]);
        const combined = `${auth.stdout}\n${auth.stderr}`.trim();
        const parsed =
          combined.startsWith("{") || combined.startsWith("[")
            ? (JSON.parse(combined) as Record<string, unknown>)
            : null;
        const normalized = combined.toLowerCase();
        const authenticated =
          parsed && typeof parsed.loggedIn === "boolean"
            ? parsed.loggedIn
            : normalized.includes("not authenticated") || normalized.includes("not logged in") || normalized.includes("login required")
                ? false
                : normalized.includes("authenticated") || normalized.includes("logged in")
                  ? true
                  : null;
        return {
          available: true,
          authenticated,
          version: versionLine,
          message: authenticated === null ? combined || undefined : undefined,
        };
      } catch (error) {
        return {
          available: true,
          authenticated: null,
          version: versionLine,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } catch (error) {
      return {
        available: false,
        authenticated: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(): Promise<ClaudeChatModelEntry[]> {
    return CLAUDE_MODELS;
  }

  async startTurn(sessionKey: string, directory: string, prompt: string, options?: ClaudeChatTurnOptions) {
    const runtime = this.getOrCreateSession(sessionKey, directory);
    if (runtime.activeQuery) {
      throw new Error("Claude chat session already has an active turn.");
    }

    const turnId = randomUUID();
    runtime.state = {
      ...runtime.state,
      status: "connecting",
      activeTurnId: turnId,
      lastError: undefined,
    };
    this.emitState(runtime.state);
    this.emitNotification({
      sessionKey,
      method: "turn/started",
      params: { turnId, prompt, model: options?.model, timestamp: Date.now() },
    });
    this.emitNotification({
      sessionKey,
      method: "thinking/started",
      params: { turnId, timestamp: Date.now() },
    });

    const permissionMode = mapPermissionMode(options?.permissionMode);
    const requestedEffort = options?.effort;
    const supportedEfforts = supportsClaudeMaxEffort(options?.model)
      ? ["low", "medium", "high", "max", "ultrathink"]
      : supportsClaudeAdaptiveReasoning(options?.model)
        ? ["low", "medium", "high", "ultrathink"]
        : [];
    const effectiveEffort =
      requestedEffort && requestedEffort !== "ultrathink" && supportedEfforts.includes(requestedEffort)
        ? requestedEffort
        : undefined;

    const onElicitation = async (request: ElicitationRequest) => {
      const requestId = randomUUID();
      return await new Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>((resolve) => {
        this.pendingUserInputs.set(requestId, { sessionKey, turnId, request, resolve });
        const payload: ClaudeChatUserInputRequest = {
          id: requestId,
          sessionKey,
          threadId: sessionKey,
          turnId,
          message: request.message,
          mode: request.mode,
          server: request.serverName,
          elicitationId: request.elicitationId,
          options: extractQuestionOptionsFromSchema(request.requestedSchema),
        };
        this.emit("userInput", payload);
      });
    };

    const queryOptions: ClaudeQueryOptions = {
      cwd: directory,
      model: options?.model,
      pathToClaudeCodeExecutable: "claude",
      includePartialMessages: true,
      env: process.env,
      additionalDirectories: [directory],
      ...(effectiveEffort ? { effort: effectiveEffort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      ...(typeof options?.maxThinkingTokens === "number" ? { maxThinkingTokens: options.maxThinkingTokens } : {}),
      ...(typeof options?.thinking === "boolean" || options?.fastMode
        ? {
            settings: {
              ...(typeof options?.thinking === "boolean" ? { alwaysThinkingEnabled: options.thinking } : {}),
              ...(options?.fastMode && supportsClaudeFastMode(options?.model) ? { fastMode: true } : {}),
            },
          }
        : {}),
      ...(runtime.state.providerThreadId ? { resume: runtime.state.providerThreadId } : { sessionId: randomUUID() }),
      canUseTool: async (
        toolName: string,
        toolInput: Record<string, unknown>,
        callbackOptions: Parameters<NonNullable<ClaudeQueryOptions["canUseTool"]>>[2],
      ) => {
        const requestId = randomUUID();
        return await new Promise<PermissionResult>((resolve) => {
          this.pendingApprovals.set(requestId, {
            sessionKey,
            turnId,
            itemId: callbackOptions.toolUseID,
            toolName,
            resolve,
          });
          const rawCommand = toolInput.command ?? toolInput.cmd;
          const command =
            typeof rawCommand === "string"
              ? rawCommand
              : Array.isArray(rawCommand)
                ? rawCommand.map((entry) => String(entry)).join(" ")
                : undefined;
          const payload: ClaudeChatApprovalRequest = {
            id: requestId,
            sessionKey,
            threadId: sessionKey,
            turnId,
            itemId: callbackOptions.toolUseID,
            toolName,
            reason: command ? `${toolName}: ${command}` : toolName,
            command,
            availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
          };
          this.emit("approval", payload);
        });
      },
      onElicitation,
    };

    const activeQuery = query({ prompt, options: queryOptions });
    runtime.activeQuery = activeQuery;

    try {
      for await (const message of activeQuery) {
        this.handleMessage(runtime, turnId, message);
      }
      runtime.activeQuery = null;
      runtime.state = {
        ...runtime.state,
        status: "connected",
        activeTurnId: null,
      };
      this.emitState(runtime.state);
      this.emitNotification({
        sessionKey,
        method: "thinking/stopped",
        params: { turnId, timestamp: Date.now() },
      });
      this.emitNotification({
        sessionKey,
        method: "turn/completed",
        params: { turnId, timestamp: Date.now() },
      });
    } catch (error) {
      runtime.activeQuery = null;
      runtime.state = {
        ...runtime.state,
        status: "error",
        activeTurnId: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.emitState(runtime.state);
      this.emitNotification({
        sessionKey,
        method: "thinking/stopped",
        params: { turnId, timestamp: Date.now() },
      });
      this.emitNotification({
        sessionKey,
        method: "turn/error",
        params: {
          turnId,
          message: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        },
      });
      throw error;
    }
  }

  async interruptTurn(sessionKey: string) {
    const runtime = this.sessions.get(sessionKey);
    if (runtime?.activeQuery) {
      await runtime.activeQuery.interrupt();
    }
  }

  async approve(requestId: string, decision: ClaudeChatApprovalDecision) {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingApprovals.delete(requestId);
    if (decision === "accept" || decision === "acceptForSession") {
      pending.resolve({
        behavior: "allow",
        toolUseID: pending.itemId,
      });
      return;
    }
    pending.resolve({
      behavior: "deny",
      toolUseID: pending.itemId,
      message: decision === "cancel" ? "User cancelled tool execution." : "User declined tool execution.",
      interrupt: decision === "cancel",
    });
  }

  async respondToUserInput(requestId: string, response: string) {
    const pending = this.pendingUserInputs.get(requestId);
    if (!pending) {
      return;
    }
    this.pendingUserInputs.delete(requestId);
    if (response.trim().length === 0) {
      pending.resolve({ action: "cancel" });
      return;
    }
    const schema = pending.request.requestedSchema;
    const firstField =
      schema && typeof schema === "object" && !Array.isArray(schema)
        ? Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {})[0]
        : undefined;
    let content: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(response) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        content = parsed as Record<string, unknown>;
      }
    } catch {
      content = firstField ? { [firstField]: response } : { value: response };
    }
    pending.resolve({
      action: "accept",
      ...(content ? { content } : {}),
    });
  }

  async getSessionMessages(sessionId: string, directory?: string): Promise<ClaudeChatHistoryMessage[]> {
    const messages = await getSessionMessages(sessionId, directory ? { dir: directory } : undefined);
    return buildHistoryMessages(messages);
  }

  async archiveSession(sessionKey: string) {
    const runtime = this.sessions.get(sessionKey);
    if (runtime?.activeQuery) {
      await runtime.activeQuery.interrupt();
    }
    this.sessions.delete(sessionKey);
    this.emitState({
      sessionKey,
      status: "disconnected",
    });
  }

  private getOrCreateSession(sessionKey: string, directory: string): ClaudeSessionRuntime {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.directory = directory;
      return existing;
    }
    const runtime: ClaudeSessionRuntime = {
      directory,
      activeQuery: null,
      runningTasks: [],
      state: {
        sessionKey,
        status: "disconnected",
      },
    };
    this.sessions.set(sessionKey, runtime);
    return runtime;
  }

  private emitState(payload: ClaudeChatState) {
    this.emit("state", payload);
  }

  private emitNotification(payload: ClaudeChatNotification) {
    this.emit("notification", payload);
  }

  private updateTask(runtime: ClaudeSessionRuntime, taskId: string, updater: (task: ClaudeSubagentRuntime) => ClaudeSubagentRuntime) {
    const index = runtime.runningTasks.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return;
    }
    runtime.runningTasks[index] = updater(runtime.runningTasks[index]!);
  }

  private bindNextUnassignedTask(runtime: ClaudeSessionRuntime, providerThreadId: string) {
    const candidate = [...runtime.runningTasks]
      .reverse()
      .find((task) => task.status === "thinking" && !task.childSessionId);
    if (!candidate) {
      return null;
    }
    candidate.childSessionId = providerThreadId;
    return candidate.id;
  }

  private handleMessage(runtime: ClaudeSessionRuntime, turnId: string, message: SDKMessage) {
    const sessionKey = runtime.state.sessionKey;
    const sessionId = typeof message.session_id === "string" ? message.session_id : undefined;
    if (sessionId) {
      if (!runtime.mainProviderThreadId) {
        runtime.mainProviderThreadId = sessionId;
        runtime.state = {
          ...runtime.state,
          status: "connected",
          providerThreadId: sessionId,
        };
        this.emitState(runtime.state);
        this.emitNotification({
          sessionKey,
          method: "thread/started",
          params: {
            providerThreadId: sessionId,
            isSubagent: false,
            timestamp: Date.now(),
          },
        });
      } else if (sessionId !== runtime.mainProviderThreadId) {
        const taskId = this.bindNextUnassignedTask(runtime, sessionId);
        this.emitNotification({
          sessionKey,
          method: "thread/started",
          params: {
            providerThreadId: sessionId,
            isSubagent: true,
            ...(taskId ? { taskId } : {}),
            timestamp: Date.now(),
          },
        });
      }
    }

    if (message.type === "assistant") {
      this.emitNotification({
        sessionKey,
        method: "assistant/message",
        params: {
          id: message.uuid,
          turnId,
          content: extractAssistantText(message),
          timestamp: Date.now(),
        },
      });
      this.emitNotification({
        sessionKey,
        method: "thinking/stopped",
        params: { turnId, timestamp: Date.now() },
      });
      return;
    }

    if (message.type === "stream_event") {
      const content = extractPartialAssistantText(message);
      if (content) {
        this.emitNotification({
          sessionKey,
          method: "assistant/partial",
          params: {
            id: message.uuid,
            turnId,
            content,
            timestamp: Date.now(),
          },
        });
        this.emitNotification({
          sessionKey,
          method: "thinking/stopped",
          params: { turnId, timestamp: Date.now() },
        });
      }
      return;
    }

    if (message.type === "tool_progress") {
      this.emitNotification({
        sessionKey,
        method: "tool/progress",
        params: {
          id: message.tool_use_id,
          turnId,
          toolName: message.tool_name,
          taskId: message.task_id,
          elapsedTimeSeconds: message.elapsed_time_seconds,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "tool_use_summary") {
      this.emitNotification({
        sessionKey,
        method: "tool/completed",
        params: {
          id: message.uuid,
          turnId,
          summary: message.summary,
          precedingToolUseIds: message.preceding_tool_use_ids,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "system" && message.subtype === "task_started") {
      runtime.runningTasks.push({
        id: message.task_id,
        description: message.description,
        prompt: message.prompt,
        taskType: message.task_type,
        status: "thinking",
        statusText: "is running",
      });
      this.emitNotification({
        sessionKey,
        method: "task/started",
        params: {
          taskId: message.task_id,
          turnId,
          description: message.description,
          prompt: message.prompt,
          taskType: message.task_type,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "system" && message.subtype === "task_progress") {
      this.updateTask(runtime, message.task_id, (task) => ({
        ...task,
        status: "thinking",
        statusText: message.summary?.trim() || message.description.trim() || "is running",
        summary: message.summary,
      }));
      this.emitNotification({
        sessionKey,
        method: "task/progress",
        params: {
          taskId: message.task_id,
          turnId,
          description: message.description,
          summary: message.summary,
          lastToolName: message.last_tool_name,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "system" && message.subtype === "task_notification") {
      const status = message.status === "completed" ? "completed" : message.status === "stopped" ? "idle" : "awaiting_instruction";
      const statusText = message.status === "completed" ? "completed" : message.status === "stopped" ? "stopped" : "failed";
      this.updateTask(runtime, message.task_id, (task) => ({
        ...task,
        status,
        statusText,
        summary: message.summary,
      }));
      this.emitNotification({
        sessionKey,
        method: "task/completed",
        params: {
          taskId: message.task_id,
          turnId,
          status: message.status,
          summary: message.summary,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "system" && message.subtype === "api_retry") {
      this.emitNotification({
        sessionKey,
        method: "status/retry",
        params: {
          turnId,
          attempt: message.attempt,
          maxRetries: message.max_retries,
          retryDelayMs: message.retry_delay_ms,
          error: message.error,
          timestamp: Date.now(),
        },
      });
      return;
    }

    if (message.type === "result") {
      this.emitNotification({
        sessionKey,
        method: "result",
        params: {
          turnId,
          subtype: message.subtype,
          isError: message.is_error,
          result: "result" in message ? message.result : undefined,
          errors: "errors" in message ? message.errors : undefined,
          timestamp: Date.now(),
        },
      });
    }
  }
}
