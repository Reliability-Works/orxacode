export type TerminalConnectResult = {
  ptyID: string;
  directory: string;
  connected: boolean;
};

export const CLAUDE_SESSION_PTY_TITLE_PREFIX = "__orxa_claude_session__";

export type ClaudeTerminalCreateResult = {
  processId: string;
  directory: string;
};

export type ClaudeTerminalMode = "standard" | "full";
