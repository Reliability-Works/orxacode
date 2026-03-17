import type { BrowserAgentActionResult, BrowserHistoryItem, BrowserState } from "./browser";
import type { CodexApprovalRequest, CodexNotification, CodexState, CodexUserInputRequest } from "./codex";
import type { ContextSelectionTrace, MemoryBackfillStatus, ArtifactRecord } from "./memory-artifacts";
import type { McpDevToolsServerStatus } from "./mcp-devtools";
import type { RuntimeState } from "./runtime";
import type { UpdateReleaseChannel } from "./updates";

type StreamEventSummary = {
  type: string;
  properties?: Record<string, unknown>;
};

export type OrxaEvent =
  | {
      type: "runtime.status";
      payload: RuntimeState;
    }
  | {
      type: "runtime.error";
      payload: {
        message: string;
      };
    }
  | {
      type: "opencode.global";
      payload: {
        directory?: string;
        event: StreamEventSummary;
      };
    }
  | {
      type: "opencode.project";
      payload: {
        directory: string;
        event: StreamEventSummary;
      };
    }
  | {
      type: "pty.output";
      payload: {
        ptyID: string;
        directory: string;
        chunk: string;
      };
    }
  | {
      type: "pty.closed";
      payload: {
        ptyID: string;
        directory: string;
      };
    }
  | {
      type: "claude-terminal.output";
      payload: {
        processId: string;
        directory: string;
        chunk: string;
      };
    }
  | {
      type: "claude-terminal.closed";
      payload: {
        processId: string;
        directory: string;
        exitCode: number | null;
      };
    }
  | {
      type: "updater.telemetry";
      payload: {
        phase:
          | "check.start"
          | "check.success"
          | "check.error"
          | "update.available"
          | "download.start"
          | "download.progress"
          | "download.complete"
          | "install.start";
        manual: boolean;
        releaseChannel: UpdateReleaseChannel;
        durationMs?: number;
        percent?: number;
        message?: string;
        version?: string;
      };
    }
  | {
      type: "memory.backfill";
      payload: MemoryBackfillStatus;
    }
  | {
      type: "browser.state";
      payload: BrowserState;
    }
  | {
      type: "browser.history.added";
      payload: BrowserHistoryItem;
    }
  | {
      type: "browser.history.cleared";
      payload: {
        count: number;
      };
    }
  | {
      type: "browser.agent.action";
      payload: BrowserAgentActionResult;
    }
  | {
      type: "artifact.created";
      payload: ArtifactRecord;
    }
  | {
      type: "context.selection";
      payload: ContextSelectionTrace;
    }
  | {
      type: "mcp.devtools.status";
      payload: McpDevToolsServerStatus;
    }
  | {
      type: "codex.state";
      payload: CodexState;
    }
  | {
      type: "codex.notification";
      payload: CodexNotification;
    }
  | {
      type: "codex.approval";
      payload: CodexApprovalRequest;
    }
  | {
      type: "codex.userInput";
      payload: CodexUserInputRequest;
    };
