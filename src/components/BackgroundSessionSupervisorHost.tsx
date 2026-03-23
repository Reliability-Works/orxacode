import { ClaudeChatBackgroundSessionManager } from "./ClaudeChatBackgroundSessionManager";
import { ClaudeBackgroundSessionManager } from "./ClaudeTerminalPane";
import { CodexBackgroundSessionManager } from "./CodexBackgroundSessionManager";
import { OpencodeBackgroundSessionManager } from "./OpencodeBackgroundSessionManager";

type BackgroundCodexSession = {
  directory: string;
  sessionStorageKey: string;
};

type BackgroundOpencodeSession = {
  directory: string;
  sessionID: string;
};

type BackgroundClaudeSession = {
  directory: string;
  sessionStorageKey: string;
};

type BackgroundClaudeChatSession = {
  directory: string;
  sessionStorageKey: string;
};

type Props = {
  codexSessions: BackgroundCodexSession[];
  opencodeSessions: BackgroundOpencodeSession[];
  claudeSessions: BackgroundClaudeSession[];
  claudeChatSessions: BackgroundClaudeChatSession[];
  codexPath?: string;
  codexArgs?: string;
};

export function BackgroundSessionSupervisorHost({
  codexSessions,
  opencodeSessions,
  claudeSessions,
  claudeChatSessions,
  codexPath,
  codexArgs,
}: Props) {
  return (
    <>
      {codexSessions.map((session) => (
        <CodexBackgroundSessionManager
          key={`codex:${session.sessionStorageKey}`}
          directory={session.directory}
          sessionStorageKey={session.sessionStorageKey}
          codexPath={codexPath}
          codexArgs={codexArgs}
        />
      ))}
      {opencodeSessions.map((session) => (
        <OpencodeBackgroundSessionManager
          key={`opencode:${session.directory}:${session.sessionID}`}
          directory={session.directory}
          sessionID={session.sessionID}
        />
      ))}
      {claudeSessions.map((session) => (
        <ClaudeBackgroundSessionManager
          key={`claude:${session.sessionStorageKey}`}
          directory={session.directory}
          sessionStorageKey={session.sessionStorageKey}
        />
      ))}
      {claudeChatSessions.map((session) => (
        <ClaudeChatBackgroundSessionManager
          key={`claude-chat:${session.sessionStorageKey}`}
          directory={session.directory}
          sessionStorageKey={session.sessionStorageKey}
        />
      ))}
    </>
  );
}
