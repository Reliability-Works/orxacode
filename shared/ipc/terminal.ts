export type TerminalConnectResult = {
  ptyID: string;
  directory: string;
  connected: boolean;
};

export type ClaudeTerminalCreateResult = {
  processId: string;
  directory: string;
};

export type ClaudeTerminalMode = "standard" | "full";
