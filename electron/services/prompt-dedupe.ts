import type { SessionMessageBundle } from "../../shared/ipc";

function firstUserText(parts: SessionMessageBundle["parts"]) {
  for (const part of parts) {
    if (part.type !== "text") {
      continue;
    }
    const text = part.text.trim();
    if (!text || text.startsWith("[SUPERMEMORY]")) {
      continue;
    }
    if ("ignored" in part && part.ignored) {
      continue;
    }
    if ("synthetic" in part && part.synthetic) {
      continue;
    }
    return text;
  }
  return "";
}

export function hasRecentMatchingUserPrompt(
  messages: SessionMessageBundle[],
  text: string,
  sentAtEpochMs: number,
  skewAllowanceMs = 3_000,
) {
  const target = text.trim();
  if (!target) {
    return false;
  }
  const minCreatedAt = Math.max(0, sentAtEpochMs - skewAllowanceMs);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const bundle = messages[index];
    if (bundle.info.role !== "user") {
      continue;
    }
    if (bundle.info.time.created < minCreatedAt) {
      continue;
    }
    const messageText = firstUserText(bundle.parts);
    if (messageText === target) {
      return true;
    }
  }
  return false;
}
