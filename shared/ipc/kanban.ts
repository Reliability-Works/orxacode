import type { GitBranchState } from './opencode-core'
import type { OrxaTerminalSession, TerminalConnectResult } from './terminal'
import type { ClaudeChatEffort } from './claude-chat'

export type KanbanProvider = 'opencode' | 'codex' | 'claude'

export type KanbanColumnId = 'backlog' | 'ready' | 'in_progress' | 'review' | 'done'

export type KanbanTaskTrashStatus = 'active' | 'trashed'

export type KanbanTaskActivityKind =
  | 'assistant'
  | 'tool'
  | 'permission'
  | 'question'
  | 'review'
  | 'ship'
  | 'system'
  | 'merge'

export type KanbanMergeStatus = 'clean' | 'conflicted' | 'merged'

export type KanbanWorkspace = {
  directory: string
  name: string
  createdAt: number
  updatedAt: number
}

export type KanbanTaskStatusSummary =
  | 'idle'
  | 'starting'
  | 'running'
  | 'awaiting_review'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'stopped'

export type KanbanRuntimeStatus = KanbanTaskStatusSummary | 'archived'

export type KanbanSchedule =
  | {
      type: 'daily'
      time: string
      days: number[]
    }
  | {
      type: 'interval'
      intervalMinutes: number
    }

export type KanbanScriptShortcut = {
  id: string
  name: string
  command: string
}

export type KanbanOpenCodeTaskConfig = {
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
}

export type KanbanCodexTaskConfig = {
  model?: string
  reasoningEffort?: string
}

export type KanbanClaudeTaskConfig = {
  model?: string
  effort?: ClaudeChatEffort
}

export type KanbanTaskProviderConfig = {
  opencode?: KanbanOpenCodeTaskConfig
  codex?: KanbanCodexTaskConfig
  claude?: KanbanClaudeTaskConfig
}

export type KanbanWorktreeInclude = {
  filePath?: string
  detected: boolean
  source: 'worktreeinclude' | 'generated_from_gitignore' | 'none'
  entries: string[]
  updatedAt: number
}

export type KanbanSettings = {
  workspaceDir: string
  autoCommit: boolean
  autoPr: boolean
  defaultProvider: KanbanProvider
  providerDefaults: KanbanTaskProviderConfig
  scriptShortcuts: KanbanScriptShortcut[]
  worktreeInclude: KanbanWorktreeInclude
  updatedAt: number
}

export type KanbanAutomation = {
  id: string
  workspaceDir: string
  name: string
  prompt: string
  provider: KanbanProvider
  browserModeEnabled: boolean
  enabled: boolean
  autoStart: boolean
  schedule: KanbanSchedule
  lastRunAt?: number
  createdAt: number
  updatedAt: number
}

export type KanbanTask = {
  id: string
  workspaceDir: string
  title: string
  prompt: string
  description: string
  provider: KanbanProvider
  providerConfig?: KanbanTaskProviderConfig
  columnId: KanbanColumnId
  position: number
  statusSummary: KanbanTaskStatusSummary
  worktreePath?: string
  baseRef?: string
  taskBranch?: string
  providerSessionKey?: string
  providerThreadId?: string
  latestRunId?: string
  autoStartWhenUnblocked: boolean
  blocked: boolean
  shipStatus?: 'unshipped' | 'committed' | 'pr_opened' | 'merged' | 'trashed_after_merge'
  trashStatus: KanbanTaskTrashStatus
  restoreColumnId?: KanbanColumnId
  latestPreview?: string
  latestActivityKind?: KanbanTaskActivityKind
  mergeStatus?: KanbanMergeStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  trashedAt?: number
}

export type KanbanTaskDependency = {
  id: string
  workspaceDir: string
  fromTaskId: string
  toTaskId: string
  createdAt: number
}

export type KanbanRunLogItem = {
  id: string
  kind: 'system' | 'provider_event' | 'review_feedback' | 'ship'
  level?: 'info' | 'error'
  message: string
  timestamp: number
}

export type KanbanRun = {
  id: string
  workspaceDir: string
  taskId?: string
  automationId?: string
  provider: KanbanProvider
  status: 'running' | 'completed' | 'failed' | 'stopped'
  sessionKey?: string
  providerThreadId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  shipStatus?: 'unshipped' | 'committed' | 'pr_opened' | 'merged' | 'trashed_after_merge'
  error?: string
  logs: KanbanRunLogItem[]
}

export type KanbanReviewComment = {
  id: string
  workspaceDir: string
  taskId: string
  runId?: string
  filePath: string
  line: number
  body: string
  createdAt: number
}

export type KanbanTaskRuntime = {
  taskId: string
  workspaceDir: string
  provider: KanbanProvider
  status: KanbanRuntimeStatus
  resumeToken?: string
  terminalId?: string
  worktreePath?: string
  baseRef?: string
  taskBranch?: string
  lastEventSummary?: string
  latestPreview?: string
  latestActivityKind?: KanbanTaskActivityKind
  mergeStatus?: KanbanMergeStatus
  trashStatus: KanbanTaskTrashStatus
  checkpointCursor?: string
  lastCheckpointId?: string
  updatedAt: number
  trashedAt?: number
}

export type KanbanWorktree = {
  id: string
  workspaceDir: string
  taskId?: string
  label: string
  provider?: KanbanProvider
  repoRoot: string
  directory: string
  branch: string
  baseRef: string
  status: 'ready' | 'active' | 'stopped' | 'conflicted' | 'merged' | 'trashed'
  mergeStatus: KanbanMergeStatus
  latestPreview?: string
  latestActivityKind?: KanbanTaskActivityKind
  createdAt: number
  updatedAt: number
  trashedAt?: number
}

export type KanbanWorktreeStatusDetail = {
  worktree: KanbanWorktree
  gitState: KanbanGitState
  conflicts: string[]
  hasChanges: boolean
}

export type KanbanScriptShortcutResult = {
  shortcutId: string
  command: string
  cwd: string
  ok: boolean
  exitCode: number
  output: string
  createdAt: number
}

export type KanbanTaskCheckpoint = {
  id: string
  workspaceDir: string
  taskId: string
  runId?: string
  label: string
  source: 'start' | 'review' | 'ship' | 'manual' | 'automation'
  sessionKey?: string
  providerThreadId?: string
  gitRevision?: string
  diffRaw: string
  createdAt: number
}

export type KanbanDiffLine = {
  type: 'context' | 'add' | 'del'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

export type KanbanDiffHunk = {
  header: string
  lines: KanbanDiffLine[]
}

export type KanbanDiffFile = {
  oldPath: string
  newPath: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  hunks: KanbanDiffHunk[]
}

export type KanbanCheckpointDiff = {
  workspaceDir: string
  taskId: string
  fromCheckpointId: string
  toCheckpointId?: string
  raw: string
  files: KanbanDiffFile[]
}

export type KanbanGitCommitEntry = {
  hash: string
  shortHash: string
  subject: string
  author: string
  relativeTime: string
}

export type KanbanGitState = {
  workspaceDir: string
  repoRoot: string
  branchState: GitBranchState
  statusText: string
  commits: KanbanGitCommitEntry[]
  graphText: string
}

export type KanbanManagementTranscriptItem = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export type KanbanManagementOperation =
  | {
      type: 'create_task'
      title: string
      prompt: string
      description?: string
      provider?: KanbanProvider
      columnId?: KanbanColumnId
      autoStartWhenUnblocked?: boolean
    }
  | {
      type: 'update_task'
      taskId: string
      title?: string
      prompt?: string
      description?: string
      provider?: KanbanProvider
      autoStartWhenUnblocked?: boolean
    }
  | {
      type: 'link_tasks'
      fromTaskId: string
      toTaskId: string
    }
  | {
      type: 'start_task'
      taskId: string
    }
  | {
      type: 'resume_task'
      taskId: string
    }
  | {
      type: 'stop_task'
      taskId: string
    }
  | {
      type: 'trash_task'
      taskId: string
    }
  | {
      type: 'restore_task'
      taskId: string
    }
  | {
      type: 'unlink_tasks'
      fromTaskId: string
      toTaskId: string
    }
  | {
      type: 'create_worktree'
      label: string
      baseRef?: string
    }
  | {
      type: 'merge_worktree'
      worktreeId: string
    }
  | {
      type: 'resolve_merge_with_agent'
      worktreeId: string
      provider?: KanbanProvider
    }
  | {
      type: 'delete_worktree'
      worktreeId: string
    }
  | {
      type: 'run_shortcut'
      taskId: string
      shortcutId: string
    }
  | {
      type: 'delete_task'
      taskId: string
    }
  | {
      type: 'create_automation'
      name: string
      prompt: string
      provider?: KanbanProvider
      schedule: KanbanSchedule
      autoStart?: boolean
    }

export type KanbanManagementSession = {
  workspaceDir: string
  provider: KanbanProvider
  sessionKey: string
  providerThreadId?: string
  status: 'idle' | 'running' | 'error'
  transcript: KanbanManagementTranscriptItem[]
  updatedAt: number
  lastError?: string
}

export type KanbanManagementPromptResult = {
  session: KanbanManagementSession
  rawResponse?: string
  operations: KanbanManagementOperation[]
  applied: Array<{
    index: number
    type: KanbanManagementOperation['type']
    ok: boolean
    error?: string
  }>
}

export type KanbanBoardSnapshot = {
  workspaceDir: string
  settings: KanbanSettings
  tasks: KanbanTask[]
  trashedTasks: KanbanTask[]
  runtimes: KanbanTaskRuntime[]
  worktrees: KanbanWorktree[]
  dependencies: KanbanTaskDependency[]
  runs: KanbanRun[]
  automations: KanbanAutomation[]
  reviewComments: KanbanReviewComment[]
}

export type KanbanTaskDetail = {
  task: KanbanTask
  runtime: KanbanTaskRuntime | null
  worktree: KanbanWorktree | null
  run: KanbanRun | null
  dependencies: KanbanTaskDependency[]
  reviewComments: KanbanReviewComment[]
  checkpoints: KanbanTaskCheckpoint[]
  diff: string
  structuredDiff: KanbanDiffFile[]
  transcript: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: number
  }>
}

export type KanbanCreateTaskInput = {
  workspaceDir: string
  title: string
  prompt: string
  description?: string
  provider: KanbanProvider
  providerConfig?: KanbanTaskProviderConfig
  columnId?: KanbanColumnId
  baseRef?: string
  autoStartWhenUnblocked?: boolean
}

export type KanbanUpdateTaskInput = {
  id: string
  workspaceDir: string
  title?: string
  prompt?: string
  description?: string
  provider?: KanbanProvider
  providerConfig?: KanbanTaskProviderConfig
  baseRef?: string
  autoStartWhenUnblocked?: boolean
}

export type KanbanRegenerateTaskField = 'title' | 'description' | 'prompt'

export type KanbanMoveTaskInput = {
  workspaceDir: string
  taskId: string
  columnId: KanbanColumnId
  position: number
}

export type KanbanCreateAutomationInput = {
  workspaceDir: string
  name: string
  prompt: string
  provider: KanbanProvider
  browserModeEnabled?: boolean
  autoStart?: boolean
  enabled?: boolean
  schedule: KanbanSchedule
}

export type KanbanUpdateAutomationInput = Partial<KanbanCreateAutomationInput> & {
  id: string
  workspaceDir: string
}

export type KanbanLegacyJobRecord = {
  id: string
  name: string
  projectDir: string
  prompt: string
  browserModeEnabled?: boolean
  agentMode?: KanbanProvider
  schedule: KanbanSchedule
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt?: number
}

export type KanbanLegacyJobRunRecord = {
  id: string
  jobID: string
  jobName: string
  projectDir: string
  sessionID: string
  createdAt: number
  completedAt?: number
  status: 'running' | 'completed' | 'failed'
  unread: boolean
  error?: string
}

export type KanbanLegacyImportInput = {
  jobs: KanbanLegacyJobRecord[]
  runs: KanbanLegacyJobRunRecord[]
}

export type KanbanUpdateSettingsInput = Partial<
  Omit<KanbanSettings, 'workspaceDir' | 'updatedAt'>
> & {
  workspaceDir: string
}

export type KanbanConnectTaskTerminalResult = TerminalConnectResult

export type KanbanTaskTerminal = OrxaTerminalSession

export type KanbanCreateWorktreeInput = {
  workspaceDir: string
  label: string
  baseRef?: string
  provider?: KanbanProvider
}
