import type { FileDiff, Part, SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { ChangeProvenanceRecord, ExecutionEventRecord, SessionMessageBundle } from "@shared/ipc";
import type { ToolCallStatus } from "../components/chat/ToolCallCard";
import type { UnifiedMessageSection, UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";
import {
  extractMetaFileDiffSummary,
  extractMetaFileDiffDetails,
  extractPatchFileDetails,
  extractPatchSummary,
  extractWriteFileDetail,
  mergeChangedFileDetails,
  extractWriteFileSummary,
} from "./message-feed-patch-summary";
import {
  buildTimelineBlocks,
  type InternalEvent,
  type TimelineEvent,
  type TimelineKind,
} from "./message-feed-timeline";
import {
  extractVisibleText,
  getVisibleParts,
  isLikelyTelemetryJson,
  isProgressUpdateText,
  parseJsonObject,
  shouldHideAssistantText,
  summarizeOrxaBrowserActionText,
} from "./message-feed-visibility";
import {
  groupChangedFileRows,
  type UnifiedProjectedSessionPresentation,
} from "./session-presentation";
import { groupAdjacentExploreRows, groupAdjacentTimelineExplorationRows, groupAdjacentToolCallRows } from "./timeline-row-grouping";

export type ActivityEvent = {
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

function compactPathPreservingBasename(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  const normalized = singleLine.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return compactText(singleLine, maxLength);
  }
  const basename = normalized.slice(slashIndex + 1);
  if (!basename) {
    return compactText(singleLine, maxLength);
  }
  const reserved = basename.length + 4;
  if (reserved >= maxLength) {
    return `...${basename.slice(-(maxLength - 3))}`;
  }
  const prefixBudget = maxLength - reserved;
  const prefix = normalized.slice(0, prefixBudget).replace(/[/. -]+$/g, "");
  return `${prefix}.../${basename}`;
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
  return compactPathPreservingBasename(toWorkspaceRelativePath(target, workspaceDirectory), maxLength);
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

function extractShellCommandForTool(input: unknown, stateTitle?: string) {
  const explicitCommand = extractCommand(input);
  if (explicitCommand && isLikelyShellCommand(explicitCommand)) {
    return explicitCommand;
  }
  const normalizedTitle = stateTitle?.trim() ?? "";
  if (normalizedTitle && isLikelyShellCommand(normalizedTitle)) {
    return normalizedTitle;
  }
  return undefined;
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

function isLowSignalActiveLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  return normalized === "working..." || normalized.startsWith("working on ");
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
    return `for ${compactText(pattern, 42)} in ${target}`;
  }
  if (pattern) {
    return `for ${compactText(pattern, 42)}`;
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
    return withTarget("Deleting", "Deleted", "Delete failed");
  }
  if (name.includes("create") || name.includes("mkdir") || name.includes("touch")) {
    return withTarget("Creating", "Created", "Create failed");
  }
  if (name.includes("write")) {
    const writeSummary = extractWriteFileSummary(input, metadata, workspaceDirectory);
    if (isActive) {
      return writeSummary ? `Writing ${writeSummary.summary}...` : "Writing...";
    }
    if (isError) {
      return writeSummary ? `Write failed ${writeSummary.summary}` : "Write failed";
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
    return withTarget("Editing", "Edited", "Edit failed");
  }
  if (name.includes("rename") || name.includes("move")) {
    return withTarget("Moving", "Moved", "Move failed");
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
      return isActive ? "Running command..." : "Ran command";
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
    if (isLikelyTelemetryJson(text)) {
      const parsed = parseJsonObject(text);
      const summary = typeof parsed?.type === "string" ? parsed.type : "Telemetry event";
      return { id: part.id, summary, actor };
    }
  }
  return null;
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

function classifyAssistantParts(parts: Part[], workspaceDirectory?: string | null) {
  const visible: Part[] = [];
  const internal: InternalEvent[] = [];
  const delegations: DelegationTrace[] = [];
  const timeline: TimelineEvent[] = [];
  const changedFiles: Array<Extract<UnifiedTimelineRenderRow, { kind: "diff" }>> = [];
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
      const stateOutput = typeof stateRecord.output === "string" ? stateRecord.output : undefined;
      const stateError = typeof stateRecord.error === "string" ? stateRecord.error : undefined;
      let label = toToolActivityLabel(part.tool, status, part.state.input, workspaceDirectory, stateMetadata, stateOutput);
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
      const toolName = part.tool.trim().toLowerCase();
      const toolChangedFiles = extractChangedFilesFromToolPart(part, kind, workspaceDirectory);
      if (toolChangedFiles.length > 0) {
        changedFiles.push(...toolChangedFiles);
      }
      const isCommandTool = toolName.includes("exec_command") || toolName.includes("bash") || toolName.includes("run");
      const shellCommand = extractShellCommandForTool(part.state.input, stateTitle);
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
        activity = null;
      } else {
        if (taskDelegation) {
          continue;
        }
        if (kind === "todo") {
          continue;
        }
        if (isCommandTool && shellCommand && kind !== "read" && kind !== "search" && kind !== "list") {
          continue;
        }
        const showReason = kind === "create" || kind === "delete";
        const showCommand = (isCommandTool && kind !== "read" && kind !== "search" && kind !== "list") || kind === "run" || kind === "git";
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
        if (
          (part.state.status === "error" && !shellCommand && (kind === "edit" || kind === "create" || kind === "delete")) ||
          (toolChangedFiles.length > 0 && (kind === "edit" || kind === "create" || kind === "delete" || kind === "run"))
        ) {
          continue;
        }
        timeline.push({
          id: `${part.id}:timeline`,
          label,
          kind,
          reason: showReason ? `Why this changed: ${currentActor} via ${toToolReason(part.tool)}` : undefined,
          command: command ?? undefined,
          output: stateOutput && stateOutput.trim().length > 0 ? stateOutput.trim() : undefined,
          failure: status === "error"
            ? (stateError?.trim() || stateOutput?.trim() || "Tool execution failed")
            : undefined,
        });
      }
    }

    if (part.type === "reasoning") {
      const record = part as unknown as Record<string, unknown>;
      const summary = typeof record.summary === "string" ? record.summary : typeof record.text === "string" ? record.text : "";
      if (summary) {
        const trimmed = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
        activity = { id: `${part.id}:activity`, label: trimmed };
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

  return { visible, internal, delegations, timeline, activity, changedFiles };
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
  const explicitCommand = extractShellCommandForTool(part.state.input, stateTitle);
  const derivedTitle = toToolActivityLabel(
    part.tool,
    part.state.status,
    part.state.input,
    workspaceDirectory,
    stateRecord.metadata,
    stateRecord.output,
  );
  const genericStateTitle = !stateTitle || stateTitle.toLowerCase() === toolName;
  const collapsedCommandPreview = explicitCommand ? compactText(explicitCommand, 92) : undefined;
  const title = isCommandTool && explicitCommand
    ? status === "running"
      ? `Running ${collapsedCommandPreview}...`
      : status === "error"
        ? `Command failed ${collapsedCommandPreview}`
        : `Ran ${collapsedCommandPreview}`
    : genericStateTitle ? derivedTitle : stateTitle;
  const expandedTitle = isCommandTool && explicitCommand
    ? status === "running"
      ? "Running command"
      : status === "error"
        ? "Command failed"
        : "Ran command"
    : undefined;
  const command = isCommandTool && explicitCommand ? explicitCommand : undefined;
  const output = stateOutput || undefined;
  const error = status === "error" ? (stateError ?? "Tool execution failed") : undefined;
  return { title, expandedTitle, status, command, output, error };
}

function extractChangedFilesFromToolPart(
  part: Part & { type: "tool" },
  kind: TimelineKind,
  workspaceDirectory?: string | null,
) {
  if (kind !== "edit" && kind !== "create" && kind !== "delete" && kind !== "run") {
    return [];
  }
  if (isToolStatusActive(part.state.status) || part.state.status === "error") {
    return [];
  }
  const stateRecord = part.state as unknown as Record<string, unknown>;
  const patchFiles = extractPatchFileDetails(part.state.input, stateRecord.output, workspaceDirectory);
  const metadataPatchFiles = extractPatchFileDetails(stateRecord.metadata, undefined, workspaceDirectory);
  const metadataFiles = extractMetaFileDiffDetails(stateRecord.metadata, workspaceDirectory);
  const writeFile = extractWriteFileDetail(part.state.input, stateRecord.metadata, workspaceDirectory);
  const merged = mergeChangedFileDetails(
    patchFiles,
    metadataPatchFiles,
    metadataFiles,
    writeFile ? [writeFile] : [],
  );
  return merged.map((file, index) => ({
    id: `${part.id}:diff:${file.path}:${index}`,
    kind: "diff" as const,
    path: file.path,
    type: file.type,
    diff: file.diff,
    insertions: file.insertions,
    deletions: file.deletions,
  }));
}

function renderToolParts(parts: Part[], workspaceDirectory?: string | null): UnifiedTimelineRenderRow[] {
  return parts
    .filter((part): part is Part & { type: "tool" } => part.type === "tool")
    .filter((part) => {
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
      const toolName = part.tool.trim().toLowerCase();
      const isCommandTool = toolName.includes("exec_command") || toolName.includes("bash") || toolName.includes("run");
      const stateTitle = "title" in part.state && typeof part.state.title === "string" ? part.state.title : undefined;
      const hasShellCommand = Boolean(extractShellCommandForTool(part.state.input, stateTitle));
      if (kind === "todo") {
        return true;
      }
      if (isTaskToolName(part.tool)) {
        return false;
      }
      if (isCommandTool && hasShellCommand) {
        return kind !== "read" && kind !== "search" && kind !== "list";
      }
      return part.state.status === "error" && (kind === "edit" || kind === "create" || kind === "delete");
    })
    .flatMap<UnifiedTimelineRenderRow>((part) => {
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory);
      if (kind === "todo") {
        return [{
          id: `tool:${part.id}:status`,
          kind: "status" as const,
          label: part.state.status === "running" ? "Updating todo list" : "Updated todo list",
        }];
      }
      const props = buildToolCallCardProps(part, workspaceDirectory);
      if (isLowSignalActiveLabel(props.title) && !props.command && !props.output && !props.error) {
        return [];
      }
      return [{
        id: `tool:${part.id}`,
        kind: "tool" as const,
        title: props.title,
        expandedTitle: props.expandedTitle,
        status: props.status,
        command: props.command,
        output: props.output,
        error: props.error,
        defaultExpanded: false,
      }];
    });
}

function summarizeReasoningPart(part: Part & { type: "reasoning" }) {
  const record = part as unknown as Record<string, unknown>;
  const content = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
  const summary = typeof record.summary === "string" ? record.summary : "";
  return {
    id: `reasoning:${part.id}`,
    kind: "thinking" as const,
    summary: summary || (content ? content.slice(0, 80) + (content.length > 80 ? "..." : "") : "..."),
    content,
  };
}

function isGenericReasoningLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "reasoning update" || normalized === "reasoning";
}

function mapProvenanceOperationToDiffType(operation: ChangeProvenanceRecord["operation"]) {
  if (operation === "create") {
    return "added";
  }
  if (operation === "delete") {
    return "deleted";
  }
  return "edited";
}

function dedupeChangedFiles(
  files: Array<Extract<UnifiedTimelineRenderRow, { kind: "diff" }>>,
) {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.type}:${file.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

type SessionDiffLookup = {
  all: FileDiff[];
  byPath: Map<string, FileDiff[]>;
};

function normalizeFileLookupPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function buildPseudoUnifiedDiff(diff: FileDiff) {
  const beforeLines = diff.before.split("\n");
  const afterLines = diff.after.split("\n");
  const lines = [`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`];
  if (diff.before.length > 0) {
    lines.push(...beforeLines.map((line) => `-${line}`));
  }
  if (diff.after.length > 0) {
    lines.push(...afterLines.map((line) => `+${line}`));
  }
  return lines.join("\n");
}

function buildSessionDiffLookup(sessionDiff?: FileDiff[]): SessionDiffLookup | null {
  if (!sessionDiff || sessionDiff.length === 0) {
    return null;
  }
  const byPath = new Map<string, FileDiff[]>();
  const register = (map: Map<string, FileDiff[]>, key: string, file: FileDiff) => {
    const normalized = normalizeFileLookupPath(key);
    if (!normalized) {
      return;
    }
    const existing = map.get(normalized);
    if (existing) {
      existing.push(file);
    } else {
      map.set(normalized, [file]);
    }
  };

  for (const file of sessionDiff) {
    register(byPath, file.file, file);
  }

  return { all: sessionDiff, byPath };
}

function resolveSessionDiffEntry(path: string, lookup: SessionDiffLookup | null) {
  if (!lookup) {
    return null;
  }
  const normalized = normalizeFileLookupPath(path);
  const exact = lookup.byPath.get(normalized);
  if (exact?.length === 1) {
    return exact[0];
  }
  if (exact && exact.length > 1) {
    return exact[exact.length - 1] ?? null;
  }

  const suffixMatches = lookup.all.filter((file) => {
    const candidatePath = normalizeFileLookupPath(file.file);
    return (
      normalized.endsWith(`/${candidatePath}`) ||
      candidatePath.endsWith(`/${normalized}`)
    );
  });
  if (suffixMatches.length === 1) {
    return suffixMatches[0] ?? null;
  }

  return null;
}

function isLikelyDirectoryPlaceholderPath(path: string, lookup: SessionDiffLookup | null) {
  const normalized = normalizeFileLookupPath(path);
  if (!normalized) {
    return true;
  }
  if (resolveSessionDiffEntry(normalized, lookup)) {
    return false;
  }
  const basename = normalized.split("/").pop() ?? normalized;
  if (normalized.includes("/")) {
    return false;
  }
  if (basename.includes(".")) {
    return false;
  }
  const extensionlessFileNames = new Set([
    "Dockerfile",
    "Makefile",
    "Procfile",
    "Gemfile",
    "Rakefile",
    "README",
    "LICENSE",
  ]);
  return !extensionlessFileNames.has(basename);
}

function hydrateChangedFilesWithSessionDiff(
  files: Array<Extract<UnifiedTimelineRenderRow, { kind: "diff" }>>,
  lookup: SessionDiffLookup | null,
) {
  return files
    .filter((file) => !isLikelyDirectoryPlaceholderPath(file.path, lookup))
    .map((file) => {
      const match = resolveSessionDiffEntry(file.path, lookup);
      if (!match) {
        return file;
      }

      const hasMeaningfulOwnStats = (file.insertions ?? 0) > 0 || (file.deletions ?? 0) > 0;
      const shouldPreferSessionDiffStats = !file.diff && !hasMeaningfulOwnStats;

      return {
        ...file,
        diff: file.diff ?? buildPseudoUnifiedDiff(match),
        insertions: shouldPreferSessionDiffStats ? match.additions : (file.insertions ?? match.additions),
        deletions: shouldPreferSessionDiffStats ? match.deletions : (file.deletions ?? match.deletions),
        type: file.type || match.status || "modified",
      };
    });
}

function buildChangedFilesFromProvenance(
  records: ChangeProvenanceRecord[],
  lookup: SessionDiffLookup | null,
) {
  const latestByPath = new Map<string, ChangeProvenanceRecord>();
  for (const record of records) {
    const existing = latestByPath.get(record.filePath);
    if (!existing || existing.timestamp <= record.timestamp) {
      latestByPath.set(record.filePath, record);
    }
  }
  return hydrateChangedFilesWithSessionDiff(
    [...latestByPath.values()]
    .sort((a, b) => a.filePath.localeCompare(b.filePath))
    .map((record, index) => ({
      id: `provenance:${record.eventID}:${index}`,
      kind: "diff" as const,
      path: record.filePath,
      type: mapProvenanceOperationToDiffType(record.operation),
    })),
    lookup,
  );
}

function buildProvenanceByTurn(records: ChangeProvenanceRecord[]) {
  const grouped = new Map<string, ChangeProvenanceRecord[]>();
  for (const record of records) {
    if (!record.turnID) {
      continue;
    }
    const existing = grouped.get(record.turnID);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.turnID, [record]);
    }
  }
  return grouped;
}

function deriveLatestReasoning(messages: SessionMessageBundle[], executionLedger: ExecutionEventRecord[]) {
  let latest: { label: string; content: string; timestamp: number } | null = null;

  for (const bundle of messages) {
    if (bundle.info.role !== "assistant") {
      continue;
    }
    for (const part of bundle.parts) {
      if (part.type !== "reasoning") {
        continue;
      }
      const record = part as unknown as Record<string, unknown>;
      const content = typeof record.text === "string" ? record.text.trim() : "";
      const rawSummary = typeof record.summary === "string" ? record.summary.trim() : "";
      const summary = isGenericReasoningLabel(rawSummary) ? "" : rawSummary;
      const timestamp = bundle.info.time.created;
      if (!content && !summary) {
        continue;
      }
      if (!latest || latest.timestamp <= timestamp) {
        latest = {
          label: compactText(summary || content, 80),
          content,
          timestamp,
        };
      }
    }
  }

  for (const record of executionLedger) {
    if (record.kind !== "reasoning") {
      continue;
    }
    const content = record.detail?.trim() ?? "";
    const rawSummary = record.summary.trim();
    const summary = isGenericReasoningLabel(rawSummary) ? "" : rawSummary;
    if (!content && !summary) {
      continue;
    }
    if (!latest || latest.timestamp <= record.timestamp) {
      latest = {
        label: compactText(content || summary, 80),
        content,
        timestamp: record.timestamp,
      };
    }
  }

  return latest;
}

function buildMessageRows(
  bundle: SessionMessageBundle,
  visibleParts: Part[],
  toolParts: Part[],
  changedFiles: Array<Extract<UnifiedTimelineRenderRow, { kind: "diff" }>>,
  timelineBlocks: ReturnType<typeof buildTimelineBlocks>,
  assistantLabel: string,
  showHeader: boolean,
  workspaceDirectory?: string | null,
): UnifiedTimelineRenderRow[] {
  const rows: UnifiedTimelineRenderRow[] = [];
  const messageSections = visibleParts.reduce<UnifiedMessageSection[]>((sections, part) => {
    if (part.type === "text") {
      sections.push({ id: `${bundle.info.id}:${part.id}:text`, type: "text", content: part.text });
      return sections;
    }
    if (part.type === "file") {
      sections.push({ id: `${bundle.info.id}:${part.id}:file`, type: "file", label: part.filename ?? part.url });
    }
    return sections;
  }, []);

  if (messageSections.length > 0) {
    rows.push({
      id: `${bundle.info.id}:message`,
      kind: "message",
      role: bundle.info.role === "user" ? "user" : "assistant",
      label: getRoleLabel(bundle.info.role, assistantLabel),
      timestamp: bundle.info.time.created,
      showHeader,
      copyText: bundle.info.role === "user" ? extractVisibleText(visibleParts) : undefined,
      copyLabel: bundle.info.role === "user" ? "Copy message" : undefined,
      sections: messageSections,
    });
  }

  for (const part of visibleParts) {
    if (part.type === "reasoning") {
      rows.push(summarizeReasoningPart(part));
    }
  }

  rows.push(...renderToolParts(toolParts, workspaceDirectory));
  rows.push(...changedFiles);

  if (timelineBlocks.length > 0) {
    rows.push({
      id: `${bundle.info.id}:timeline`,
      kind: "timeline",
      blocks: timelineBlocks,
    });
  }

  return rows;
}

function injectTurnDividers(
  rows: UnifiedTimelineRenderRow[],
  messages: SessionMessageBundle[],
): UnifiedTimelineRenderRow[] {
  if (rows.length === 0) {
    return rows;
  }

  // Build a map from message id to timestamps for duration calculation.
  const messageTimestamps = new Map<string, { created: number; updated?: number }>();
  for (const msg of messages) {
    const updated = "updated" in msg.info.time && typeof msg.info.time.updated === "number"
      ? msg.info.time.updated
      : undefined;
    messageTimestamps.set(msg.info.id, { created: msg.info.time.created, updated });
  }

  // Find user message rows (turn starts) and insert dividers before them,
  // after any preceding assistant content.
  const result: UnifiedTimelineRenderRow[] = [];
  let prevWasAssistantContent = false;
  let lastAssistantTimestamp: number | undefined;
  let lastUserTimestamp: number | undefined;

  for (const row of rows) {
    const isUserMessage = row.kind === "message" && row.role === "user";

    if (isUserMessage && prevWasAssistantContent) {
      const duration =
        lastAssistantTimestamp !== undefined && lastUserTimestamp !== undefined
          ? Math.round((lastAssistantTimestamp - lastUserTimestamp) / 1000)
          : undefined;
      result.push({
        id: `turn-divider:${row.id}`,
        kind: "turn-divider",
        timestamp: lastAssistantTimestamp,
        durationSeconds: duration !== undefined && duration > 0 ? duration : undefined,
      });
    }

    if (isUserMessage) {
      prevWasAssistantContent = false;
      lastUserTimestamp = row.timestamp;
    } else if (
      row.kind === "message" && row.role === "assistant" ||
      row.kind === "tool" ||
      row.kind === "diff" ||
      row.kind === "diff-group" ||
      row.kind === "tool-group" ||
      row.kind === "explore" ||
      row.kind === "thinking"
    ) {
      prevWasAssistantContent = true;
      if (row.kind === "message" && row.timestamp) {
        lastAssistantTimestamp = row.timestamp;
      }
    }

    result.push(row);
  }

  return result;
}

export function projectOpencodeSessionPresentation(input: {
  messages: SessionMessageBundle[];
  sessionDiff?: FileDiff[];
  sessionStatus?: SessionStatus;
  executionLedger?: ExecutionEventRecord[];
  changeProvenance?: ChangeProvenanceRecord[];
  assistantLabel?: string;
  workspaceDirectory?: string | null;
}): UnifiedProjectedSessionPresentation {
  const {
    assistantLabel = "Orxa",
    changeProvenance = [],
    executionLedger = [],
    messages,
    sessionDiff = [],
    sessionStatus,
    workspaceDirectory,
  } = input;
  const sessionDiffLookup = buildSessionDiffLookup(sessionDiff);
  const latestReasoning = deriveLatestReasoning(messages, executionLedger);
  if (messages.length === 0) {
    return {
      provider: "opencode" as const,
      rows: [],
      latestActivity: latestReasoning ? { id: "opencode:reasoning:latest", label: latestReasoning.label } : null,
      latestActivityContent: latestReasoning?.content ?? null,
      placeholderTimestamp: 0,
    };
  }

  let latestActivity: ActivityEvent | null = null;
  let lastRenderedRole: string | undefined;
  const provenanceByTurn = buildProvenanceByTurn(changeProvenance);

  const nextRows = messages.flatMap((bundle) => {
    const role = bundle.info.role;
    const assistantClassification = role === "assistant" ? classifyAssistantParts(bundle.parts, workspaceDirectory) : undefined;
    const visibleParts = assistantClassification?.visible ?? getVisibleParts(role, bundle.parts);
    const toolParts = role === "assistant" ? bundle.parts.filter((part) => part.type === "tool") : [];
    const provenanceChangedFiles = role === "assistant"
      ? buildChangedFilesFromProvenance(provenanceByTurn.get(bundle.info.id) ?? [], sessionDiffLookup)
      : [];
    const changedFiles = dedupeChangedFiles(
      hydrateChangedFilesWithSessionDiff(
        [...(assistantClassification?.changedFiles ?? []), ...provenanceChangedFiles],
        sessionDiffLookup,
      ),
    );
    const timelineBlocks = buildTimelineBlocks(assistantClassification?.timeline ?? []);
    if (role === "assistant") {
      latestActivity = assistantClassification?.activity ?? null;
    }
    if (visibleParts.length === 0 && timelineBlocks.length === 0 && toolParts.length === 0 && changedFiles.length === 0) {
      return [];
    }
    const showHeader = role !== lastRenderedRole;
    if (visibleParts.some((part) => part.type === "text" || part.type === "file")) {
      lastRenderedRole = role;
    }

    return buildMessageRows(
      bundle,
      visibleParts,
      toolParts,
      changedFiles,
      timelineBlocks,
      assistantLabel,
      showHeader,
      workspaceDirectory,
    );
  });

  const lastMessage = messages.at(-1);
  const placeholderTimestamp =
    lastMessage && "updated" in lastMessage.info.time && typeof lastMessage.info.time.updated === "number"
      ? lastMessage.info.time.updated
      : lastMessage?.info.time.created ?? 0;
  const effectiveLatestActivity = latestActivity ?? (latestReasoning
    ? { id: "opencode:reasoning:latest", label: latestReasoning.label }
    : null);
  const isBusy = sessionStatus?.type === "busy" || sessionStatus?.type === "retry";
  const groupedRows = groupAdjacentExploreRows(
    groupAdjacentTimelineExplorationRows(
      groupAdjacentToolCallRows(
        groupChangedFileRows(nextRows, { enabled: !isBusy }),
        { enabled: isBusy },
      ),
    ),
  );

  const finalRows = isBusy ? groupedRows : injectTurnDividers(groupedRows, messages);

  return {
    provider: "opencode" as const,
    rows: finalRows,
    latestActivity: effectiveLatestActivity,
    latestActivityContent: latestReasoning?.content ?? null,
    placeholderTimestamp,
  };
}
