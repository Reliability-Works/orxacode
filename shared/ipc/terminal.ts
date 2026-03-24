export type OrxaTerminalOwner = "workspace" | "canvas" | "claude";

export type OrxaTerminalSession = {
  id: string;
  directory: string;
  cwd: string;
  title: string;
  owner: OrxaTerminalOwner;
  status: "running" | "exited";
  pid: number;
  exitCode: number | null;
  createdAt: number;
};

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
