import { ClaudeChatBackgroundSessionManager } from "./ClaudeChatBackgroundSessionManager";
import { ClaudeBackgroundSessionManager } from "./ClaudeTerminalPane";
import { CodexBackgroundSessionManager } from "./CodexBackgroundSessionManager";
import { OpencodeBackgroundSessionManager } from "./OpencodeBackgroundSessionManager";
import type { BackgroundSessionDescriptor } from "../lib/background-session-descriptors";

type Props = {
  sessions: BackgroundSessionDescriptor[];
  codexPath?: string;
  codexArgs?: string;
};

export function BackgroundSessionSupervisorHost({
  sessions,
  codexPath,
  codexArgs,
}: Props) {
  return (
    <>
      {sessions.map((session) => {
        if (session.provider === "codex" && session.sessionStorageKey) {
          return (
            <CodexBackgroundSessionManager
              key={session.key}
              directory={session.directory}
              sessionStorageKey={session.sessionStorageKey}
              codexPath={codexPath}
              codexArgs={codexArgs}
            />
          );
        }
        if (session.provider === "opencode" && session.sessionID) {
          return (
            <OpencodeBackgroundSessionManager
              key={session.key}
              directory={session.directory}
              sessionID={session.sessionID}
            />
          );
        }
        if (session.provider === "claude" && session.sessionStorageKey) {
          return (
            <ClaudeBackgroundSessionManager
              key={session.key}
              directory={session.directory}
              sessionStorageKey={session.sessionStorageKey}
            />
          );
        }
        if (session.provider === "claude-chat" && session.sessionStorageKey) {
          return (
            <ClaudeChatBackgroundSessionManager
              key={session.key}
              directory={session.directory}
              sessionStorageKey={session.sessionStorageKey}
            />
          );
        }
        return null;
      })}
    </>
  );
}
