import type {
  ArtifactExportBundleInput,
  ArtifactListQuery,
  ArtifactRetentionUpdateInput,
  WorkspaceContextWriteInput,
} from "../../shared/ipc";

import { assertFiniteNumber, assertString } from "./validators-core";

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
