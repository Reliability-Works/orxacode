import type {
  ArtifactExportBundleInput,
  ArtifactListQuery,
  ArtifactRetentionUpdateInput,
  MemoryGraphQuery,
  MemorySettingsUpdateInput,
  WorkspaceContextWriteInput,
} from "../../shared/ipc";

import { assertBoolean, assertFiniteNumber, assertString } from "./validators-core";

function assertMemoryPolicyPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory policy patch must be an object");
  }
  const payload = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      throw new Error("memory policy enabled must be a boolean");
    }
    out.enabled = payload.enabled;
  }
  if (payload.mode !== undefined) {
    if (typeof payload.mode !== "string") {
      throw new Error("memory policy mode must be a string");
    }
    out.mode = payload.mode;
  }
  if (payload.guidance !== undefined) {
    if (typeof payload.guidance !== "string" || payload.guidance.length > 4_000) {
      throw new Error("memory policy guidance must be a string (max 4000 chars)");
    }
    out.guidance = payload.guidance;
  }
  if (payload.maxPromptMemories !== undefined) {
    if (typeof payload.maxPromptMemories !== "number" || !Number.isFinite(payload.maxPromptMemories)) {
      throw new Error("memory policy maxPromptMemories must be a number");
    }
    out.maxPromptMemories = payload.maxPromptMemories;
  }
  if (payload.maxCapturePerSession !== undefined) {
    if (typeof payload.maxCapturePerSession !== "number" || !Number.isFinite(payload.maxCapturePerSession)) {
      throw new Error("memory policy maxCapturePerSession must be a number");
    }
    out.maxCapturePerSession = payload.maxCapturePerSession;
  }
  return out;
}

export function assertMemorySettingsUpdateInput(value: unknown): MemorySettingsUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory settings update payload is required");
  }
  const payload = value as Record<string, unknown>;
  const output: MemorySettingsUpdateInput = {};
  if (payload.directory !== undefined) {
    output.directory = assertString(payload.directory, "directory");
  }
  if (payload.global !== undefined) {
    output.global = assertMemoryPolicyPatch(payload.global) as MemorySettingsUpdateInput["global"];
  }
  if (payload.workspace !== undefined) {
    output.workspace = assertMemoryPolicyPatch(payload.workspace) as MemorySettingsUpdateInput["workspace"];
  }
  if (payload.clearWorkspaceOverride !== undefined) {
    output.clearWorkspaceOverride = assertBoolean(payload.clearWorkspaceOverride, "clearWorkspaceOverride");
  }
  return output;
}

export function assertMemoryGraphQuery(value: unknown): MemoryGraphQuery {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory graph query must be an object");
  }
  const payload = value as Record<string, unknown>;
  const output: MemoryGraphQuery = {};
  if (payload.workspace !== undefined) {
    output.workspace = assertString(payload.workspace, "workspace");
  }
  if (payload.query !== undefined) {
    if (typeof payload.query !== "string" || payload.query.length > 512) {
      throw new Error("query must be a string with max length 512");
    }
    output.query = payload.query;
  }
  if (payload.relation !== undefined) {
    if (typeof payload.relation !== "string" || payload.relation.length > 64) {
      throw new Error("relation must be a string with max length 64");
    }
    output.relation = payload.relation;
  }
  if (payload.limit !== undefined) {
    if (typeof payload.limit !== "number" || !Number.isFinite(payload.limit)) {
      throw new Error("limit must be a number");
    }
    output.limit = payload.limit;
  }
  return output;
}

export function assertArtifactListQuery(value: unknown): ArtifactListQuery {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact list query must be an object");
  }
  const payload = value as Record<string, unknown>;
  const output: ArtifactListQuery = {};
  if (payload.workspace !== undefined) {
    output.workspace = assertString(payload.workspace, "workspace");
  }
  if (payload.sessionID !== undefined) {
    output.sessionID = assertString(payload.sessionID, "sessionID");
  }
  if (payload.kind !== undefined) {
    if (typeof payload.kind === "string") {
      output.kind = payload.kind as ArtifactListQuery["kind"];
    } else if (Array.isArray(payload.kind)) {
      output.kind = payload.kind.filter((item): item is string => typeof item === "string") as ArtifactListQuery["kind"];
    } else {
      throw new Error("kind must be a string or string[]");
    }
  }
  if (payload.limit !== undefined) {
    output.limit = Math.floor(assertFiniteNumber(payload.limit, "limit"));
  }
  return output;
}

export function assertArtifactRetentionUpdateInput(value: unknown): ArtifactRetentionUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact retention payload is required");
  }
  const payload = value as Record<string, unknown>;
  const maxBytes = Math.floor(assertFiniteNumber(payload.maxBytes, "maxBytes"));
  if (maxBytes < 1) {
    throw new Error("maxBytes must be greater than 0");
  }
  return { maxBytes };
}

export function assertArtifactExportBundleInput(value: unknown): ArtifactExportBundleInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Artifact export payload is required");
  }
  const payload = value as Record<string, unknown>;
  const output: ArtifactExportBundleInput = {
    workspace: assertString(payload.workspace, "workspace"),
  };
  if (payload.sessionID !== undefined) {
    output.sessionID = assertString(payload.sessionID, "sessionID");
  }
  if (payload.kind !== undefined) {
    if (typeof payload.kind === "string") {
      output.kind = payload.kind as ArtifactExportBundleInput["kind"];
    } else if (Array.isArray(payload.kind)) {
      output.kind = payload.kind.filter((item): item is string => typeof item === "string") as ArtifactExportBundleInput["kind"];
    } else {
      throw new Error("kind must be a string or string[]");
    }
  }
  if (payload.limit !== undefined) {
    output.limit = Math.floor(assertFiniteNumber(payload.limit, "limit"));
  }
  return output;
}

export function assertWorkspaceContextWriteInput(value: unknown): WorkspaceContextWriteInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Workspace context write payload is required");
  }
  const payload = value as Record<string, unknown>;
  return {
    workspace: assertString(payload.workspace, "workspace"),
    id: payload.id === undefined ? undefined : assertString(payload.id, "id"),
    filename: payload.filename === undefined ? undefined : assertString(payload.filename, "filename"),
    title: payload.title === undefined ? undefined : assertString(payload.title, "title"),
    content: assertString(payload.content, "content"),
  };
}
