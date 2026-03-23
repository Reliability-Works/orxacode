import type {
  Event as OpencodeEvent,
  FileDiff,
  Message,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client";
import type { ProjectBootstrap, SessionMessageBundle, SessionRuntimeSnapshot } from "@shared/ipc";

function mergeMessageParts(previous: SessionMessageBundle["parts"], next: SessionMessageBundle["parts"]) {
  const merged = new Map<string, SessionMessageBundle["parts"][number]>();
  const seenFallbackKeys = new Set<string>();
  const ordered: string[] = [];

  for (const part of [...previous, ...next]) {
    if (typeof part.id === "string" && part.id.length > 0) {
      if (!merged.has(part.id)) {
        ordered.push(part.id);
      }
      merged.set(part.id, part);
      continue;
    }

    const content = typeof (part as { content?: unknown }).content === "string"
      ? ((part as { content?: string }).content ?? "").slice(0, 100)
      : "";
    const key = `_fb_${part.type}_${content}`;
    if (!seenFallbackKeys.has(key)) {
      seenFallbackKeys.add(key);
      ordered.push(key);
    }
    merged.set(key, part);
  }

  return ordered.map((key) => merged.get(key)!);
}

function messageUpdatedAt(info: SessionMessageBundle["info"]) {
  const timeRecord = info.time as Record<string, unknown>;
  const updated = typeof timeRecord.updated === "number" ? timeRecord.updated : undefined;
  const created = typeof timeRecord.created === "number" ? timeRecord.created : 0;
  return updated ?? created;
}

export function normalizeMessageBundles(items: SessionMessageBundle[]) {
  if (items.length <= 1) {
    return items;
  }
  const byId = new Map<string, SessionMessageBundle>();
  for (const item of items) {
    const existing = byId.get(item.info.id);
    if (!existing) {
      byId.set(item.info.id, item);
      continue;
    }
    const itemUpdatedAt = messageUpdatedAt(item.info);
    const existingUpdatedAt = messageUpdatedAt(existing.info);
    const nextInfo = itemUpdatedAt >= existingUpdatedAt ? item.info : existing.info;
    byId.set(item.info.id, {
      ...item,
      info: nextInfo,
      parts: mergeMessageParts(existing.parts, item.parts),
    });
  }
  return [...byId.values()].sort((a, b) => a.info.time.created - b.info.time.created);
}

function sortSessionsByUpdated(sessions: Session[]) {
  return [...sessions].sort((left, right) => right.time.updated - left.time.updated);
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) {
    return [...items, value];
  }
  const next = [...items];
  next[index] = value;
  return next;
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return items;
  }
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function getSessionIdFromEvent(event: OpencodeEvent) {
  const properties = event.properties as Record<string, unknown> | undefined;
  if (!properties) {
    return undefined;
  }
  if (typeof properties.sessionID === "string") {
    return properties.sessionID;
  }
  const info = properties.info;
  if (info && typeof info === "object" && typeof (info as { sessionID?: unknown }).sessionID === "string") {
    return (info as { sessionID: string }).sessionID;
  }
  const part = properties.part;
  if (part && typeof part === "object" && typeof (part as { sessionID?: unknown }).sessionID === "string") {
    return (part as { sessionID: string }).sessionID;
  }
  return undefined;
}

function upsertMessage(messages: SessionMessageBundle[], info: Message) {
  const index = messages.findIndex((bundle) => bundle.info.id === info.id);
  if (index < 0) {
    return normalizeMessageBundles([...messages, { info, parts: [] }]);
  }
  const next = [...messages];
  next[index] = { ...next[index], info };
  return normalizeMessageBundles(next);
}

function removeMessage(messages: SessionMessageBundle[], messageID: string) {
  return messages.filter((bundle) => bundle.info.id !== messageID);
}

function upsertPart(messages: SessionMessageBundle[], part: Part) {
  const index = messages.findIndex((bundle) => bundle.info.id === part.messageID);
  if (index < 0) {
    return messages;
  }
  const bundle = messages[index]!;
  const partIndex = bundle.parts.findIndex((item) => item.id === part.id);
  const nextParts =
    partIndex < 0
      ? [...bundle.parts, part]
      : bundle.parts.map((item, currentIndex) => (currentIndex === partIndex ? part : item));
  const next = [...messages];
  next[index] = { ...bundle, parts: nextParts };
  return normalizeMessageBundles(next);
}

function removePart(messages: SessionMessageBundle[], messageID: string, partID: string) {
  const index = messages.findIndex((bundle) => bundle.info.id === messageID);
  if (index < 0) {
    return messages;
  }
  const bundle = messages[index]!;
  const nextParts = bundle.parts.filter((part) => part.id !== partID);
  const next = [...messages];
  next[index] = { ...bundle, parts: nextParts };
  return normalizeMessageBundles(next);
}

function appendPartDelta(messages: SessionMessageBundle[], messageID: string, partID: string, field: string, delta: string) {
  const messageIndex = messages.findIndex((bundle) => bundle.info.id === messageID);
  if (messageIndex < 0) {
    return messages;
  }
  const bundle = messages[messageIndex]!;
  const partIndex = bundle.parts.findIndex((part) => part.id === partID);
  if (partIndex < 0) {
    return messages;
  }
  const part = bundle.parts[partIndex]!;
  const existing = (part as Record<string, unknown>)[field];
  if (existing !== undefined && typeof existing !== "string") {
    return messages;
  }
  const nextPart = {
    ...part,
    [field]: `${typeof existing === "string" ? existing : ""}${delta}`,
  } as Part;
  const nextParts = bundle.parts.map((item, index) => (index === partIndex ? nextPart : item));
  const next = [...messages];
  next[messageIndex] = { ...bundle, parts: nextParts };
  return normalizeMessageBundles(next);
}

export function createEmptyRuntimeSnapshot(directory: string, sessionID: string, messages: SessionMessageBundle[] = []): SessionRuntimeSnapshot {
  return {
    directory,
    sessionID,
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  };
}

export function applyOpencodeProjectEvent(project: ProjectBootstrap | null | undefined, event: OpencodeEvent) {
  if (!project) {
    return project ?? null;
  }
  switch (String(event.type)) {
    case "session.created":
    case "session.updated": {
      const info = ((event.properties as { info?: Session }).info);
      if (!info) {
        return project;
      }
      const sessions = sortSessionsByUpdated(upsertById(project.sessions, info));
      const sessionStatus = { ...project.sessionStatus };
      if (info.time.archived) {
        delete sessionStatus[info.id];
        return {
          ...project,
          sessions: sessions.filter((session) => session.id !== info.id),
          sessionStatus,
        };
      }
      return {
        ...project,
        sessions,
      };
    }
    case "session.deleted": {
      const info = ((event.properties as { info?: Session }).info);
      if (!info) {
        return project;
      }
      const sessionStatus = { ...project.sessionStatus };
      delete sessionStatus[info.id];
      return {
        ...project,
        sessions: project.sessions.filter((session) => session.id !== info.id),
        sessionStatus,
      };
    }
    case "session.status": {
      const props = event.properties as { sessionID?: string; status?: SessionStatus };
      if (!props?.sessionID || !props.status) {
        return project;
      }
      return {
        ...project,
        sessionStatus: {
          ...project.sessionStatus,
          [props.sessionID]: props.status,
        },
      };
    }
    case "session.idle": {
      const sessionID = getSessionIdFromEvent(event);
      if (!sessionID) {
        return project;
      }
      return {
        ...project,
        sessionStatus: {
          ...project.sessionStatus,
          [sessionID]: { type: "idle" } as SessionStatus,
        },
      };
    }
    case "session.error": {
      const props = event.properties as { sessionID?: string; error?: { message?: string } };
      if (!props?.sessionID) {
        return project;
      }
      return {
        ...project,
        sessionStatus: {
          ...project.sessionStatus,
          [props.sessionID]: { type: "error", message: props.error?.message } as unknown as SessionStatus,
        },
      };
    }
    case "permission.asked": {
      const permission = event.properties as PermissionRequest;
      if (!permission?.id) {
        return project;
      }
      return {
        ...project,
        permissions: upsertById(project.permissions, permission),
      };
    }
    case "permission.replied": {
      const props = event.properties as { requestID?: string };
      if (!props?.requestID) {
        return project;
      }
      return {
        ...project,
        permissions: removeById(project.permissions, props.requestID),
      };
    }
    case "question.asked": {
      const question = event.properties as QuestionRequest;
      if (!question?.id) {
        return project;
      }
      return {
        ...project,
        questions: upsertById(project.questions, question),
      };
    }
    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { requestID?: string };
      if (!props?.requestID) {
        return project;
      }
      return {
        ...project,
        questions: removeById(project.questions, props.requestID),
      };
    }
    default:
      return project;
  }
}

export function applyOpencodeSessionEvent(input: {
  directory: string;
  sessionID: string;
  snapshot: SessionRuntimeSnapshot | null;
  messages: SessionMessageBundle[];
  event: OpencodeEvent;
}) {
  const eventSessionID = getSessionIdFromEvent(input.event);
  if (eventSessionID && eventSessionID !== input.sessionID) {
    return {
      snapshot: input.snapshot,
      messages: input.messages,
      todoItems: undefined as Todo[] | undefined,
      changed: false,
    };
  }

  let snapshot = input.snapshot ?? createEmptyRuntimeSnapshot(input.directory, input.sessionID, input.messages);
  let messages = input.messages;
  let todoItems: Todo[] | undefined;
  let changed = false;

  switch (String(input.event.type)) {
    case "session.created":
    case "session.updated": {
      const info = ((input.event.properties as { info?: Session }).info);
      if (info) {
        snapshot = { ...snapshot, session: info };
        changed = true;
      }
      break;
    }
    case "session.status": {
      const props = input.event.properties as { status?: SessionStatus };
      if (props?.status) {
        snapshot = { ...snapshot, sessionStatus: props.status };
        changed = true;
      }
      break;
    }
    case "session.idle": {
      snapshot = { ...snapshot, sessionStatus: { type: "idle" } as SessionStatus };
      changed = true;
      break;
    }
    case "session.error": {
      const props = input.event.properties as { error?: { message?: string } };
      snapshot = { ...snapshot, sessionStatus: { type: "error", message: props?.error?.message } as unknown as SessionStatus };
      changed = true;
      break;
    }
    case "session.diff": {
      const props = input.event.properties as { diff?: FileDiff[] };
      snapshot = { ...snapshot, sessionDiff: props?.diff ?? [] };
      changed = true;
      break;
    }
    case "todo.updated": {
      const props = input.event.properties as { todos?: Todo[] };
      todoItems = props?.todos ?? [];
      break;
    }
    case "permission.asked": {
      const permission = input.event.properties as PermissionRequest;
      if (permission?.id) {
        snapshot = { ...snapshot, permissions: upsertById(snapshot.permissions, permission) };
        changed = true;
      }
      break;
    }
    case "permission.replied": {
      const props = input.event.properties as { requestID?: string };
      if (props?.requestID) {
        snapshot = { ...snapshot, permissions: removeById(snapshot.permissions, props.requestID) };
        changed = true;
      }
      break;
    }
    case "question.asked": {
      const question = input.event.properties as QuestionRequest;
      if (question?.id) {
        snapshot = { ...snapshot, questions: upsertById(snapshot.questions, question) };
        changed = true;
      }
      break;
    }
    case "question.replied":
    case "question.rejected": {
      const props = input.event.properties as { requestID?: string };
      if (props?.requestID) {
        snapshot = { ...snapshot, questions: removeById(snapshot.questions, props.requestID) };
        changed = true;
      }
      break;
    }
    case "message.created":
    case "message.updated": {
      const info = ((input.event.properties as { info?: Message }).info);
      if (info) {
        messages = upsertMessage(messages, info);
        snapshot = { ...snapshot, messages };
        changed = true;
      }
      break;
    }
    case "message.removed": {
      const props = input.event.properties as { messageID?: string };
      if (props?.messageID) {
        messages = removeMessage(messages, props.messageID);
        snapshot = { ...snapshot, messages };
        changed = true;
      }
      break;
    }
    case "message.part.created":
    case "message.part.updated":
    case "message.part.added": {
      const part = ((input.event.properties as { part?: Part }).part);
      if (part) {
        messages = upsertPart(messages, part);
        snapshot = { ...snapshot, messages };
        changed = true;
      }
      break;
    }
    case "message.part.removed": {
      const props = input.event.properties as { messageID?: string; partID?: string };
      if (props?.messageID && props?.partID) {
        messages = removePart(messages, props.messageID, props.partID);
        snapshot = { ...snapshot, messages };
        changed = true;
      }
      break;
    }
    case "message.part.delta": {
      const props = input.event.properties as { messageID?: string; partID?: string; field?: string; delta?: string };
      if (props?.messageID && props?.partID && props?.field && typeof props.delta === "string") {
        messages = appendPartDelta(messages, props.messageID, props.partID, props.field, props.delta);
        snapshot = { ...snapshot, messages };
        changed = true;
      }
      break;
    }
  }

  return { snapshot, messages, todoItems, changed };
}
