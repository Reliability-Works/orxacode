import type { Part } from "@opencode-ai/sdk/v2/client";

const ORXA_BROWSER_RESULT_PREFIX = "[ORXA_BROWSER_RESULT]";
const SUPERMEMORY_INTERNAL_PREFIX = "[SUPERMEMORY]";
const INTERNAL_USER_TEXT_PREFIXES = [
  ORXA_BROWSER_RESULT_PREFIX,
  SUPERMEMORY_INTERNAL_PREFIX,
];
const ORXA_BROWSER_ACTION_TAG_PATTERN = /<orxa_browser_action>\s*([\s\S]*?)\s*<\/orxa_browser_action>/gi;

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseOrxaBrowserActionsFromText(text: string): Array<{ id?: string; action?: string }> {
  const actions: Array<{ id?: string; action?: string }> = [];
  let match: RegExpExecArray | null;
  ORXA_BROWSER_ACTION_TAG_PATTERN.lastIndex = 0;
  while ((match = ORXA_BROWSER_ACTION_TAG_PATTERN.exec(text)) !== null) {
    const payload = parseJsonObject((match[1] ?? "").trim());
    if (!payload) {
      continue;
    }
    const action = typeof payload.action === "string" ? payload.action.trim() : undefined;
    const id = typeof payload.id === "string" ? payload.id.trim() : undefined;
    if (!action && !id) {
      continue;
    }
    actions.push({
      action: action && action.length > 0 ? action : undefined,
      id: id && id.length > 0 ? id : undefined,
    });
  }
  return actions;
}

export function summarizeOrxaBrowserActionText(text: string) {
  const actions = parseOrxaBrowserActionsFromText(text);
  if (actions.length === 0) {
    return null;
  }
  if (actions.length === 1) {
    const first = actions[0]!;
    const actionLabel = first.action ?? "action";
    return `Queued browser action: ${actionLabel}`;
  }
  return `Queued ${actions.length} browser actions`;
}

export function countOrxaMemoryLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[ORXA_MEMORY]")).length;
}

export function parseOrxaBrowserResultText(text: string) {
  if (!text.startsWith(ORXA_BROWSER_RESULT_PREFIX)) {
    return null;
  }
  const payload = parseJsonObject(text.slice(ORXA_BROWSER_RESULT_PREFIX.length).trim());
  if (!payload) {
    return { action: "action", ok: true } as const;
  }
  const action = typeof payload.action === "string" ? payload.action.trim() : "action";
  const ok = payload.ok !== false;
  const error = typeof payload.error === "string" ? payload.error.trim() : undefined;
  const blockedReason = typeof payload.blockedReason === "string" ? payload.blockedReason.trim() : undefined;
  return {
    action,
    ok,
    error,
    blockedReason,
  };
}

export function parseSupermemoryInternalText(text: string) {
  if (!text.startsWith(SUPERMEMORY_INTERNAL_PREFIX)) {
    return null;
  }
  const payload = text.slice(SUPERMEMORY_INTERNAL_PREFIX.length).trim();
  const firstLine = payload.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (!/^injected\s+\d+\s+items?\b/i.test(firstLine)) {
    return null;
  }
  return firstLine;
}

export function isLikelyTelemetryJson(value: string) {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return false;
  }
  const type = typeof parsed.type === "string" ? parsed.type : undefined;
  if (type === "step-start" || type === "step-finish") {
    return true;
  }
  return typeof parsed.sessionID === "string" && typeof parsed.messageID === "string";
}

export function isProgressUpdateText(text: string) {
  if (!text.endsWith(":")) {
    return false;
  }
  if (text.length > 240 || text.includes("\n")) {
    return false;
  }
  return /^(i(?:'ll| will| need to| am going to| can)|let me|now i|first|next|then|before)/i.test(text);
}

export function shouldHideAssistantText(value: string) {
  const text = value.trim();
  if (text.length === 0) {
    return true;
  }
  if (parseOrxaBrowserActionsFromText(text).length > 0) {
    return true;
  }
  if (countOrxaMemoryLines(text) > 0) {
    return true;
  }
  if (isLikelyTelemetryJson(text)) {
    return true;
  }
  if (text.includes("Prioritizing mandatory TODO creation")) {
    return true;
  }
  if (isProgressUpdateText(text)) {
    return true;
  }
  return false;
}

export function getVisibleParts(role: string, parts: Part[]) {
  if (role !== "user") {
    return parts.filter((part) => part.type === "text" || part.type === "file");
  }

  const visibleUserTextParts = parts.filter((part) => {
    if (part.type !== "text") {
      return false;
    }
    const text = part.text.trim();
    if (text.length === 0 || text.startsWith("[SUPERMEMORY]")) {
      return false;
    }
    if (INTERNAL_USER_TEXT_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      return false;
    }
    if ("ignored" in part && part.ignored) {
      return false;
    }
    if ("synthetic" in part && part.synthetic) {
      return false;
    }
    return true;
  });

  if (visibleUserTextParts.length === 0) {
    return [];
  }

  const fileParts = parts.filter((part) => part.type === "file");
  const filtered = [...visibleUserTextParts, ...fileParts];

  if (filtered.length > 0) {
    return filtered;
  }
  return [];
}

export function extractVisibleText(parts: Part[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text.length > 0) {
        segments.push(text);
      }
    } else if (part.type === "file") {
      const label = part.filename ?? part.url ?? "file";
      segments.push(`[Attached file: ${label}]`);
    }
  }
  return segments.join("\n\n");
}
