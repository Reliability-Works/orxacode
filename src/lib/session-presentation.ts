import type { SessionMessageBundle } from "@shared/ipc";
import type { UnifiedProvider, UnifiedSessionStatus } from "../state/unified-runtime";
import type { CodexMessageItem } from "../hooks/useCodexSession";
import type { SubagentInfo } from "../hooks/useCodexSession";
import type { UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";
import type { TodoItem } from "../components/chat/TodoDock";

export type UnifiedChangedFilesGroup = {
  title: string;
  files: Array<{
    id: string;
    path: string;
    type: string;
    diff?: string;
    insertions?: number;
    deletions?: number;
  }>;
};

export type UnifiedBackgroundAgentSummary = {
  id: string;
  provider: UnifiedProvider;
  name: string;
  role?: string;
  status: "thinking" | "awaiting_instruction" | "completed" | "idle";
  statusText: string;
  prompt?: string;
  modelLabel?: string;
  command?: string;
  sessionID?: string;
};

export type UnifiedSessionActivity = {
  id: string;
  label: string;
};

export type UnifiedPendingActionSurface =
  | {
      kind: "permission";
      provider: UnifiedProvider;
      awaiting: true;
      label: string;
    }
  | {
      kind: "question";
      provider: UnifiedProvider;
      awaiting: true;
      label: string;
    }
  | {
      kind: "plan";
      provider: UnifiedProvider;
      awaiting: true;
      label: string;
    };

export type UnifiedComposerState = {
  busy: boolean;
  awaiting: boolean;
  sending: boolean;
  blockedBy: UnifiedPendingActionSurface["kind"] | null;
};

export type UnifiedTaskListPresentation = {
  provider: UnifiedProvider;
  items: TodoItem[];
  label: string;
};

export type UnifiedSidebarSessionState = {
  sessionKey: string;
  indicator: "busy" | "awaiting" | "unread" | "none";
  statusType: "busy" | "awaiting" | "idle";
  activityAt: number;
  unread: boolean;
};

export type UnifiedSessionPresentation = {
  provider: UnifiedProvider;
  rows: UnifiedTimelineRenderRow[];
};

export type UnifiedProjectedSessionPresentation = UnifiedSessionPresentation & {
  latestActivity: UnifiedSessionActivity | null;
  placeholderTimestamp: number;
};

export type UnifiedPermissionDockData = {
  provider: UnifiedProvider;
  requestId: string | number;
  description: string;
  filePattern?: string;
  command?: string[];
};

export type UnifiedQuestionDockOption = {
  label: string;
  value: string;
};

export type UnifiedQuestionDockQuestion = {
  id: string;
  header?: string;
  text: string;
  options?: UnifiedQuestionDockOption[];
  multiSelect?: boolean;
};

export type UnifiedQuestionDockData = {
  provider: UnifiedProvider;
  requestId: string | number;
  questions: UnifiedQuestionDockQuestion[];
};

export type UnifiedPlanDockData = {
  provider: "codex";
  label: string;
};

function compactText(value: string, maxLength = 92) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return parseJsonRecord(value.trim());
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractStringByKeys(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const nested = extractStringByKeys(value, keys);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(record)) {
    const nested = extractStringByKeys(value, keys);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeTaskStatus(status: string | undefined): TodoItem["status"] {
  const normalized = status?.trim().toLowerCase();
  if (
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "active" ||
    normalized === "running"
  ) {
    return "in_progress";
  }
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "success" ||
    normalized === "succeeded"
  ) {
    return "completed";
  }
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "skipped") {
    return "cancelled";
  }
  return "pending";
}

function parseTodoItemsFromValue(value: unknown): TodoItem[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseTodoItemsFromValue(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    const items: TodoItem[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object") {
        continue;
      }
      const candidate = item as { content?: unknown; status?: unknown; id?: unknown };
      const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
      if (!content) {
        continue;
      }
      const id = typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id : `${content}:${index}`;
      items.push({
        id,
        content,
        status: normalizeTaskStatus(typeof candidate.status === "string" ? candidate.status : undefined),
      });
    }
    return items;
  }

  if (value && typeof value === "object") {
    const candidate = value as { todos?: unknown; items?: unknown };
    if (candidate.todos) {
      return parseTodoItemsFromValue(candidate.todos);
    }
    if (candidate.items) {
      return parseTodoItemsFromValue(candidate.items);
    }
  }

  return [];
}

function extractModelLabel(input: unknown) {
  const record = toRecord(input);
  if (!record) {
    return undefined;
  }
  const providerID = typeof record.providerID === "string" ? record.providerID : undefined;
  const modelID = typeof record.modelID === "string" ? record.modelID : undefined;
  if (!providerID || !modelID) {
    return undefined;
  }
  return `${providerID}/${modelID}`;
}

function isTaskToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "task" || normalized.endsWith("/task");
}

function deriveOpencodeAgentStatus(
  statusType: string | undefined,
): Pick<UnifiedBackgroundAgentSummary, "status" | "statusText"> {
  const normalized = statusType?.trim().toLowerCase().replace(/[\s_-]/g, "") ?? "";
  if (
    normalized.includes("await") ||
    normalized.includes("question") ||
    normalized.includes("permission") ||
    normalized.includes("input")
  ) {
    return { status: "awaiting_instruction", statusText: "awaiting instruction" };
  }
  if (
    normalized.includes("busy") ||
    normalized.includes("running") ||
    normalized.includes("retry") ||
    normalized.includes("working")
  ) {
    return { status: "thinking", statusText: "is running" };
  }
  if (
    normalized.includes("done") ||
    normalized.includes("complete") ||
    normalized.includes("finish") ||
    normalized.includes("success")
  ) {
    return { status: "completed", statusText: "completed" };
  }
  return { status: "idle", statusText: "idle" };
}

function findMatchingBackgroundAgent(
  agents: UnifiedBackgroundAgentSummary[],
  candidate: Pick<UnifiedBackgroundAgentSummary, "name" | "prompt" | "sessionID">,
) {
  return agents.find((agent) => {
    if (candidate.sessionID && agent.sessionID && candidate.sessionID === agent.sessionID) {
      return true;
    }
    if (candidate.prompt && agent.prompt && candidate.prompt === agent.prompt) {
      return true;
    }
    return candidate.name === agent.name;
  });
}

function upsertBackgroundAgent(
  agents: UnifiedBackgroundAgentSummary[],
  candidate: UnifiedBackgroundAgentSummary,
) {
  const existing = findMatchingBackgroundAgent(agents, candidate);
  if (!existing) {
    agents.push(candidate);
    return;
  }
  existing.role = candidate.role ?? existing.role;
  existing.status = candidate.status;
  existing.statusText = candidate.statusText;
  existing.prompt = candidate.prompt ?? existing.prompt;
  existing.modelLabel = candidate.modelLabel ?? existing.modelLabel;
  existing.command = candidate.command ?? existing.command;
  existing.sessionID = candidate.sessionID ?? existing.sessionID;
}

function extractTaskDelegationInfo(input: unknown, metadata?: unknown) {
  const record = toRecord(input);
  if (!record) {
    return null;
  }
  const agent = extractStringByKeys(record, ["subagent_type", "subagentType", "agent", "subagent"]) ?? "subagent";
  const description = extractStringByKeys(record, ["description"]) ?? "Delegated task";
  const prompt = extractStringByKeys(record, ["prompt"]) ?? "";
  const command = extractStringByKeys(record, ["command"]) ?? undefined;
  const metadataRecord = toRecord(metadata);
  const sessionID = metadataRecord ? extractStringByKeys(metadataRecord, ["sessionId", "sessionID"]) ?? undefined : undefined;
  return {
    agent,
    description,
    prompt,
    command,
    modelLabel: extractModelLabel(metadataRecord?.model),
    sessionID,
  };
}

function extractTaskSessionIDFromOutput(output: unknown) {
  const record = toRecord(output);
  const fromRecord = record
    ? extractStringByKeys(record, ["sessionId", "sessionID", "task_id", "taskId", "session_id"])
    : null;
  if (fromRecord) {
    return fromRecord;
  }
  if (typeof output !== "string") {
    return undefined;
  }
  const trimmed = output.trim();
  if (!trimmed) {
    return undefined;
  }
  const fromTag = trimmed.match(/<task_id>\s*([A-Za-z0-9._:-]+)\s*<\/task_id>/i)?.[1];
  if (fromTag) {
    return fromTag.trim();
  }
  return trimmed.match(/\b(?:task[_-]?id|session[_-]?id|taskId|sessionId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1]?.trim();
}

export function buildSidebarSessionPresentation(input: {
  sessionKey: string;
  status: UnifiedSessionStatus;
  updatedAt: number;
  isActive: boolean;
}): UnifiedSidebarSessionState {
  const { isActive, sessionKey, status, updatedAt } = input;
  const activityAt = Math.max(updatedAt, status.activityAt);
  if (status.awaiting || status.planReady) {
    return {
      sessionKey,
      indicator: "awaiting",
      statusType: "awaiting",
      activityAt,
      unread: status.unread,
    };
  }
  if (status.busy) {
    return {
      sessionKey,
      indicator: "busy",
      statusType: "busy",
      activityAt,
      unread: status.unread,
    };
  }
  if (!isActive && status.unread && activityAt > 0) {
    return {
      sessionKey,
      indicator: "unread",
      statusType: "idle",
      activityAt,
      unread: true,
    };
  }
  return {
    sessionKey,
    indicator: "none",
    statusType: "idle",
    activityAt,
    unread: status.unread,
  };
}

export function buildComposerPresentation(input: {
  status: UnifiedSessionStatus | null;
  sending: boolean;
  pending: UnifiedPendingActionSurface | null;
}): UnifiedComposerState {
  return {
    busy: Boolean(input.status?.busy) || input.sending,
    awaiting: Boolean(input.status?.awaiting || input.status?.planReady),
    sending: input.sending,
    blockedBy: input.pending?.kind ?? null,
  };
}

export function buildPermissionDockData(input: {
  provider: UnifiedProvider;
  requestId: string | number;
  description: string;
  filePattern?: string;
  command?: string[];
}): UnifiedPermissionDockData {
  return input;
}

export function buildQuestionDockData(input: {
  provider: UnifiedProvider;
  requestId: string | number;
  questions: UnifiedQuestionDockQuestion[];
}): UnifiedQuestionDockData {
  return input;
}

export function buildPlanDockData(input: {
  label?: string;
}): UnifiedPlanDockData {
  return {
    provider: "codex",
    label: input.label ?? "Plan ready for review",
  };
}

export function extractOpencodeTodoItems(messages: SessionMessageBundle[]): TodoItem[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const bundle = messages[messageIndex];
    for (let partIndex = bundle.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = bundle.parts[partIndex];
      if (part.type !== "tool" || !part.tool.toLowerCase().includes("todo")) {
        continue;
      }
      const state = part.state as { output?: unknown; input?: unknown };
      const fromOutput = parseTodoItemsFromValue(state.output);
      if (fromOutput.length > 0) {
        return fromOutput;
      }
      const fromInput = parseTodoItemsFromValue(state.input);
      if (fromInput.length > 0) {
        return fromInput;
      }
    }
  }
  return [];
}

export function buildCodexBackgroundAgents(subagents: SubagentInfo[]): UnifiedBackgroundAgentSummary[] {
  return subagents.map((agent) => ({
    id: agent.threadId,
    provider: "codex",
    name: agent.nickname,
    role: agent.role,
    status: agent.status,
    statusText: agent.statusText,
  }));
}

export function buildOpencodeBackgroundAgents(
  messages: SessionMessageBundle[],
  sessionStatusByID?: Record<string, { type?: string }>,
): UnifiedBackgroundAgentSummary[] {
  const latestAssistant = [...messages].reverse().find((bundle) => bundle.info.role === "assistant");
  if (!latestAssistant) {
    return [];
  }
  const agents: UnifiedBackgroundAgentSummary[] = [];
  for (const part of latestAssistant.parts) {
    if (part.type === "subtask") {
      const status = deriveOpencodeAgentStatus(
        part.sessionID ? sessionStatusByID?.[part.sessionID]?.type : undefined,
      );
      upsertBackgroundAgent(agents, {
        id: part.sessionID ?? part.id,
        provider: "opencode",
        name: part.agent,
        role: undefined,
        status: status.status,
        statusText: status.statusText,
        prompt: part.prompt,
        modelLabel: extractModelLabel(part.model),
        command: part.command,
        sessionID: part.sessionID,
      });
      continue;
    }
    if (part.type !== "tool" || !isTaskToolName(part.tool)) {
      continue;
    }
    const metadata = (part.state as Record<string, unknown>).metadata;
    const output = (part.state as Record<string, unknown>).output;
    const taskDelegation = extractTaskDelegationInfo(part.state.input, metadata);
    if (!taskDelegation) {
      continue;
    }
    const sessionID = taskDelegation.sessionID ?? extractTaskSessionIDFromOutput(output);
    const status = deriveOpencodeAgentStatus(sessionID ? sessionStatusByID?.[sessionID]?.type : undefined);
    upsertBackgroundAgent(agents, {
      id: sessionID ?? `task:${part.id}`,
      provider: "opencode",
      name: taskDelegation.agent,
      role: undefined,
      status: status.status,
      statusText: status.statusText,
      prompt: taskDelegation.prompt,
      modelLabel: taskDelegation.modelLabel,
      command: taskDelegation.command,
      sessionID,
    });
  }
  return agents.map((agent) => ({
    ...agent,
    prompt: agent.prompt ? compactText(agent.prompt, 800) : undefined,
  }));
}

export function buildTaskListPresentation(
  provider: UnifiedProvider,
  items: TodoItem[],
): UnifiedTaskListPresentation | null {
  if (items.length === 0) {
    return null;
  }
  return {
    provider,
    items,
    label: provider === "codex" ? "Task list" : "Todo list",
  };
}

export function groupChangedFileRows(rows: UnifiedTimelineRenderRow[]): UnifiedTimelineRenderRow[] {
  const nextRows: UnifiedTimelineRenderRow[] = [];
  let pendingAssistantMessage: UnifiedTimelineRenderRow | null = null;
  let pendingRows: UnifiedTimelineRenderRow[] = [];
  let pendingDiffs: Extract<UnifiedTimelineRenderRow, { kind: "diff" }>[] = [];

  const flush = () => {
    if (pendingAssistantMessage) {
      nextRows.push(pendingAssistantMessage);
      if (pendingDiffs.length > 0) {
        nextRows.push({
          id: `${pendingAssistantMessage.id}:changed-files`,
          kind: "diff-group",
          title: "Changed files",
          files: pendingDiffs.map((diff) => ({
            id: diff.id,
            path: diff.path,
            type: diff.type,
            diff: diff.diff,
            insertions: diff.insertions,
            deletions: diff.deletions,
          })),
        });
      }
      nextRows.push(...pendingRows);
      pendingAssistantMessage = null;
      pendingRows = [];
      pendingDiffs = [];
      return;
    }

    if (pendingDiffs.length > 0) {
      nextRows.push({
        id: `${pendingDiffs[0]?.id ?? "diff-group"}:changed-files`,
        kind: "diff-group",
        title: "Changed files",
        files: pendingDiffs.map((diff) => ({
          id: diff.id,
          path: diff.path,
          type: diff.type,
          diff: diff.diff,
          insertions: diff.insertions,
          deletions: diff.deletions,
        })),
      });
      pendingDiffs = [];
    }

    if (pendingRows.length > 0) {
      nextRows.push(...pendingRows);
      pendingRows = [];
    }
  };

  const pushRow = (row: UnifiedTimelineRenderRow) => {
    if (pendingAssistantMessage) {
      pendingRows.push(row);
      return;
    }
    nextRows.push(row);
  };

  for (const row of rows) {
    if (row.kind === "message") {
      flush();
      if (row.role === "assistant") {
        pendingAssistantMessage = row;
      } else {
        nextRows.push(row);
      }
      continue;
    }

    if (row.kind === "diff") {
      pendingDiffs.push(row);
      continue;
    }

    pushRow(row);
  }

  flush();
  return nextRows;
}

export function projectCodexSessionPresentation(
  messages: CodexMessageItem[],
  isStreaming: boolean,
): UnifiedSessionPresentation {
  const rawRows: UnifiedTimelineRenderRow[] = [];
  let previousWasAssistantContent = false;

  for (const item of messages) {
    if (item.kind === "tool" && item.toolType === "task") {
      continue;
    }

    if (item.kind === "message") {
      const role = item.role === "user" ? "user" : "assistant";
      const showHeader = !(role === "assistant" && previousWasAssistantContent);
      previousWasAssistantContent = role === "assistant";
      rawRows.push({
        id: item.id,
        kind: "message",
        role,
        label: role === "user" ? "User" : "Codex",
        timestamp: item.timestamp,
        showHeader,
        copyText: role === "user" ? item.content : undefined,
        sections: item.content || (isStreaming && role === "assistant")
          ? [{ id: `${item.id}:content`, type: "text", content: item.content || "\u2588" }]
          : [],
      });
      continue;
    }

    previousWasAssistantContent = true;

    if (item.kind === "thinking") {
      rawRows.push({ id: item.id, kind: "thinking", summary: "", content: "" });
      continue;
    }
    if (item.kind === "status") {
      rawRows.push({ id: item.id, kind: "status", label: item.label });
      continue;
    }
    if (item.kind === "reasoning") {
      rawRows.push({ id: item.id, kind: "thinking", summary: item.summary, content: item.content });
      continue;
    }
    if (item.kind === "tool") {
      rawRows.push({
        id: item.id,
        kind: "tool",
        title: item.title,
        status: item.status,
        command: item.command,
        output: item.output,
        defaultExpanded: item.status === "error",
      });
      continue;
    }
    if (item.kind === "diff") {
      rawRows.push({
        id: item.id,
        kind: "diff",
        path: item.path,
        type: item.type,
        diff: item.diff,
        insertions: item.insertions,
        deletions: item.deletions,
      });
      continue;
    }
    if (item.kind === "context") {
      rawRows.push({
        id: item.id,
        kind: "context",
        items: [
          {
            toolName: item.toolType,
            title: item.title,
            status: item.status,
            detail: item.detail,
          },
        ],
      });
      continue;
    }
    if (item.kind === "explore") {
      rawRows.push({ id: item.id, kind: "explore", item });
      continue;
    }
    if (item.kind === "compaction") {
      rawRows.push({ id: item.id, kind: "compaction" });
    }
  }

  return {
    provider: "codex",
    rows: groupChangedFileRows(rawRows),
  };
}
