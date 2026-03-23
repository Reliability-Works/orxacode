import type { Pty } from "@opencode-ai/sdk/v2/client";
import { CLAUDE_SESSION_PTY_TITLE_PREFIX } from "@shared/ipc";

function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
}

export function isClaudeOwnedPty(pty: Pick<Pty, "title">) {
  const title = normalizeTitle(pty.title);
  return (
    title.startsWith(CLAUDE_SESSION_PTY_TITLE_PREFIX) ||
    title === "claude code" ||
    title === "claude code (full)"
  );
}

export function filterComposerTerminalPtys<T extends Pick<Pty, "title">>(ptys: T[]) {
  return ptys.filter((pty) => !isClaudeOwnedPty(pty));
}
