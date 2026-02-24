import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { SessionMessageBundle } from "@shared/ipc";

type Props = {
  messages: SessionMessageBundle[];
  showAssistantPlaceholder?: boolean;
  assistantLabel?: string;
  workspaceDirectory?: string | null;
  bottomClearance?: number;
};

type InternalEvent = {
  id: string;
  summary: string;
  details?: string;
  actor?: string;
};

type ActivityEvent = {
  id: string;
  label: string;
};

type TimelineEvent = {
  id: string;
  label: string;
  kind: TimelineKind;
  reason?: string;
  command?: string;
};

type TimelineKind = "read" | "search" | "list" | "todo" | "create" | "edit" | "delete" | "git" | "delegate" | "run";

type TimelineBlock =
  | {
      id: string;
      type: "exploration";
      summary: string;
      entries: TimelineEvent[];
    }
  | {
      id: string;
      type: "event";
      entry: TimelineEvent;
    };

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isExplorationKind(kind: TimelineKind) {
  return kind === "read" || kind === "search" || kind === "list";
}

function summarizeExploration(entries: TimelineEvent[]) {
  const reads = entries.filter((entry) => entry.kind === "read").length;
  const searches = entries.filter((entry) => entry.kind === "search").length;
  const lists = entries.filter((entry) => entry.kind === "list").length;
  const parts: string[] = [];
  if (reads > 0) {
    parts.push(pluralize(reads, "file"));
  }
  if (searches > 0) {
    parts.push(pluralize(searches, "search"));
  }
  if (lists > 0) {
    parts.push(pluralize(lists, "list"));
  }
  if (parts.length === 0) {
    parts.push(pluralize(entries.length, "step"));
  }
  return `Explored ${parts.join(", ")}`;
}

function buildTimelineBlocks(events: TimelineEvent[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let activeExploration: TimelineEvent[] = [];

  const flushExploration = () => {
    if (activeExploration.length === 0) {
      return;
    }
    blocks.push({
      id: `exploration:${activeExploration[0]?.id ?? blocks.length}`,
      type: "exploration",
      summary: summarizeExploration(activeExploration),
      entries: activeExploration,
    });
    activeExploration = [];
  };

  for (const entry of events) {
    if (isExplorationKind(entry.kind)) {
      activeExploration.push(entry);
      continue;
    }
    flushExploration();
    blocks.push({ id: `event:${entry.id}`, type: "event", entry });
  }
  flushExploration();
  return blocks;
};

type DelegationTrace = {
  id: string;
  agent: string;
  description: string;
  prompt: string;
  modelLabel?: string;
  command?: string;
  sessionID?: string;
  events: InternalEvent[];
};

type TaskDelegationInfo = {
  agent: string;
  description: string;
  prompt: string;
  command?: string;
  modelLabel?: string;
  sessionID?: string;
};

function getRoleLabel(role: string, assistantLabel: string) {
  if (role === "assistant") {
    return assistantLabel;
  }
  if (role === "user") {
    return "User";
  }
  return role;
}

function getVisibleParts(role: string, parts: Part[]) {
  if (role !== "user") {
    return parts.filter((part) => part.type === "text" || part.type === "file");
  }

  const firstUserText = parts.find((part) => {
    if (part.type !== "text") {
      return false;
    }
    const text = part.text.trim();
    if (text.length === 0 || text.startsWith("[SUPERMEMORY]")) {
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
  const fileParts = parts.filter((part) => part.type === "file");
  const filtered = [...(firstUserText ? [firstUserText] : []), ...fileParts];

  if (filtered.length > 0) {
    return filtered;
  }
  return [];
}

function parseJsonObject(value: string): Record<string, unknown> | null {
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

function isLikelyTelemetryJson(value: string) {
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

function shouldHideAssistantText(value: string) {
  const text = value.trim();
  if (text.length === 0) {
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

function isProgressUpdateText(text: string) {
  if (!text.endsWith(":")) {
    return false;
  }
  if (text.length > 240 || text.includes("\n")) {
    return false;
  }
  return /^(i(?:'ll| will| need to| am going to| can)|let me|now i|first|next|then|before)/i.test(text);
}

function compactText(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`;
}

function toWorkspaceRelativePath(target: string, workspaceDirectory?: string | null) {
  const normalizedTarget = target.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedWorkspace = (workspaceDirectory ?? "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalizedWorkspace) {
    return normalizedTarget;
  }
  if (normalizedTarget === normalizedWorkspace) {
    return ".";
  }
  if (normalizedTarget.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedTarget.slice(normalizedWorkspace.length + 1);
  }
  const embeddedWorkspaceIndex = normalizedTarget.indexOf(`${normalizedWorkspace}/`);
  if (embeddedWorkspaceIndex >= 0) {
    return normalizedTarget.slice(embeddedWorkspaceIndex + normalizedWorkspace.length + 1);
  }
  return normalizedTarget;
}

function formatTarget(target: string, workspaceDirectory?: string | null, maxLength = 58) {
  return compactText(toWorkspaceRelativePath(target, workspaceDirectory), maxLength);
}

function deriveTargetFromCommand(command: string, workspaceDirectory?: string | null) {
  const quotedPath = command.match(/["']([^"']+\.[^"']+)["']/)?.[1];
  if (quotedPath) {
    return formatTarget(quotedPath, workspaceDirectory);
  }
  const redirectPath = command.match(/(?:>|>>)\s*([~./][^\s"'`]+)/)?.[1];
  if (redirectPath) {
    return formatTarget(redirectPath, workspaceDirectory);
  }
  const slashPath = command.match(/(?:^|\s)([~./][^\s"'`]+)/)?.[1];
  if (slashPath) {
    return formatTarget(slashPath, workspaceDirectory);
  }
  const extensionPath = command.match(/(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=\s|$)/)?.[1];
  if (extensionPath) {
    return formatTarget(extensionPath, workspaceDirectory);
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

function extractPatchTarget(input: unknown, workspaceDirectory?: string | null): { verb: "Edited" | "Created" | "Deleted"; target: string } | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const patchMatch = trimmed.match(/\*\*\*\s+(Update|Add|Delete)\s+File:\s+([^\n]+)/i);
    if (patchMatch) {
      const action = patchMatch[1]?.toLowerCase();
      const filePath = patchMatch[2]?.trim();
      if (!filePath) {
        return null;
      }
      return {
        verb: action === "add" ? "Created" : action === "delete" ? "Deleted" : "Edited",
        target: formatTarget(filePath, workspaceDirectory, 64),
      };
    }
    const parsed = parseJsonObject(trimmed);
    return parsed ? extractPatchTarget(parsed, workspaceDirectory) : null;
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const patch = extractPatchTarget(value, workspaceDirectory);
      if (patch) {
        return patch;
      }
    }
    return null;
  }
  if (!input || typeof input !== "object") {
    return null;
  }
  const directPatch = extractStringByKeys(input, ["patch", "content", "text"]);
  if (directPatch) {
    const patch = extractPatchTarget(directPatch, workspaceDirectory);
    if (patch) {
      return patch;
    }
  }
  return null;
}

function extractCommand(input: unknown) {
  return extractStringByKeys(input, ["cmd", "command"]);
}

function extractCommandPreview(input: unknown, maxLength = 92) {
  const command = extractCommand(input);
  if (!command) {
    return null;
  }
  const firstLine = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return null;
  }
  return compactText(firstLine, maxLength);
}

function isTaskToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "task" || normalized.endsWith("/task");
}

function isToolStatusActive(status: string) {
  return status === "pending" || status === "running";
}

function toObjectRecord(input: unknown): Record<string, unknown> | null {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    return parseJsonObject(input.trim());
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

function extractModelLabel(input: unknown) {
  const record = toObjectRecord(input);
  if (!record) {
    return undefined;
  }
  const modelCandidate = record.model;
  const modelRecord = toObjectRecord(modelCandidate);
  if (!modelRecord) {
    return undefined;
  }
  const providerID = typeof modelRecord.providerID === "string" ? modelRecord.providerID : undefined;
  const modelID = typeof modelRecord.modelID === "string" ? modelRecord.modelID : undefined;
  if (!providerID || !modelID) {
    return undefined;
  }
  return `${providerID}/${modelID}`;
}

function extractTaskDelegationInfo(input: unknown, metadata?: unknown): TaskDelegationInfo | null {
  const record = toObjectRecord(input);
  if (!record) {
    return null;
  }
  const agent =
    extractStringByKeys(record, ["subagent_type", "subagentType", "agent", "subagent"]) ??
    "subagent";
  const description = extractStringByKeys(record, ["description"]) ?? "Delegated task";
  const prompt = extractStringByKeys(record, ["prompt"]) ?? "";
  const command = extractStringByKeys(record, ["command"]) ?? undefined;
  const modelLabel = extractModelLabel(metadata);
  const metadataRecord = toObjectRecord(metadata);
  const sessionID = metadataRecord ? extractStringByKeys(metadataRecord, ["sessionId", "sessionID"]) ?? undefined : undefined;
  return {
    agent,
    description,
    prompt,
    command,
    modelLabel,
    sessionID,
  };
}

function extractTaskSessionIDFromOutput(output: unknown) {
  const objectRecord = toObjectRecord(output);
  const fromRecord = objectRecord
    ? extractStringByKeys(objectRecord, ["sessionId", "sessionID", "task_id", "taskId", "session_id"])
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
  const fromLine = trimmed.match(/\b(?:task[_-]?id|session[_-]?id|taskId|sessionId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/i)?.[1];
  if (fromLine) {
    return fromLine.trim();
  }
  return undefined;
}

function extractTaskResultText(output: string, maxLength = 2200) {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/i);
  const text = (match?.[1] ?? trimmed).trim();
  if (!text) {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function mapPatchVerbToKind(verb: "Edited" | "Created" | "Deleted"): TimelineKind {
  if (verb === "Created") {
    return "create";
  }
  if (verb === "Deleted") {
    return "delete";
  }
  return "edit";
}

function classifyCommandKind(command: string, workspaceDirectory?: string | null): TimelineKind {
  const patch = extractPatchTarget(command, workspaceDirectory);
  if (patch) {
    return mapPatchVerbToKind(patch.verb);
  }
  if (/\b(rg|grep|find)\b/.test(command)) {
    return "search";
  }
  if (/\b(cat|sed|head|tail|bat)\b/.test(command)) {
    return "read";
  }
  if (/\b(ls|tree|fd)\b/.test(command)) {
    return "list";
  }
  if (/\bgit\b/.test(command)) {
    return "git";
  }
  if (/\brm\b/.test(command)) {
    return "delete";
  }
  if (/\b(mkdir|touch)\b/.test(command)) {
    return "create";
  }
  if (/\b(mv|cp|echo|printf)\b/.test(command)) {
    return "edit";
  }
  return "run";
}

function inferTimelineKind(toolName: string, input: unknown, workspaceDirectory?: string | null): TimelineKind {
  const name = toolName.toLowerCase();
  if (isTaskToolName(name)) {
    return "delegate";
  }
  if (name.includes("todo")) {
    return "todo";
  }
  if (name.includes("delete") || name.includes("remove")) {
    return "delete";
  }
  if (name.includes("create") || name.includes("mkdir") || name.includes("touch")) {
    return "create";
  }
  if (name.includes("write") || name.includes("edit") || name.includes("replace")) {
    return "edit";
  }
  if (name.includes("apply_patch")) {
    const patch = extractPatchTarget(input, workspaceDirectory);
    return patch ? mapPatchVerbToKind(patch.verb) : "edit";
  }
  if (name.includes("read")) {
    return "read";
  }
  if (name.includes("rg") || name.includes("grep") || name.includes("search") || name.includes("find")) {
    return "search";
  }
  if (name.includes("ls") || name.includes("list")) {
    return "list";
  }
  if (name.includes("git")) {
    return "git";
  }
  if (name.includes("exec_command") || name.includes("bash") || name.includes("run")) {
    const command = extractCommand(input);
    return command ? classifyCommandKind(command, workspaceDirectory) : "run";
  }
  return "run";
}

function describeSearchCommand(command: string, workspaceDirectory?: string | null) {
  const normalized = command.replace(/\s+/g, " ").trim();
  const patternMatch = normalized.match(/\b(?:rg|grep)\b(?:\s+-{1,2}[^\s]+\s+)*("([^"]+)"|'([^']+)'|([^\s]+))/);
  const pattern = (patternMatch?.[2] ?? patternMatch?.[3] ?? patternMatch?.[4] ?? "").replace(/^["']|["']$/g, "");
  const target = deriveTargetFromCommand(command, workspaceDirectory);
  if (pattern && target) {
    return `for: ${compactText(pattern, 42)} in ${target}`;
  }
  if (pattern) {
    return `for: ${compactText(pattern, 42)}`;
  }
  if (target) {
    return `in ${target}`;
  }
  return null;
}

function extractToolTarget(input: unknown, workspaceDirectory?: string | null): string | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseJsonObject(trimmed);
    if (parsed) {
      return extractToolTarget(parsed, workspaceDirectory);
    }
    return deriveTargetFromCommand(trimmed, workspaceDirectory);
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const target = extractToolTarget(value, workspaceDirectory);
      if (target) {
        return target;
      }
    }
    return null;
  }
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const prioritizedKeys = [
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
    "directory",
    "uri",
    "ref_id",
    "refId",
  ];

  for (const key of prioritizedKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return formatTarget(value, workspaceDirectory);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) {
          return formatTarget(item, workspaceDirectory);
        }
      }
    }
  }

  for (const value of Object.values(record)) {
    const nested = extractToolTarget(value, workspaceDirectory);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function toToolActivityLabel(toolName: string, status: string, input: unknown, workspaceDirectory?: string | null) {
  const name = toolName.toLowerCase();
  const isActive = isToolStatusActive(status);
  const isError = status === "error";
  const target = extractToolTarget(input, workspaceDirectory);
  const command = extractCommand(input);
  const commandPreview = extractCommandPreview(input, 72);
  const withTarget = (activeLabel: string, completedLabel: string, failedLabel = "Failed") => {
    if (target) {
      if (isActive) {
        return `${activeLabel} ${target}...`;
      }
      if (isError) {
        return `${failedLabel} ${target}`;
      }
      return `${completedLabel} ${target}`;
    }
    if (isActive) {
      return `${activeLabel}...`;
    }
    if (isError) {
      return failedLabel;
    }
    return completedLabel;
  };

  if (isTaskToolName(name)) {
    const task = extractTaskDelegationInfo(input);
    const agentLabel = task?.agent ? `@${task.agent}` : "subagent";
    const taskLabel = task?.description ? compactText(task.description, 56) : "delegated task";
    if (isActive) {
      return `Delegating ${taskLabel} to ${agentLabel}...`;
    }
    if (isError) {
      return `Delegation failed for ${agentLabel}`;
    }
    return `Delegated ${taskLabel} to ${agentLabel}`;
  }

  if (name.includes("todo")) {
    return isActive ? "Updating todo list..." : "Updated todo list";
  }
  if (name.includes("delete")) {
    return withTarget("Deleting", "Deleted");
  }
  if (name.includes("create") || name.includes("mkdir") || name.includes("touch")) {
    return withTarget("Creating", "Created");
  }
  if (name.includes("write")) {
    return withTarget("Writing", "Wrote");
  }
  if (name.includes("edit") || name.includes("replace")) {
    return withTarget("Editing", "Edited");
  }
  if (name.includes("rename") || name.includes("move")) {
    return withTarget("Moving", "Moved");
  }
  if (name.includes("apply_patch")) {
    const patch = extractPatchTarget(input, workspaceDirectory);
    if (patch) {
      if (isActive) {
        return `${patch.verb === "Deleted" ? "Deleting" : patch.verb === "Created" ? "Creating" : "Editing"} ${patch.target}...`;
      }
      if (isError) {
        return `Patch failed on ${patch.target}`;
      }
      return `${patch.verb} ${patch.target}`;
    }
    return isActive ? "Applying patch..." : isError ? "Patch failed" : "Applied patch";
  }
  if (name.includes("read")) {
    return withTarget("Reading", "Read");
  }
  if (name.includes("rg") || name.includes("grep") || name.includes("search") || name.includes("find")) {
    return withTarget("Searching", "Searched");
  }
  if (name.includes("ls") || name.includes("list")) {
    return withTarget("Scanning", "Scanned");
  }
  if (name.includes("exec_command") || name.includes("bash") || name.includes("run")) {
    const commandPatch = command ? extractPatchTarget(command, workspaceDirectory) : null;
    if (commandPatch) {
      if (isActive) {
        return `${commandPatch.verb === "Deleted" ? "Deleting" : commandPatch.verb === "Created" ? "Creating" : "Editing"} ${commandPatch.target}...`;
      }
      if (isError) {
        return `${commandPatch.verb} failed on ${commandPatch.target}`;
      }
      return `${commandPatch.verb} ${commandPatch.target}`;
    }
    const commandTarget = command ? deriveTargetFromCommand(command, workspaceDirectory) : null;
    if (command && /\b(rg|grep|find)\b/.test(command)) {
      const detail = describeSearchCommand(command, workspaceDirectory);
      return isActive
        ? `Searching ${detail ?? commandTarget ?? "workspace"}...`
        : `Searched ${detail ?? commandTarget ?? "workspace"}`;
    }
    if (command && /\b(cat|sed|head|tail|bat)\b/.test(command)) {
      return isActive
        ? `Reading ${commandTarget ?? "file"}...`
        : `Read ${commandTarget ?? "file"}`;
    }
    if (command && /\b(ls|tree|fd)\b/.test(command)) {
      return isActive ? "Scanning workspace..." : "Scanned workspace";
    }
    if (command && /\bgit\b/.test(command)) {
      return isActive ? "Checking git changes..." : "Checked git changes";
    }
    if (command && /\b(rm)\b/.test(command)) {
      return isActive
        ? `Deleting ${commandTarget ?? "files"}...`
        : `Deleted ${commandTarget ?? "files"}`;
    }
    if (command && /\b(mkdir|touch)\b/.test(command)) {
      return isActive
        ? `Creating ${commandTarget ?? "files"}...`
        : `Created ${commandTarget ?? "files"}`;
    }
    if (command && /\bmv\b/.test(command)) {
      return isActive
        ? `Moving ${commandTarget ?? "files"}...`
        : `Moved ${commandTarget ?? "files"}`;
    }
    if (command && /\bcp\b/.test(command)) {
      return isActive
        ? `Copying ${commandTarget ?? "files"}...`
        : `Copied ${commandTarget ?? "files"}`;
    }
    if (command && /\b(echo|printf)\b/.test(command) && commandTarget) {
      return isActive
        ? `Editing ${commandTarget}...`
        : `Edited ${commandTarget}`;
    }
    if (commandPreview) {
      return isActive ? `Running ${commandPreview}...` : `Ran ${commandPreview}`;
    }
    if (commandTarget) {
      return isActive ? `Running command on ${commandTarget}...` : `Ran command on ${commandTarget}`;
    }
    return isActive ? "Running command..." : "Ran command";
  }
  if (name.includes("git")) {
    return withTarget("Checking git", "Checked git");
  }
  if (target) {
    return isActive ? `Working on ${target}...` : `Ran on ${target}`;
  }
  return isActive ? "Working..." : "Ran command";
}

function modelLabel(model: { providerID: string; modelID: string } | undefined) {
  if (!model) {
    return undefined;
  }
  return `${model.providerID}/${model.modelID}`;
}

function toToolReason(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return "action";
  }
  if (normalized.includes("todo")) {
    return "todo update";
  }
  if (isTaskToolName(normalized)) {
    return "delegation";
  }
  if (normalized.includes("apply_patch")) {
    return "patch";
  }
  if (normalized.includes("read")) {
    return "read";
  }
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("grep") || normalized.includes("rg")) {
    return "search";
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("replace")) {
    return "edit";
  }
  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "delete";
  }
  if (normalized.includes("create") || normalized.includes("mkdir") || normalized.includes("touch")) {
    return "create";
  }
  if (normalized.includes("git")) {
    return "git check";
  }
  return normalized.replace(/[_-]+/g, " ");
}

function summarizeAssistantTelemetryPart(part: Part, actor?: string): InternalEvent | null {
  if (part.type === "step-start") {
    return { id: part.id, summary: "Step started", actor };
  }
  if (part.type === "step-finish") {
    const tokens = part.tokens;
    const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`;
    return { id: part.id, summary: "Step finished", details, actor };
  }
  if (part.type === "retry") {
    return { id: part.id, summary: `Retry attempt ${part.attempt}`, actor };
  }
  if (part.type === "compaction") {
    return { id: part.id, summary: "Context compaction", actor };
  }
  if (part.type === "snapshot") {
    return { id: part.id, summary: "Snapshot update", actor };
  }
  if (part.type === "text") {
    const text = part.text.trim();
    if (isLikelyTelemetryJson(text)) {
      const parsed = parseJsonObject(text);
      const summary = typeof parsed?.type === "string" ? parsed.type : "Telemetry event";
      return { id: part.id, summary, actor };
    }
  }
  return null;
}

function summarizeDelegationEvent(part: Part, actor?: string): InternalEvent | null {
  if (part.type === "step-start") {
    return { id: part.id, summary: "Step started", actor };
  }
  if (part.type === "step-finish") {
    const tokens = part.tokens;
    const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`;
    return { id: part.id, summary: "Step finished", details, actor };
  }
  if (part.type === "tool") {
    if (isTaskToolName(part.tool)) {
      const stateRecord = part.state as unknown as Record<string, unknown>;
      const output = typeof stateRecord.output === "string" ? stateRecord.output : "";
      const taskResult = output ? extractTaskResultText(output) : null;
      return {
        id: part.id,
        summary: `${part.tool} (${part.state.status})`,
        details: taskResult ?? undefined,
        actor,
      };
    }
    const stateRecord = part.state as unknown as Record<string, unknown>;
    const error = typeof stateRecord.error === "string" ? stateRecord.error : undefined;
    return {
      id: part.id,
      summary: `${part.tool} (${part.state.status})`,
      details: error,
      actor,
    };
  }
  if (part.type === "reasoning") {
    return { id: part.id, summary: "Reasoning update", actor };
  }
  if (part.type === "retry") {
    return { id: part.id, summary: `Retry attempt ${part.attempt}`, actor };
  }
  if (part.type === "compaction") {
    return { id: part.id, summary: "Context compaction", actor };
  }
  if (part.type === "snapshot") {
    return { id: part.id, summary: "Snapshot update", actor };
  }
  if (part.type === "patch") {
    return { id: part.id, summary: `Patch update (${part.files.length} files)`, actor };
  }
  if (part.type === "text") {
    const text = part.text.trim();
    if (isProgressUpdateText(text)) {
      return { id: part.id, summary: text.replace(/:\s*$/, ""), actor };
    }
    if (isLikelyTelemetryJson(text)) {
      const parsed = parseJsonObject(text);
      const summary = typeof parsed?.type === "string" ? parsed.type : "Telemetry event";
      return { id: part.id, summary, actor };
    }
  }
  return null;
}

function summarizeDelegationSessionMessages(messages: SessionMessageBundle[], workspaceDirectory?: string | null) {
  const events: InternalEvent[] = [];
  const sorted = [...messages].sort((a, b) => a.info.time.created - b.info.time.created);
  for (const bundle of sorted) {
    if (bundle.info.role !== "assistant") {
      continue;
    }
    for (const part of bundle.parts) {
      if (part.type === "text") {
        if (shouldHideAssistantText(part.text)) {
          continue;
        }
        const text = part.text.trim();
        if (!text) {
          continue;
        }
        events.push({
          id: `${bundle.info.id}:${part.id}:text`,
          summary: "assistant",
          details: text,
        });
        continue;
      }
      if (part.type === "tool") {
        const label = toToolActivityLabel(part.tool, part.state.status, part.state.input, workspaceDirectory);
        const toolEvent = summarizeDelegationEvent(part);
        events.push({
          id: `${bundle.info.id}:${part.id}:tool`,
          summary: label,
          details: toolEvent?.details,
        });
      }
    }
  }
  return events.slice(-28);
}

function classifyAssistantParts(parts: Part[], workspaceDirectory?: string | null) {
  const visible: Part[] = [];
  const internal: InternalEvent[] = [];
  const delegations: DelegationTrace[] = [];
  const timeline: TimelineEvent[] = [];
  let activity: ActivityEvent | null = null;
  let currentActor = "Main agent";
  let activeDelegation: DelegationTrace | null = null;

  for (const part of parts) {
    if (part.type === "subtask") {
      const trace: DelegationTrace = {
        id: part.id,
        agent: part.agent,
        description: part.description,
        prompt: part.prompt,
        modelLabel: modelLabel(part.model),
        command: part.command,
        events: [],
      };
      delegations.push(trace);
      activeDelegation = trace;
      currentActor = part.agent;
      activity = {
        id: `${part.id}:activity`,
        label: `Delegating to ${part.agent}...`,
      };
      timeline.push({
        id: `${part.id}:timeline`,
        label: `Delegated to ${part.agent}: ${part.description}`,
        kind: "delegate",
      });
      continue;
    }

    if (part.type === "text") {
      if (shouldHideAssistantText(part.text)) {
        const telemetryEvent = summarizeAssistantTelemetryPart(part, currentActor);
        if (telemetryEvent) {
          internal.push(telemetryEvent);
        }
        if (activeDelegation) {
          const delegationEvent = summarizeDelegationEvent(part, currentActor);
          if (delegationEvent) {
            activeDelegation.events.push(delegationEvent);
          }
        }
        continue;
      }
      visible.push(part);
      continue;
    }

    if (part.type === "file") {
      visible.push(part);
      continue;
    }

    if (part.type === "tool") {
      const status = part.state.status;
      const stateTitle = "title" in part.state && typeof part.state.title === "string" ? part.state.title.trim() : "";
      let label = toToolActivityLabel(part.tool, status, part.state.input, workspaceDirectory);
      if ((label === "Ran command" || label === "Running command...") && stateTitle) {
        label = isToolStatusActive(status) ? `Running ${compactText(stateTitle, 72)}...` : `Ran ${compactText(stateTitle, 72)}`;
      }
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
      const toolName = part.tool.trim().toLowerCase();
      const taskDelegation = isTaskToolName(toolName)
        ? extractTaskDelegationInfo(part.state.input, "metadata" in part.state ? part.state.metadata : undefined)
        : null;
      if (taskDelegation) {
        const outputSessionID = "output" in part.state ? extractTaskSessionIDFromOutput(part.state.output) : undefined;
        const delegationTrace: DelegationTrace = {
          id: `task:${part.id}`,
          agent: taskDelegation.agent,
          description: taskDelegation.description,
          prompt: taskDelegation.prompt,
          modelLabel: taskDelegation.modelLabel,
          command: taskDelegation.command,
          sessionID: taskDelegation.sessionID ?? outputSessionID,
          events: [],
        };
        delegations.push(delegationTrace);
        activeDelegation = delegationTrace;
        currentActor = taskDelegation.agent;
      }
      if (isToolStatusActive(status)) {
        activity = {
          id: `${part.id}:activity`,
          label,
        };
      } else {
        const showReason = kind === "create" || kind === "delete";
        const showCommand = kind !== "read" && kind !== "search" && kind !== "list" && kind !== "todo";
        const command = showCommand
          ? extractCommandPreview(part.state.input) ?? (stateTitle ? compactText(stateTitle, 92) : null)
          : null;
        timeline.push({
          id: `${part.id}:timeline`,
          label,
          kind,
          reason: showReason ? `Why this changed: ${currentActor} via ${toToolReason(part.tool)}` : undefined,
          command: command ?? undefined,
        });
      }
    }

    const telemetryEvent = summarizeAssistantTelemetryPart(part, currentActor);
    if (telemetryEvent) {
      internal.push(telemetryEvent);
    }

    if (activeDelegation) {
      const delegationEvent = summarizeDelegationEvent(part, currentActor);
      if (delegationEvent) {
        activeDelegation.events.push(delegationEvent);
      }
    }

    if (part.type === "agent") {
      currentActor = part.name;
      activity = {
        id: `${part.id}:activity`,
        label: `Switched to ${part.name}`,
      };
    }
  }

  return { visible, internal, delegations, timeline, activity };
}

function renderPart(part: Part) {
  if (part.type === "text") {
    return <pre className="part-text">{part.text}</pre>;
  }

  if (part.type === "file") {
    return <div className="part-file">Attached file: {part.filename ?? part.url}</div>;
  }
  return null;
}

export function MessageFeed({
  messages,
  showAssistantPlaceholder = false,
  assistantLabel = "Orxa",
  workspaceDirectory,
  bottomClearance = 24,
}: Props) {
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(null);
  const [thinkingDots, setThinkingDots] = useState(3);
  const [delegationSessionEvents, setDelegationSessionEvents] = useState<InternalEvent[]>([]);
  const [delegationSessionLoading, setDelegationSessionLoading] = useState(false);
  const [delegationSessionError, setDelegationSessionError] = useState<string | null>(null);
  const messageFeedStyle = useMemo(
    () =>
      ({
        "--message-feed-bottom-clearance": `${Math.max(24, Math.round(bottomClearance))}px`,
      }) as CSSProperties,
    [bottomClearance],
  );
  const { renderedMessages, liveInternalEvents, liveDelegations, latestActivity } = useMemo(() => {
    if (messages.length === 0) {
      return {
        renderedMessages: [] as Array<{ key: string; role: string; timeCreated: number; visibleParts: Part[]; timeline: TimelineEvent[] }>,
        liveInternalEvents: [] as InternalEvent[],
        liveDelegations: [] as DelegationTrace[],
        latestActivity: null as ActivityEvent | null,
      };
    }
    let nextInternalEvents: InternalEvent[] = [];
    let nextDelegations: DelegationTrace[] = [];
    let latestActivity: ActivityEvent | null = null;
    const nextMessages = messages.map((bundle, messageIndex) => {
      const message = bundle.info;
      const role = message.role;
      const assistantClassification = role === "assistant" ? classifyAssistantParts(bundle.parts, workspaceDirectory) : undefined;
      const visibleParts = assistantClassification?.visible ?? getVisibleParts(role, bundle.parts);
      if (role === "assistant" && assistantClassification) {
        nextInternalEvents = assistantClassification.internal;
        nextDelegations = assistantClassification.delegations;
        latestActivity = assistantClassification.activity;
      }

      return {
        key: `${message.id}:${message.time.created}:${messageIndex}`,
        role,
        timeCreated: message.time.created,
        visibleParts,
        timeline: assistantClassification?.timeline ?? [],
      };
    });

    return {
      renderedMessages: nextMessages,
      liveInternalEvents: nextInternalEvents,
      liveDelegations: nextDelegations,
      latestActivity,
    };
  }, [messages, workspaceDirectory]);

  const selectedDelegation = useMemo(
    () => liveDelegations.find((item) => item.id === selectedDelegationId) ?? null,
    [liveDelegations, selectedDelegationId],
  );
  const selectedDelegationEvents = useMemo(() => {
    if (!selectedDelegation) {
      return [];
    }
    return [...selectedDelegation.events, ...delegationSessionEvents];
  }, [selectedDelegation, delegationSessionEvents]);

  useEffect(() => {
    if (!selectedDelegationId) {
      return;
    }
    if (!liveDelegations.some((item) => item.id === selectedDelegationId)) {
      setSelectedDelegationId(null);
    }
  }, [liveDelegations, selectedDelegationId]);

  useEffect(() => {
    if (!selectedDelegation) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedDelegationId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedDelegation]);

  useEffect(() => {
    if (!selectedDelegation?.sessionID || !workspaceDirectory) {
      setDelegationSessionEvents([]);
      setDelegationSessionLoading(false);
      setDelegationSessionError(null);
      return;
    }
    const bridge = window.orxa?.opencode;
    if (!bridge?.loadMessages) {
      setDelegationSessionEvents([]);
      setDelegationSessionLoading(false);
      setDelegationSessionError(null);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      if (cancelled) {
        return;
      }
      setDelegationSessionLoading(true);
      try {
        const bundles = await bridge.loadMessages(workspaceDirectory, selectedDelegation.sessionID!);
        if (cancelled) {
          return;
        }
        setDelegationSessionEvents(summarizeDelegationSessionMessages(bundles, workspaceDirectory));
        setDelegationSessionError(null);
      } catch (error) {
        if (!cancelled) {
          setDelegationSessionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setDelegationSessionLoading(false);
        }
      }
    };

    void load();
    timer = window.setInterval(() => {
      void load();
    }, 1300);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [selectedDelegation?.sessionID, workspaceDirectory]);

  useEffect(() => {
    if (!showAssistantPlaceholder) {
      setThinkingDots(3);
      return;
    }
    const timer = window.setInterval(() => {
      setThinkingDots((current) => (current <= 1 ? 3 : current - 1));
    }, 420);
    return () => {
      window.clearInterval(timer);
    };
  }, [showAssistantPlaceholder]);

  return (
    <div className="messages-scroll" style={messageFeedStyle}>
      {renderedMessages.length === 0 ? <div className="messages-empty">No messages yet. Start by sending a prompt.</div> : null}
      {renderedMessages.map((message) => {
        const { key, role, timeCreated, visibleParts, timeline } = message;
        const timelineBlocks = buildTimelineBlocks(timeline);
        if (visibleParts.length === 0 && timeline.length === 0) {
          return null;
        }
        return (
          <article key={key} className={`message-card message-${role}`}>
            <header className="message-header">
              <span className="message-role">{getRoleLabel(role, assistantLabel)}</span>
              <span className="message-time">{new Date(timeCreated).toLocaleTimeString()}</span>
            </header>
            <div className="message-parts">
              {visibleParts.map((part, partIndex) => (
                <section key={`${part.id}:${partIndex}`} className="message-part">
                  {renderPart(part)}
                </section>
              ))}
              {timeline.length > 0 ? (
                <section className="message-timeline">
                  {timelineBlocks.map((block) =>
                    block.type === "exploration" ? (
                      <details key={block.id} className="message-exploration">
                        <summary className="message-exploration-summary">{block.summary}</summary>
                        <div className="message-exploration-entries">
                          {block.entries.map((entry) => (
                            <span key={entry.id} className="message-exploration-entry">
                              {entry.label}
                            </span>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <div key={block.id} className="message-timeline-row">
                        <span className="message-timeline-row-label">{block.entry.label}</span>
                        {block.entry.command ? <small className="message-timeline-row-command">Command: {block.entry.command}</small> : null}
                        {block.entry.reason ? <small className="message-timeline-row-reason">{block.entry.reason}</small> : null}
                      </div>
                    ),
                  )}
                </section>
              ) : null}
            </div>
          </article>
        );
      })}
      {showAssistantPlaceholder && renderedMessages.length > 0 ? (
        <article className="message-card message-assistant">
          <header className="message-header">
            <span className="message-role">{assistantLabel}</span>
            <span className="message-time">{new Date().toLocaleTimeString()}</span>
          </header>
          <div className="message-parts">
            <section className="message-part thinking-panel">
              <pre className="part-text message-thinking">
                Thinking{".".repeat(thinkingDots)}
              </pre>
              {latestActivity ? (
                <p className="thinking-activity">{latestActivity.label}</p>
              ) : null}
              {liveDelegations.length > 0 ? (
                <div className="delegation-bubbles">
                  {liveDelegations.map((delegation) => (
                    <button
                      key={delegation.id}
                      type="button"
                      className="delegation-bubble"
                      onClick={() => setSelectedDelegationId(delegation.id)}
                    >
                      <span className="delegation-bubble-agent">{delegation.agent}</span>
                      <span className="delegation-bubble-task">{delegation.description}</span>
                      {delegation.modelLabel ? <small>{delegation.modelLabel}</small> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {liveInternalEvents.length > 0 ? (
                <details className="thinking-events" open>
                  <summary>Live events ({liveInternalEvents.length})</summary>
                  <ul className="thinking-events-list">
                    {liveInternalEvents.map((event, eventIndex) => (
                      <li key={event.id}>
                        {event.actor ? <strong>{event.actor}</strong> : null}
                        <span>{event.summary}</span>
                        {event.details ? <small>{event.details}</small> : null}
                        {eventIndex < liveInternalEvents.length - 1 ? <span className="thinking-event-divider" aria-hidden="true" /> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          </div>
        </article>
      ) : null}
      {selectedDelegation ? (
        <div className="overlay delegation-modal-overlay" onClick={() => setSelectedDelegationId(null)}>
          <section
            className="modal delegation-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Delegation: ${selectedDelegation.agent}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <h2>{selectedDelegation.agent}</h2>
              <button type="button" onClick={() => setSelectedDelegationId(null)}>
                Close
              </button>
            </header>
            <div className="delegation-modal-body">
              <p>{selectedDelegation.description}</p>
              {selectedDelegation.modelLabel ? <small>Model: {selectedDelegation.modelLabel}</small> : null}
              {selectedDelegation.command ? <small>Command: {selectedDelegation.command}</small> : null}
              <details>
                <summary>Task prompt</summary>
                <pre className="part-text">{selectedDelegation.prompt}</pre>
              </details>
              <div className="delegation-modal-events">
                <h3>Live output</h3>
                {selectedDelegationEvents.length === 0 ? (
                  <p>No live output yet.</p>
                ) : (
                  <ul>
                    {selectedDelegationEvents.map((event) => (
                      <li key={event.id}>
                        <span>{event.summary}</span>
                        {event.details ? <pre className="delegation-event-details">{event.details}</pre> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {delegationSessionLoading ? <p>Fetching subagent session...</p> : null}
                {delegationSessionError ? <p>{delegationSessionError}</p> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
