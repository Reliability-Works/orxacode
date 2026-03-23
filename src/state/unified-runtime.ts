import type {
  ClaudeChatApprovalRequest,
  ClaudeChatUserInputRequest,
  CodexApprovalRequest,
  CodexState,
  CodexThread,
  CodexUserInputRequest,
  SessionMessageBundle,
  SessionRuntimeSnapshot,
} from "@shared/ipc";
import type { TodoItem } from "../components/chat/TodoDock";
import type { ClaudeChatMessageItem } from "../hooks/useClaudeChatSession";
import type { ClaudeChatSubagentState } from "../hooks/useClaudeChatSession";
import type { SubagentInfo, CodexMessageItem } from "../hooks/useCodexSession";

export type UnifiedProvider = "opencode" | "codex" | "claude-chat";

export type UnifiedSessionStatusType = "none" | "busy" | "awaiting" | "unread" | "plan_ready";

export type UnifiedSessionStatus = {
  type: UnifiedSessionStatusType;
  busy: boolean;
  awaiting: boolean;
  unread: boolean;
  planReady: boolean;
  activityAt: number;
};

export type UnifiedPendingApproval =
  | {
      provider: "opencode";
      request: unknown;
    }
  | {
      provider: "codex";
      request: CodexApprovalRequest;
    };

export type UnifiedPendingUserInput =
  | {
      provider: "opencode";
      request: unknown;
    }
  | {
      provider: "codex";
      request: CodexUserInputRequest;
    };

export type UnifiedTurnDiffSummary = {
  id: string;
  path: string;
  type: string;
  diff?: string;
  insertions?: number;
  deletions?: number;
  timestamp: number;
};

export type UnifiedBackgroundAgent = SubagentInfo;

export type UnifiedChatMessage =
  | {
      id: string;
      provider: UnifiedProvider;
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }
  | {
      id: string;
      provider: "opencode";
      bundle: SessionMessageBundle;
      timestamp: number;
    }
  | {
      id: string;
      provider: "codex";
      item: CodexMessageItem;
      timestamp: number;
    };

export type UnifiedWorkLogEntry =
  | {
      id: string;
      createdAt: number;
      kind: "thinking";
      summary?: string;
      detail?: string;
    }
  | {
      id: string;
      createdAt: number;
      kind: "tool";
      title: string;
      status: "pending" | "running" | "completed" | "error";
      command?: string;
      output?: string;
      detail?: string;
      failure?: string;
    }
  | {
      id: string;
      createdAt: number;
      kind: "diff";
      summary: UnifiedTurnDiffSummary;
    }
  | {
      id: string;
      createdAt: number;
      kind: "notice";
      label: string;
      detail?: string;
      tone?: "info" | "error";
    };

export type UnifiedTimelineRow =
  | {
      id: string;
      kind: "message";
      message: UnifiedChatMessage;
    }
  | {
      id: string;
      kind: "work";
      entry: UnifiedWorkLogEntry;
    };

export type OpencodeSessionRuntimeSnapshot = SessionRuntimeSnapshot;

export type CodexThreadRuntimeSnapshot = {
  thread: CodexThread | null;
  childThreads: CodexThread[];
};

export type UnifiedThreadRecord = {
  key: string;
  provider: UnifiedProvider;
  workspaceDirectory: string;
  externalID: string;
  title?: string;
  status: UnifiedSessionStatus;
  timelineRows: UnifiedTimelineRow[];
  pendingApproval: UnifiedPendingApproval | null;
  pendingUserInput: UnifiedPendingUserInput | null;
  backgroundAgents: UnifiedBackgroundAgent[];
  planItems: TodoItem[];
};

export type UnifiedOpencodeSessionRuntime = {
  key: string;
  directory: string;
  sessionID: string;
  runtimeSnapshot: OpencodeSessionRuntimeSnapshot | null;
  messages: SessionMessageBundle[];
  todoItems: TodoItem[];
};

export type UnifiedCodexSessionRuntime = {
  key: string;
  directory: string;
  connectionStatus: CodexState["status"];
  serverInfo?: CodexState["serverInfo"];
  thread: CodexThread | null;
  runtimeSnapshot: CodexThreadRuntimeSnapshot | null;
  messages: CodexMessageItem[];
  pendingApproval: CodexApprovalRequest | null;
  pendingUserInput: CodexUserInputRequest | null;
  isStreaming: boolean;
  lastError?: string;
  threadName?: string;
  planItems: TodoItem[];
  dismissedPlanIds: string[];
  subagents: SubagentInfo[];
  activeSubagentThreadId: string | null;
};

export type UnifiedClaudeChatSessionRuntime = {
  key: string;
  directory: string;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  providerThreadId: string | null;
  activeTurnId: string | null;
  messages: ClaudeChatMessageItem[];
  historyMessages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    sessionId: string;
  }[];
  pendingApproval: ClaudeChatApprovalRequest | null;
  pendingUserInput: ClaudeChatUserInputRequest | null;
  isStreaming: boolean;
  lastError?: string;
  subagents: ClaudeChatSubagentState[];
};

export function makeUnifiedSessionKey(provider: UnifiedProvider, workspaceDirectory: string, externalID: string) {
  return `${provider}::${workspaceDirectory}::${externalID}`;
}

export function deriveUnreadState(latestActivityAt: number, lastReadAt: number | undefined, isActive: boolean) {
  if (isActive) {
    return false;
  }
  if (!latestActivityAt) {
    return false;
  }
  return latestActivityAt > (lastReadAt ?? 0);
}

export function deriveUnifiedSessionStatus(input: {
  busy: boolean;
  awaiting: boolean;
  planReady?: boolean;
  activityAt?: number;
  lastReadAt?: number;
  isActive: boolean;
}) {
  const unread = deriveUnreadState(input.activityAt ?? 0, input.lastReadAt, input.isActive);
  const planReady = Boolean(input.planReady);
  let type: UnifiedSessionStatusType = "none";
  if (input.awaiting) {
    type = "awaiting";
  } else if (input.busy) {
    type = "busy";
  } else if (planReady) {
    type = "plan_ready";
  } else if (unread) {
    type = "unread";
  }
  return {
    type,
    busy: input.busy,
    awaiting: input.awaiting,
    unread,
    planReady,
    activityAt: input.activityAt ?? 0,
  } satisfies UnifiedSessionStatus;
}
