export type CodexDoctorResult = {
  version: string;
  appServer: "ok" | "error" | "unknown";
  node: "ok" | "error" | "unknown";
  path: string;
  raw: string;
};

export type CodexUpdateResult = {
  ok: boolean;
  message: string;
};

export type CodexModelEntry = {
  id: string;
  model: string;
  name: string;
  isDefault: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
};

export type CodexCollaborationMode = {
  id: string;
  label: string;
  mode: string;
  model: string;
  reasoningEffort: string;
  developerInstructions: string;
};

export type CodexConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type CodexState = {
  status: CodexConnectionStatus;
  serverInfo?: { name: string; version: string };
  lastError?: string;
};

export type CodexThread = {
  id: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  status?: { type: string };
  ephemeral?: boolean;
};

export type CodexRunMetadata = {
  title: string;
  worktreeName: string;
};

export type CodexThreadRuntime = {
  thread: CodexThread | null;
  childThreads: CodexThread[];
};

export type CodexNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexApprovalRequest = {
  id: number;
  method: string;
  itemId: string;
  threadId: string;
  turnId: string;
  reason: string;
  command?: string[];
  commandActions?: string[];
  availableDecisions: string[];
  changes?: Array<{
    path: string;
    type: string;
    insertions?: number;
    deletions?: number;
  }>;
};

export type CodexUserInputRequest = {
  id: number;
  method: string;
  threadId: string;
  turnId: string;
  itemId: string;
  message: string;
};
