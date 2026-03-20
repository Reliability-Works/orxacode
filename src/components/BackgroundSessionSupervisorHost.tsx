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

type Props = {
  codexSessions: BackgroundCodexSession[];
  opencodeSessions: BackgroundOpencodeSession[];
  claudeSessions: BackgroundClaudeSession[];
  codexPath?: string;
  codexArgs?: string;
};

export function BackgroundSessionSupervisorHost({
  codexSessions,
  opencodeSessions,
  claudeSessions,
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
    </>
  );
}
