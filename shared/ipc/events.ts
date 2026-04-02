import type { BrowserAgentActionResult, BrowserHistoryItem, BrowserState } from './browser'
import type {
  ClaudeChatApprovalRequest,
  ClaudeChatNotification,
  ClaudeChatState,
  ClaudeChatUserInputRequest,
} from './claude-chat'
import type {
  CodexApprovalRequest,
  CodexNotification,
  CodexState,
  CodexUserInputRequest,
} from './codex'
import type { ContextSelectionTrace, ArtifactRecord } from './artifacts'
import type { McpDevToolsServerStatus } from './mcp-devtools'
import type { RuntimeState } from './runtime'
import type { UpdateReleaseChannel } from './updates'
import type { AppDiagnosticEntry } from './app'
import type { PerfAlert } from './perf'
import type {
  KanbanBoardSnapshot,
  KanbanManagementSession,
  KanbanRun,
  KanbanScriptShortcutResult,
  KanbanTask,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
  KanbanTaskRuntime,
  KanbanWorktree,
  KanbanWorktreeStatusDetail,
} from './kanban'
import type { SessionRuntimeSnapshot } from './opencode-core'
import type { Event as OpencodeEvent } from '@opencode-ai/sdk/v2/client'

type StreamEventSummary = OpencodeEvent

export type OrxaEvent =
  | {
      type: 'runtime.status'
      payload: RuntimeState
    }
  | {
      type: 'runtime.error'
      payload: {
        message: string
      }
    }
  | {
      type: 'app.command'
      payload: {
        command:
          | 'open-settings'
          | 'toggle-workspace-sidebar'
          | 'toggle-operations-sidebar'
          | 'toggle-browser-sidebar'
      }
    }
  | {
      type: 'app.diagnostic'
      payload: AppDiagnosticEntry
    }
  | {
      type: 'perf.alert'
      payload: PerfAlert
    }
  | {
      type: 'opencode.global'
      payload: {
        directory?: string
        event: StreamEventSummary
      }
    }
  | {
      type: 'opencode.project'
      payload: {
        directory: string
        sessionID?: string
        cursor?: number
        event: StreamEventSummary
      }
    }
  | {
      type: 'opencode.session'
      payload: {
        directory: string
        sessionID: string
        cursor?: number
        event: StreamEventSummary
      }
    }
  | {
      type: 'opencode.session.runtime'
      payload: {
        directory: string
        sessionID: string
        cursor?: number
        runtime: SessionRuntimeSnapshot
      }
    }
  | {
      type: 'pty.output'
      payload: {
        ptyID: string
        directory: string
        chunk: string
      }
    }
  | {
      type: 'pty.closed'
      payload: {
        ptyID: string
        directory: string
      }
    }
  | {
      type: 'updater.telemetry'
      payload: {
        phase:
          | 'check.start'
          | 'check.success'
          | 'check.error'
          | 'update.available'
          | 'download.start'
          | 'download.progress'
          | 'download.complete'
          | 'install.start'
        manual: boolean
        releaseChannel: UpdateReleaseChannel
        durationMs?: number
        percent?: number
        message?: string
        version?: string
      }
    }
  | {
      type: 'browser.state'
      payload: BrowserState
    }
  | {
      type: 'browser.history.added'
      payload: BrowserHistoryItem
    }
  | {
      type: 'browser.history.cleared'
      payload: {
        count: number
      }
    }
  | {
      type: 'browser.agent.action'
      payload: BrowserAgentActionResult
    }
  | {
      type: 'browser.inspect.annotation'
      payload: {
        element: string
        selector: string
        boundingBox?: { x: number; y: number; width: number; height: number }
        computedStyles?: string
      }
    }
  | {
      type: 'artifact.created'
      payload: ArtifactRecord
    }
  | {
      type: 'context.selection'
      payload: ContextSelectionTrace
    }
  | {
      type: 'mcp.devtools.status'
      payload: McpDevToolsServerStatus
    }
  | {
      type: 'codex.state'
      payload: CodexState
    }
  | {
      type: 'codex.notification'
      payload: CodexNotification
    }
  | {
      type: 'codex.approval'
      payload: CodexApprovalRequest
    }
  | {
      type: 'codex.userInput'
      payload: CodexUserInputRequest
    }
  | {
      type: 'claude-chat.state'
      payload: ClaudeChatState
    }
  | {
      type: 'claude-chat.notification'
      payload: ClaudeChatNotification
    }
  | {
      type: 'claude-chat.approval'
      payload: ClaudeChatApprovalRequest
    }
  | {
      type: 'claude-chat.userInput'
      payload: ClaudeChatUserInputRequest
    }
  | {
      type: 'kanban.board'
      payload: {
        workspaceDir: string
        snapshot: KanbanBoardSnapshot
      }
    }
  | {
      type: 'kanban.task'
      payload: {
        workspaceDir: string
        task: KanbanTask
      }
    }
  | {
      type: 'kanban.run'
      payload: {
        workspaceDir: string
        run: KanbanRun
      }
    }
  | {
      type: 'kanban.taskDetail'
      payload: {
        workspaceDir: string
        detail: KanbanTaskDetail
      }
    }
  | {
      type: 'kanban.runtime'
      payload: {
        workspaceDir: string
        runtime: KanbanTaskRuntime
      }
    }
  | {
      type: 'kanban.worktree'
      payload: {
        workspaceDir: string
        worktree: KanbanWorktree
        detail?: KanbanWorktreeStatusDetail
      }
    }
  | {
      type: 'kanban.checkpoint'
      payload: {
        workspaceDir: string
        taskId: string
        checkpoint: KanbanTaskCheckpoint
      }
    }
  | {
      type: 'kanban.shortcut'
      payload: {
        workspaceDir: string
        taskId: string
        result: KanbanScriptShortcutResult
      }
    }
  | {
      type: 'kanban.management'
      payload: {
        workspaceDir: string
        session: KanbanManagementSession
      }
    }
