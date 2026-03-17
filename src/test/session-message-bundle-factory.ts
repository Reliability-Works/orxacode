import type { SessionMessageBundle } from "@shared/ipc";

type BundleInput = {
  id: string;
  role: "user" | "assistant";
  sessionID?: string;
  createdAt?: number;
  updatedAt?: number;
  parts?: Array<Record<string, unknown>>;
};

type TextPartInput = {
  id: string;
  sessionID: string;
  messageID: string;
  text: string;
};

export function createTextPart({ id, sessionID, messageID, text }: TextPartInput): Record<string, unknown> {
  return {
    id,
    type: "text",
    sessionID,
    messageID,
    text,
  };
}

export function createSessionMessageBundle({
  id,
  role,
  sessionID = "session-1",
  createdAt = Date.now(),
  updatedAt = createdAt,
  parts = [],
}: BundleInput): SessionMessageBundle {
  return {
    info: ({
      id,
      role,
      sessionID,
      time: { created: createdAt, updated: updatedAt },
    } as unknown) as SessionMessageBundle["info"],
    parts: parts as SessionMessageBundle["parts"],
  };
}
