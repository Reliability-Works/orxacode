import type { CodexMessageItem } from "../hooks/useCodexSession";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseUserContent(content: unknown) {
  const inputs = Array.isArray(content) ? content : [];
  const textParts: string[] = [];
  inputs.forEach((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return;
    }
    if (asString(record.type) === "text") {
      const text = asString(record.text).trim();
      if (text) {
        textParts.push(text);
      }
    }
  });
  return textParts.join(" ").trim();
}

function buildToolMessage(item: Record<string, unknown>, timestamp: number): CodexMessageItem | null {
  const id = asString(item.id).trim();
  const type = asString(item.type).trim();
  if (!id || !type) {
    return null;
  }
  if (type === "commandExecution") {
    const command = Array.isArray(item.command)
      ? item.command.map((part) => asString(part)).filter(Boolean).join(" ")
      : asString(item.command);
    return {
      id,
      kind: "tool",
      toolType: type,
      title: command ? `$ ${command}` : "Command",
      command: command || undefined,
      output: asString(item.aggregatedOutput).trim() || undefined,
      status: (asString(item.status).toLowerCase().includes("error") || asString(item.status).toLowerCase().includes("fail")) ? "error" : "completed",
      exitCode: asNumber(item.exitCode ?? item.exit_code),
      durationMs: asNumber(item.durationMs ?? item.duration_ms),
      timestamp,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const firstChange = asRecord(changes[0]);
    const path = asString(firstChange?.path ?? item.path).trim();
    return {
      id,
      kind: "diff",
      path,
      type: asString(firstChange?.kind ?? item.changeType ?? "modified").trim() || "modified",
      status: (asString(item.status).toLowerCase().includes("error") || asString(item.status).toLowerCase().includes("fail")) ? "error" : "completed",
      diff: changes
        .map((change) => asString(asRecord(change)?.diff).trim())
        .filter(Boolean)
        .join("\n\n") || undefined,
      insertions: asNumber(item.insertions),
      deletions: asNumber(item.deletions),
      timestamp,
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    return {
      id,
      kind: "tool",
      toolType: "collabToolCall",
      title: asString(item.tool).trim() ? `Collab: ${asString(item.tool).trim()}` : "Collab tool call",
      output: asString(item.prompt).trim() || undefined,
      status: "completed",
      timestamp,
    };
  }
  if (type === "plan") {
    return {
      id,
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      output: asString(item.text).trim() || undefined,
      status: "completed",
      timestamp,
    };
  }
  if (type === "contextCompaction") {
    return { id, kind: "compaction", timestamp };
  }
  return null;
}

function buildThreadItemMessage(item: Record<string, unknown>, timestamp: number): CodexMessageItem | null {
  const id = asString(item.id).trim();
  const type = asString(item.type).trim();
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage") {
    const content = parseUserContent(item.content);
    return {
      id,
      kind: "message",
      role: "user",
      content,
      timestamp,
    };
  }
  if (type === "agentMessage") {
    return {
      id,
      kind: "message",
      role: "assistant",
      content: asString(item.text),
      timestamp,
    };
  }
  if (type === "reasoning") {
    return {
      id,
      kind: "reasoning",
      summary: Array.isArray(item.summary) ? item.summary.map((entry) => asString(entry)).join("\n") : asString(item.summary),
      content: Array.isArray(item.content) ? item.content.map((entry) => asString(entry)).join("\n") : asString(item.content),
      timestamp,
    };
  }
  return buildToolMessage(item, timestamp);
}

export function extractThreadFromResumeResponse(response: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!response) {
    return null;
  }
  const result = asRecord(response.result);
  return asRecord(result?.thread ?? response.thread);
}

export function buildCodexMessagesFromThread(thread: Record<string, unknown>): CodexMessageItem[] {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const messages: CodexMessageItem[] = [];
  turns.forEach((turn, turnIndex) => {
    const turnRecord = asRecord(turn);
    const turnItems = Array.isArray(turnRecord?.items) ? turnRecord?.items : [];
    const timestamp =
      asNumber(turnRecord?.createdAt ?? turnRecord?.created_at ?? turnRecord?.startedAt ?? turnRecord?.started_at) ??
      turnIndex;
    turnItems.forEach((item, itemIndex) => {
      const converted = buildThreadItemMessage(asRecord(item) ?? {}, timestamp + itemIndex);
      if (converted) {
        messages.push(converted);
      }
    });
  });
  return messages;
}
