import type { Session } from "@opencode-ai/sdk/v2/client";
import type { ProjectBootstrap } from "@shared/ipc";
import type { SessionType } from "../types/canvas";
import { buildWorkspaceSessionMetadataKey } from "./workspace-session-metadata";

export const LOCAL_PROVIDER_SESSIONS_KEY = "orxa:localProviderSessions:v1";

export type LocalProviderSessionType = Extract<SessionType, "codex" | "claude" | "claude-chat">;

export type LocalProviderSessionRecord = {
  sessionID: string;
  directory: string;
  type: LocalProviderSessionType;
  title: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
};

export type LocalProviderSessionMap = Record<string, LocalProviderSessionRecord>;

const LOCAL_PROVIDER_TYPES = new Set<LocalProviderSessionType>(["codex", "claude", "claude-chat"]);

export function isLocalProviderSessionType(type: string | undefined): type is LocalProviderSessionType {
  return Boolean(type && LOCAL_PROVIDER_TYPES.has(type as LocalProviderSessionType));
}

export function createLocalProviderSessionRecord(
  directory: string,
  type: LocalProviderSessionType,
  title: string,
): LocalProviderSessionRecord {
  const now = Date.now();
  const token = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const sessionID = `${type}-${now.toString(36)}-${token}`;
  return {
    sessionID,
    directory,
    type,
    title,
    slug: type,
    createdAt: now,
    updatedAt: now,
  };
}

export function toLocalProviderSession(record: LocalProviderSessionRecord): Session {
  return {
    id: record.sessionID,
    projectID: record.directory,
    directory: record.directory,
    slug: record.slug,
    title: record.title,
    version: "local",
    time: {
      created: record.createdAt,
      updated: record.updatedAt,
    },
  } as unknown as Session;
}

export function mergeLocalProviderSessions(
  project: ProjectBootstrap,
  records: LocalProviderSessionMap,
  getSessionType: (sessionID: string, directory?: string) => string | undefined,
): ProjectBootstrap {
  const retainedSessions = project.sessions.filter((session) => !isLocalProviderSessionType(getSessionType(session.id, project.directory)));
  const retainedStatus = Object.fromEntries(
    Object.entries(project.sessionStatus).filter(([sessionID]) => !isLocalProviderSessionType(getSessionType(sessionID, project.directory))),
  );

  const localRecords = Object.values(records)
    .filter((record) => record.directory === project.directory)
    .map((record) => ({ ...record }));

  for (const session of project.sessions) {
    const sessionType = getSessionType(session.id, project.directory);
    if (!isLocalProviderSessionType(sessionType)) {
      continue;
    }
    const sessionKey = buildWorkspaceSessionMetadataKey(project.directory, session.id);
    if (records[sessionKey]) {
      continue;
    }
    localRecords.push({
      sessionID: session.id,
      directory: project.directory,
      type: sessionType,
      title: session.title ?? session.slug,
      slug: session.slug,
      createdAt: session.time.created,
      updatedAt: session.time.updated,
    });
  }

  const mergedSessions = [...retainedSessions, ...localRecords.map((record) => toLocalProviderSession(record))]
    .sort((left, right) => right.time.updated - left.time.updated);

  for (const record of localRecords) {
    if (!(record.sessionID in retainedStatus)) {
      retainedStatus[record.sessionID] = { type: "idle" };
    }
  }

  return {
    ...project,
    sessions: mergedSessions,
    sessionStatus: retainedStatus,
  };
}

export function upsertLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  record: LocalProviderSessionRecord,
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(record.directory, record.sessionID);
  return {
    ...map,
    [sessionKey]: record,
  };
}

export function removeLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID);
  if (!(sessionKey in map)) {
    return map;
  }
  const next = { ...map };
  delete next[sessionKey];
  return next;
}

export function renameLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
  title: string,
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID);
  const current = map[sessionKey];
  if (!current) {
    return map;
  }
  return {
    ...map,
    [sessionKey]: {
      ...current,
      title,
      updatedAt: Date.now(),
    },
  };
}

export function touchLocalProviderSessionRecord(
  map: LocalProviderSessionMap,
  directory: string,
  sessionID: string,
  updatedAt = Date.now(),
): LocalProviderSessionMap {
  const sessionKey = buildWorkspaceSessionMetadataKey(directory, sessionID);
  const current = map[sessionKey];
  if (!current || updatedAt <= current.updatedAt) {
    return map;
  }
  return {
    ...map,
    [sessionKey]: {
      ...current,
      updatedAt,
    },
  };
}
