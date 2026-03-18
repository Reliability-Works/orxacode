import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { SessionMessageBundle } from "@shared/ipc";
import { ToolCallCard, type ToolCallStatus } from "./chat/ToolCallCard";
import { ToolGroup } from "./chat/ToolGroup";
import { ThinkingShimmer } from "./chat/ThinkingShimmer";
import { TextPart } from "./chat/TextPart";
import { MessageHeader } from "./chat/MessageHeader";
import { MessageTurn } from "./chat/MessageTurn";
import {
  extractMetaFileDiffSummary,
  extractPatchSummary,
  extractWriteFileSummary,
} from "../lib/message-feed-patch-summary";
import {
  buildDelegationEventBlocks,
  buildTimelineBlocks,
  pluralize,
  type InternalEvent,
  type TimelineEvent,
  type TimelineKind,
} from "../lib/message-feed-timeline";
import {
  countOrxaMemoryLines,
  extractVisibleText,
  getVisibleParts,
  isLikelyTelemetryJson,
  isProgressUpdateText,
  parseJsonObject,
  parseOrxaBrowserResultText,
  parseSupermemoryInternalText,
  shouldHideAssistantText,
  summarizeOrxaBrowserActionText,
} from "../lib/message-feed-visibility";
import { DelegationEventBlocks, MessageTimelineBlocks } from "./message-feed/TimelineBlocks";

type Props = {
  messages: SessionMessageBundle[];
  sessionNotices?: SessionFeedNotice[];
  showAssistantPlaceholder?: boolean;
  assistantLabel?: string;
  workspaceDirectory?: string | null;
  bottomClearance?: number;
};

type SessionFeedNotice = {
  id: string;
  time: number;
  label: string;
  detail?: string;
  tone?: "info" | "error";
};

type ActivityEvent = {
  id: string;
  label: string;
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

function isLikelyShellCommand(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^loaded skill:/i.test(trimmed)) {
    return false;
  }
  if (/[;&|><`$]/.test(trimmed)) {
    return true;
  }
  return /^(pnpm|npm|yarn|bun|node|git|ls|cat|sed|rg|grep|find|mkdir|touch|mv|cp|rm|echo|printf|bash|zsh|sh)\b/i.test(trimmed);
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

function isBareCommandLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return normalized === "ran command" || normalized.startsWith("ran command on ");
}

function isLowSignalCompletedLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return normalized === "completed action" || normalized.startsWith("completed action on ");
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

function toToolActivityLabel(
  toolName: string,
  status: string,
  input: unknown,
  workspaceDirectory?: string | null,
  metadata?: unknown,
  output?: unknown,
) {
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
    const writeSummary = extractWriteFileSummary(input, metadata, workspaceDirectory);
    if (isActive) {
      return writeSummary ? `Writing ${writeSummary.summary}...` : "Writing...";
    }
    if (isError) {
      return writeSummary ? `Failed ${writeSummary.summary}` : "Write failed";
    }
    if (writeSummary) {
      return `${writeSummary.verb} ${writeSummary.summary}`;
    }
    return withTarget("Writing", "Edited", "Write failed");
  }
  if (name.includes("edit") || name.includes("replace")) {
    const filediffSummary = extractMetaFileDiffSummary(metadata, workspaceDirectory);
    if (!isActive && !isError && filediffSummary) {
      return `Edited ${filediffSummary}`;
    }
    return withTarget("Editing", "Edited");
  }
  if (name.includes("rename") || name.includes("move")) {
    return withTarget("Moving", "Moved");
  }
  if (name.includes("apply_patch")) {
    const patch = extractPatchTarget(input, workspaceDirectory);
    const patchSummary = extractPatchSummary(input, output, workspaceDirectory) ?? extractMetaFileDiffSummary(metadata, workspaceDirectory);
    if (patch) {
      if (isActive) {
        return `${patch.verb === "Deleted" ? "Deleting" : patch.verb === "Created" ? "Creating" : "Editing"} ${patch.target}...`;
      }
      if (isError) {
        return patchSummary ? `Patch failed on ${patch.target} (${patchSummary})` : `Patch failed on ${patch.target}`;
      }
      return patchSummary ? `${patch.verb} ${patchSummary}` : `${patch.verb} ${patch.target}`;
    }
    if (patchSummary) {
      return isActive ? `Applying patch (${patchSummary})...` : isError ? `Patch failed (${patchSummary})` : `Applied patch ${patchSummary}`;
    }
    return isActive ? "Applying patch..." : isError ? "Patch failed" : "Applied patch";
  }
  if (name.includes("read")) {
    return withTarget("Reading", "Read");
  }
  if (name.includes("rg") || name.includes("grep") || name.includes("search") || name.includes("find")) {
    return withTarget("Searching", "Searched", "Search failed");
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
    if (commandPreview && /^loaded skill:/i.test(commandPreview)) {
      return isActive ? `Loading ${compactText(commandPreview.replace(/^loaded skill:/i, "skill"), 72)}...` : commandPreview;
    }
    if (commandPreview && !isLikelyShellCommand(commandPreview)) {
      return isActive ? `${compactText(commandPreview, 72)}...` : compactText(commandPreview, 92);
    }
    if (commandPreview) {
      return isActive ? `Running ${commandPreview}...` : `Ran ${commandPreview}`;
    }
    if (commandTarget) {
      return isActive ? `Running command...` : "Ran command";
    }
    return isActive ? "Running command..." : "Ran command";
  }
  if (name.includes("git")) {
    return withTarget("Checking git", "Checked git");
  }
  if (target) {
    return isActive ? `Working on ${target}...` : `Completed action on ${target}`;
  }
  return isActive ? "Working..." : "Completed action";
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
    const auto = part.auto !== false;
    return {
      id: part.id,
      summary: auto ? "Automatic context compaction" : "Manual context compaction",
      details: auto ? "Summarized conversation state to recover context." : "Manual summarize/compaction requested.",
      actor,
    };
  }
  if (part.type === "snapshot") {
    return { id: part.id, summary: "Snapshot update", actor };
  }
  if (part.type === "text") {
    const text = part.text.trim();
    const browserActionSummary = summarizeOrxaBrowserActionText(text);
    if (browserActionSummary) {
      return { id: part.id, summary: browserActionSummary, actor };
    }
    const memoryLineCount = countOrxaMemoryLines(text);
    if (memoryLineCount > 0) {
      return {
        id: part.id,
        summary: `Captured ${pluralize(memoryLineCount, "memory item")}`,
        actor,
      };
    }
    if (isLikelyTelemetryJson(text)) {
      const parsed = parseJsonObject(text);
      const summary = typeof parsed?.type === "string" ? parsed.type : "Telemetry event";
      return { id: part.id, summary, actor };
    }
  }
  return null;
}

function summarizeInternalUserPart(part: Part): InternalEvent | null {
  if (part.type !== "text") {
    return null;
  }
  const supermemoryPayload = parseSupermemoryInternalText(part.text.trim());
  if (supermemoryPayload !== null) {
    return {
      id: part.id,
      summary: "Applied in-app memory context",
      details: supermemoryPayload.length > 0 ? compactText(supermemoryPayload, 220) : undefined,
    };
  }
  const parsed = parseOrxaBrowserResultText(part.text.trim());
  if (!parsed) {
    return null;
  }
  const actionLabel = parsed.action && parsed.action.length > 0 ? parsed.action : "action";
  const summary =
    parsed.ok
      ? actionLabel === "screenshot"
        ? "Captured browser screenshot"
        : `Completed browser action: ${actionLabel}`
      : `Browser action failed: ${actionLabel}`;
  const details = parsed.ok
    ? undefined
    : parsed.error || parsed.blockedReason || "Browser action failed";
  return {
    id: part.id,
    summary,
    details,
  };
}

function summarizeDelegationEvent(part: Part, actor?: string, workspaceDirectory?: string | null): InternalEvent | null {
  if (part.type === "step-start") {
    return { id: part.id, summary: "Step started", actor };
  }
  if (part.type === "step-finish") {
    const tokens = part.tokens;
    const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`;
    return { id: part.id, summary: "Step finished", details, actor };
  }
  if (part.type === "tool") {
    const stateRecord = part.state as unknown as Record<string, unknown>;
    const stateMetadata = stateRecord.metadata;
    const stateOutput = stateRecord.output;
    const status = part.state.status;
    const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
    const isCommandTool =
      part.tool.trim().toLowerCase().includes("exec_command") ||
      part.tool.trim().toLowerCase().includes("bash") ||
      part.tool.trim().toLowerCase().includes("run");
    const showCommand = (isCommandTool && kind !== "read" && kind !== "search" && kind !== "list" && kind !== "todo") || kind === "run" || kind === "git";
    const commandPreview = showCommand ? extractCommandPreview(part.state.input) : null;
    const command = commandPreview && isLikelyShellCommand(commandPreview) ? commandPreview : undefined;
    const failure = status === "error" ? (typeof stateRecord.error === "string" ? compactText(stateRecord.error, 220) : "Tool execution failed") : undefined;
    let label = toToolActivityLabel(part.tool, status, part.state.input, workspaceDirectory, stateMetadata, stateOutput);

    if (part.tool.trim().toLowerCase().includes("apply_patch") || part.tool.trim().toLowerCase().includes("patch")) {
      const patchSummary = extractPatchSummary(stateRecord.input, stateRecord.output, workspaceDirectory) ?? extractMetaFileDiffSummary(stateMetadata, workspaceDirectory);
      if (patchSummary && /applied patch$/i.test(label.trim())) {
        label = `${label} ${patchSummary}`;
      }
    }

    if (kind === "run" && !command && !failure && isBareCommandLabel(label)) {
      return null;
    }
    if (isLowSignalCompletedLabel(label) && !command && !failure) {
      return null;
    }

    if (isTaskToolName(part.tool)) {
      const output = typeof stateRecord.output === "string" ? stateRecord.output : "";
      const taskResult = output ? extractTaskResultText(output) : null;
      return {
        id: part.id,
        summary: label,
        details: taskResult ?? undefined,
        actor,
        kind,
        command,
        failure,
      };
    }
    return {
      id: part.id,
      summary: label,
      details: failure,
      actor,
      kind,
      command,
      failure,
    };
  }
  if (part.type === "reasoning") {
    return { id: part.id, summary: "Reasoning update", actor };
  }
  if (part.type === "retry") {
    return { id: part.id, summary: `Retry attempt ${part.attempt}`, actor };
  }
  if (part.type === "compaction") {
    const auto = part.auto !== false;
    return {
      id: part.id,
      summary: auto ? "Automatic context compaction" : "Manual context compaction",
      details: auto ? "Summarized conversation state to recover context." : "Manual summarize/compaction requested.",
      actor,
    };
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
          summary: compactText(text, 220),
          details: text.length > 220 ? text : undefined,
        });
        continue;
      }
      if (part.type === "tool") {
        const stateRecord = part.state as unknown as Record<string, unknown>;
        const stateMetadata = stateRecord.metadata;
        const stateOutput = stateRecord.output;
        const stateError = typeof stateRecord.error === "string" ? stateRecord.error : undefined;
        const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
        const isCommandTool =
          part.tool.trim().toLowerCase().includes("exec_command") ||
          part.tool.trim().toLowerCase().includes("bash") ||
          part.tool.trim().toLowerCase().includes("run");
        const showCommand =
          (isCommandTool && kind !== "read" && kind !== "search" && kind !== "list" && kind !== "todo") ||
          kind === "run" ||
          kind === "git";
        const commandPreview = showCommand ? extractCommandPreview(part.state.input) : null;
        const command = commandPreview && isLikelyShellCommand(commandPreview) ? commandPreview : undefined;
        const failure = part.state.status === "error" ? compactText(stateError ?? "Tool execution failed", 220) : undefined;
        let label = toToolActivityLabel(part.tool, part.state.status, part.state.input, workspaceDirectory, stateMetadata, stateOutput);
        const toolName = part.tool.trim().toLowerCase();
        if (toolName.includes("apply_patch") || toolName.includes("patch")) {
          const summary = extractPatchSummary(stateRecord.input, stateRecord.output, workspaceDirectory) ?? extractMetaFileDiffSummary(stateMetadata, workspaceDirectory);
          if (summary) {
            if (part.state.status === "completed") {
              label = `Applied patch ${summary}`;
            } else if (/applied patch/i.test(label)) {
              label = `${label} ${summary}`;
            } else {
              label = `${label} (${summary})`;
            }
          }
        }
        if (kind === "run" && !command && !failure && isBareCommandLabel(label)) {
          continue;
        }
        if (isLowSignalCompletedLabel(label) && !command && !failure) {
          continue;
        }
        events.push({
          id: `${bundle.info.id}:${part.id}:tool`,
          summary: label,
          details: failure,
          kind,
          command,
          failure,
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
          const delegationEvent = summarizeDelegationEvent(part, currentActor, workspaceDirectory);
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
      const stateRecord = part.state as unknown as Record<string, unknown>;
      const stateMetadata = stateRecord.metadata;
      const stateOutput = stateRecord.output;
      const stateError = typeof stateRecord.error === "string" ? stateRecord.error : undefined;
      let label = toToolActivityLabel(part.tool, status, part.state.input, workspaceDirectory, stateMetadata, stateOutput);
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
      const toolName = part.tool.trim().toLowerCase();
      const isCommandTool = toolName.includes("exec_command") || toolName.includes("bash") || toolName.includes("run");
      const explicitCommand = extractCommand(part.state.input);
      const explicitCommandPreview = extractCommandPreview(part.state.input, 92);
      const explicitCommandLooksNarrative =
        Boolean(explicitCommandPreview) &&
        !isLikelyShellCommand(explicitCommandPreview ?? "") &&
        (stateTitle.length === 0 || explicitCommandPreview?.toLowerCase() === stateTitle.toLowerCase());
      const hasExplicitCommand = Boolean(explicitCommand) && !explicitCommandLooksNarrative;
      const hasNarrativeTitle =
        isCommandTool &&
        kind === "run" &&
        stateTitle.length > 0 &&
        (!hasExplicitCommand || explicitCommandLooksNarrative) &&
        !isLikelyShellCommand(stateTitle);
      if (hasNarrativeTitle) {
        if (isToolStatusActive(status)) {
          label = `${compactText(stateTitle, 72)}...`;
        } else if (status === "error") {
          label = `Failed ${compactText(stateTitle, 92)}`;
        } else {
          label = compactText(stateTitle, 92);
        }
      } else if ((isBareCommandLabel(label) || label === "Running command...") && stateTitle) {
        label = isToolStatusActive(status) ? `Running ${compactText(stateTitle, 72)}...` : `Ran ${compactText(stateTitle, 72)}`;
      }
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
        const showCommand = (isCommandTool && kind !== "read" && kind !== "search" && kind !== "list" && kind !== "todo") || kind === "run" || kind === "git";
        const commandPreview = showCommand
          ? extractCommandPreview(part.state.input) ??
            (kind === "run" && !hasExplicitCommand && stateTitle && isLikelyShellCommand(stateTitle)
              ? compactText(stateTitle, 92)
              : null)
          : null;
        const command = commandPreview && isLikelyShellCommand(commandPreview) ? commandPreview : null;
        if (kind === "run" && !command && !stateError && isBareCommandLabel(label)) {
          continue;
        }
        if (isLowSignalCompletedLabel(label) && !command && !stateError) {
          continue;
        }
        timeline.push({
          id: `${part.id}:timeline`,
          label,
          kind,
          reason: showReason ? `Why this changed: ${currentActor} via ${toToolReason(part.tool)}` : undefined,
          command: command ?? undefined,
          failure: status === "error" ? (stateError ? compactText(stateError, 220) : "Tool execution failed") : undefined,
        });
      }
    }

    // Use reasoning summary to enhance the thinking shimmer label, not as visible content.
    // Reasoning is only shown transiently via the animated placeholder during streaming.
    if (part.type === "reasoning") {
      const record = part as unknown as Record<string, unknown>;
      const summary = typeof record.summary === "string" ? record.summary : typeof record.text === "string" ? record.text : "";
      if (summary) {
        const trimmed = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
        activity = { id: `${part.id}:activity`, label: `Thinking  ${trimmed}` };
      }
      continue;
    }

    const telemetryEvent = summarizeAssistantTelemetryPart(part, currentActor);
    if (telemetryEvent) {
      internal.push(telemetryEvent);
    }

    if (activeDelegation) {
      const delegationEvent = summarizeDelegationEvent(part, currentActor, workspaceDirectory);
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

function mapToolStateStatus(status: string): ToolCallStatus {
  if (status === "completed") return "completed";
  if (status === "error") return "error";
  if (status === "running") return "running";
  return "pending";
}

function buildToolCallCardProps(part: Part & { type: "tool" }, workspaceDirectory?: string | null) {
  const stateRecord = part.state as unknown as Record<string, unknown>;
  const stateTitle = "title" in part.state && typeof part.state.title === "string" ? part.state.title.trim() : "";
  const status = mapToolStateStatus(part.state.status);
  const toolName = part.tool.trim().toLowerCase();
  const isCommandTool = toolName.includes("exec_command") || toolName.includes("bash") || toolName.includes("run");
  const stateOutput = typeof stateRecord.output === "string" ? stateRecord.output : undefined;
  const stateError = typeof stateRecord.error === "string" ? stateRecord.error : undefined;
  const explicitCommand = extractCommand(part.state.input);
  const title = stateTitle || toToolActivityLabel(part.tool, part.state.status, part.state.input, workspaceDirectory, stateRecord.metadata, stateRecord.output);
  const command = (isCommandTool && explicitCommand && isLikelyShellCommand(explicitCommand)) ? explicitCommand : undefined;
  const output = stateOutput || undefined;
  const error = status === "error" ? (stateError ?? "Tool execution failed") : undefined;
  return { title, status, command, output, error };
}

function renderToolParts(parts: Part[], workspaceDirectory?: string | null) {
  // Don't render individual ToolCallCards at all.
  // Active tools are represented by the ThinkingShimmer placeholder.
  // Completed/error tools are shown in the timeline system.
  void parts;
  void workspaceDirectory;
  const toolParts: Array<Part & { type: "tool" }> = [];
  if (toolParts.length === 0) {
    return null;
  }
  const cards = toolParts.map((part) => {
    const props = buildToolCallCardProps(part, workspaceDirectory);
    return <ToolCallCard key={part.id} {...props} />;
  });
  if (toolParts.length >= 3) {
    return <ToolGroup items={cards} count={toolParts.length} defaultCollapsed />;
  }
  return <>{cards}</>;
}

function ReasoningRow({ part }: { part: Part }) {
  const [expanded, setExpanded] = useState(false);
  const record = part as unknown as Record<string, unknown>;
  const content = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
  const summary = typeof record.summary === "string" ? record.summary : "";
  const summaryText = summary || (content ? content.slice(0, 80) + (content.length > 80 ? "..." : "") : "...");
  const hasContent = content.trim().length > 0;

  return (
    <div className="thinking-row">
      <button
        type="button"
        className="thinking-row-header"
        onClick={() => hasContent && setExpanded((v) => !v)}
        disabled={!hasContent}
      >
        <span className="thinking-row-chevron" aria-hidden="true">
          {hasContent ? (expanded ? "▾" : "›") : ""}
        </span>
        <span className="thinking-label">Thinking</span>
        <span className="thinking-summary">{summaryText}</span>
      </button>
      {expanded && hasContent ? (
        <div className="thinking-row-content">
          <pre className="thinking-row-text">{content}</pre>
        </div>
      ) : null}
    </div>
  );
}

function renderPart(part: Part, role?: string, showCopy?: boolean) {
  if (part.type === "text") {
    return (
      <TextPart
        content={part.text}
        role={role === "user" || role === "assistant" ? role : undefined}
        showCopy={showCopy && role === "assistant"}
      />
    );
  }

  if (part.type === "reasoning") {
    return <ReasoningRow part={part} />;
  }

  if (part.type === "file") {
    return <div className="part-file">Attached file: {part.filename ?? part.url}</div>;
  }
  return null;
}

function CopyMessageButton({ parts }: { parts: Part[] }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const text = extractVisibleText(parts);
    if (!text || !navigator.clipboard?.writeText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1500);
    } catch {
      // Clipboard write failed silently
    }
  }, [parts]);

  return (
    <button
      type="button"
      className="message-copy-btn"
      aria-label={copied ? "Copied" : "Copy message"}
      onClick={handleCopy}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function MessageFeed({
  messages,
  sessionNotices = [],
  showAssistantPlaceholder = false,
  assistantLabel = "Orxa",
  workspaceDirectory,
  bottomClearance = 24,
}: Props) {
  const messageFeedRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [selectedDelegationId, setSelectedDelegationId] = useState<string | null>(null);
  const [delegationSessionEvents, setDelegationSessionEvents] = useState<InternalEvent[]>([]);
  const [delegationSessionLoading, setDelegationSessionLoading] = useState(false);
  const [delegationSessionError, setDelegationSessionError] = useState<string | null>(null);
  const [delegationOverlayBounds, setDelegationOverlayBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const messageFeedStyle = useMemo(
    () =>
      ({
        "--message-feed-bottom-clearance": `${Math.max(24, Math.round(bottomClearance))}px`,
      }) as CSSProperties,
    [bottomClearance],
  );
  const { renderedMessages, liveDelegations, latestActivity } = useMemo(() => {
    if (messages.length === 0) {
      return {
        renderedMessages: [] as Array<{ key: string; role: string; timeCreated: number; visibleParts: Part[]; toolParts: Part[]; timeline: TimelineEvent[] }>,
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
      const toolParts = role === "assistant" ? bundle.parts.filter((part) => part.type === "tool") : [];
      if (role === "user") {
        const userEvents = bundle.parts
          .map((part) => summarizeInternalUserPart(part))
          .filter((event): event is InternalEvent => Boolean(event));
        if (userEvents.length > 0) {
          nextInternalEvents = [...nextInternalEvents, ...userEvents].slice(-28);
        }
      }
      if (role === "assistant" && assistantClassification) {
        nextInternalEvents = [...nextInternalEvents, ...assistantClassification.internal].slice(-28);
        nextDelegations = assistantClassification.delegations;
        latestActivity = assistantClassification.activity;
      }

      return {
        key: `${message.id}:${message.time.created}:${messageIndex}`,
        role,
        timeCreated: message.time.created,
        visibleParts,
        toolParts,
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
  const selectedDelegationEventBlocks = useMemo(
    () => buildDelegationEventBlocks(selectedDelegationEvents),
    [selectedDelegationEvents],
  );
  const delegationOverlayStyle = useMemo(() => {
    if (!delegationOverlayBounds) {
      return undefined;
    }
    return {
      top: `${delegationOverlayBounds.top}px`,
      left: `${delegationOverlayBounds.left}px`,
      width: `${delegationOverlayBounds.width}px`,
      height: `${delegationOverlayBounds.height}px`,
    } as CSSProperties;
  }, [delegationOverlayBounds]);

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
        event.preventDefault();
        event.stopPropagation();
        setSelectedDelegationId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
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
    const load = async (showLoading = false) => {
      if (cancelled) {
        return;
      }
      if (showLoading) {
        setDelegationSessionLoading(true);
      }
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
        if (!cancelled && showLoading) {
          setDelegationSessionLoading(false);
        }
      }
    };

    void load(true);
    timer = window.setInterval(() => {
      void load(false);
    }, 1300);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [selectedDelegation?.sessionID, workspaceDirectory]);

  useLayoutEffect(() => {
    if (!selectedDelegation) {
      setDelegationOverlayBounds(null);
      return;
    }
    const updateOverlayBounds = () => {
      const paneElement = messageFeedRef.current?.closest(".content-pane") as HTMLElement | null;
      const feedRect = messageFeedRef.current?.getBoundingClientRect();
      const rect = feedRect ?? paneElement?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const horizontalPadding = 8;
      const topPadding = 4;
      const bottomPadding = Math.max(16, Math.round(bottomClearance + 12));
      if (!(rect.width > 0) || !(rect.height > 0)) {
        setDelegationOverlayBounds((current) => {
          if (current) {
            return current;
          }
          const fallbackWidth = Math.max(0, Math.round(window.innerWidth - horizontalPadding * 2));
          const fallbackHeight = Math.max(0, Math.round(window.innerHeight - topPadding - bottomPadding));
          return {
            top: topPadding,
            left: horizontalPadding,
            width: fallbackWidth,
            height: fallbackHeight,
          };
        });
        return;
      }
      const effectiveWidth = rect.width;
      const effectiveHeight = rect.height;
      const effectiveTop = Number.isFinite(rect.top) ? rect.top : 0;
      const effectiveLeft = Number.isFinite(rect.left) ? rect.left : 0;
      const width = Math.max(0, Math.round(effectiveWidth - horizontalPadding * 2));
      const height = Math.max(0, Math.round(effectiveHeight - topPadding - bottomPadding));
      const nextBounds = {
        top: Math.round(effectiveTop + topPadding),
        left: Math.round(effectiveLeft + horizontalPadding),
        width,
        height,
      };
      setDelegationOverlayBounds((current) => {
        if (
          current &&
          current.top === nextBounds.top &&
          current.left === nextBounds.left &&
          current.width === nextBounds.width &&
          current.height === nextBounds.height
        ) {
          return current;
        }
        return nextBounds;
      });
    };
    updateOverlayBounds();
    const paneElement = messageFeedRef.current?.closest(".content-pane") as HTMLElement | null;
    let resizeObserver: ResizeObserver | null = null;
    if (paneElement && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateOverlayBounds();
      });
      resizeObserver.observe(paneElement);
    }
    window.addEventListener("resize", updateOverlayBounds);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverlayBounds);
    };
  }, [bottomClearance, selectedDelegation]);


  // Track whether the user is scrolled to (or near) the bottom of the feed.
  useEffect(() => {
    const el = messageFeedRef.current;
    if (!el) {
      return;
    }
    const handleScroll = () => {
      isAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Auto-scroll to bottom when new messages arrive, but only when the user is
  // already at (or near) the bottom. If they have scrolled up, leave them there.
  useEffect(() => {
    if (!isAtBottomRef.current) {
      return;
    }
    const el = messageFeedRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={messageFeedRef} className="messages-scroll" style={messageFeedStyle}>
      {renderedMessages.length === 0 ? <div className="messages-empty">No messages yet. Start by sending a prompt.</div> : null}
      {(() => {
        let lastRenderedRole: string | undefined;
        return renderedMessages.map((message) => {
        const { key, role, timeCreated, visibleParts, toolParts, timeline } = message;
        const timelineBlocks = buildTimelineBlocks(timeline);
        if (visibleParts.length === 0 && timeline.length === 0 && toolParts.length === 0) {
          return null;
        }
        // Only show header when role changes from last RENDERED message (skip consecutive assistant headers)
        const showHeader = role !== lastRenderedRole;
        lastRenderedRole = role;
        const lastTextPartIndex = visibleParts.reduce<number>((acc, part, i) => (part.type === "text" ? i : acc), -1);
        return (
          <MessageTurn key={key}>
            <article className={`message-card message-${role}`}>
              {showHeader ? (
                <MessageHeader
                  role={role === "user" || role === "assistant" ? role : "assistant"}
                  label={getRoleLabel(role, assistantLabel)}
                  timestamp={timeCreated}
                />
              ) : null}
              <div className="message-parts">
                {visibleParts.map((part, partIndex) => (
                  <section key={`${part.id}:${partIndex}`} className="message-part">
                    {renderPart(part, role, partIndex === lastTextPartIndex)}
                  </section>
                ))}
                {toolParts.length > 0 ? (
                  <section className="message-tool-cards">
                    {renderToolParts(toolParts, workspaceDirectory)}
                  </section>
                ) : null}
                {timeline.length > 0 ? (
                  <section className="message-timeline">
                    <MessageTimelineBlocks blocks={timelineBlocks} />
                  </section>
                ) : null}
              </div>
              {visibleParts.length > 0 ? <CopyMessageButton parts={visibleParts} /> : null}
            </article>
          </MessageTurn>
        );
      });
      })()}
      {sessionNotices.map((notice) => (
        <article
          key={notice.id}
          className={`message-card message-system${notice.tone === "error" ? " message-system-error" : ""}`.trim()}
        >
          <header className="message-header">
            <span className="message-role">System</span>
            <span className="message-time">{new Date(notice.time).toLocaleTimeString()}</span>
          </header>
          <div className="message-parts">
            <section className="message-timeline">
              <div className="message-timeline-row">
                <span className="message-timeline-row-label">{notice.label}</span>
                {notice.detail ? <small className="message-timeline-row-error">Reason: {notice.detail}</small> : null}
              </div>
            </section>
          </div>
        </article>
      ))}
      {showAssistantPlaceholder && renderedMessages.length > 0 ? (
        <article className="message-card message-assistant">
          <MessageHeader role="assistant" label={assistantLabel} timestamp={Date.now()} />
          <div className="message-parts">
            <section className="message-part thinking-panel">
              <div className="message-thinking">
                <ThinkingShimmer label={latestActivity?.label ?? "Thinking"} />
              </div>
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
              {/* Live internal events are now represented by ToolCallCard and ThinkingShimmer */}
            </section>
          </div>
        </article>
      ) : null}
      {selectedDelegation && delegationOverlayStyle ? (
        <div className="overlay delegation-modal-overlay" style={delegationOverlayStyle} onClick={() => setSelectedDelegationId(null)}>
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
                {selectedDelegationEventBlocks.length === 0 ? (
                  <p>No live output yet.</p>
                ) : (
                  <div className="delegation-modal-events-list">
                    <DelegationEventBlocks blocks={selectedDelegationEventBlocks} />
                  </div>
                )}
                <p className={`delegation-modal-session-status${delegationSessionError ? " error" : ""}`}>
                  {delegationSessionError ? delegationSessionError : delegationSessionLoading ? "Fetching subagent session..." : ""}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
