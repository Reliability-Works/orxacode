import type {
  KanbanAutomation,
  KanbanBoardSnapshot,
  KanbanCheckpointDiff,
  KanbanCreateAutomationInput,
  KanbanCreateTaskInput,
  KanbanCreateWorktreeInput,
  KanbanGitState,
  KanbanLegacyImportInput,
  KanbanManagementPromptResult,
  KanbanManagementSession,
  KanbanMoveTaskInput,
  KanbanReviewComment,
  KanbanRun,
  KanbanScriptShortcutResult,
  KanbanSettings,
  KanbanTask,
  KanbanTaskCheckpoint,
  KanbanTaskDetail,
  KanbanTaskRuntime,
  KanbanTaskTerminal,
  KanbanUpdateAutomationInput,
  KanbanUpdateSettingsInput,
  KanbanUpdateTaskInput,
  KanbanWorkspace,
  KanbanWorktree,
  KanbanWorktreeStatusDetail,
} from './kanban'

export interface KanbanBridge {
  listWorkspaces: () => Promise<KanbanWorkspace[]>
  addWorkspaceDirectory: () => Promise<KanbanWorkspace | undefined>
  removeWorkspaceDirectory: (workspaceDir: string) => Promise<boolean>
  getSettings: (workspaceDir: string) => Promise<KanbanSettings>
  updateSettings: (input: KanbanUpdateSettingsInput) => Promise<KanbanSettings>
  getBoard: (workspaceDir: string) => Promise<KanbanBoardSnapshot>
  importLegacyJobs: (input: KanbanLegacyImportInput) => Promise<boolean>
  createTask: (input: KanbanCreateTaskInput) => Promise<KanbanTask>
  updateTask: (input: KanbanUpdateTaskInput) => Promise<KanbanTask>
  moveTask: (input: KanbanMoveTaskInput) => Promise<KanbanBoardSnapshot>
  trashTask: (workspaceDir: string, taskId: string) => Promise<KanbanTask>
  restoreTask: (workspaceDir: string, taskId: string) => Promise<KanbanTask>
  deleteTask: (workspaceDir: string, taskId: string) => Promise<boolean>
  linkTasks: (
    workspaceDir: string,
    fromTaskId: string,
    toTaskId: string
  ) => Promise<KanbanBoardSnapshot>
  unlinkTasks: (
    workspaceDir: string,
    fromTaskId: string,
    toTaskId: string
  ) => Promise<KanbanBoardSnapshot>
  startTask: (workspaceDir: string, taskId: string) => Promise<KanbanTask>
  resumeTask: (workspaceDir: string, taskId: string) => Promise<KanbanTask>
  stopTask: (workspaceDir: string, taskId: string) => Promise<KanbanTask>
  getTaskRuntime: (workspaceDir: string, taskId: string) => Promise<KanbanTaskRuntime | null>
  listWorktrees: (workspaceDir: string) => Promise<KanbanWorktree[]>
  createWorktree: (input: KanbanCreateWorktreeInput) => Promise<KanbanWorktree>
  openWorktree: (workspaceDir: string, worktreeId: string) => Promise<boolean>
  deleteWorktree: (workspaceDir: string, worktreeId: string) => Promise<boolean>
  mergeWorktree: (workspaceDir: string, worktreeId: string) => Promise<KanbanWorktreeStatusDetail>
  resolveMergeWithAgent: (
    workspaceDir: string,
    worktreeId: string,
    provider?: 'opencode' | 'codex' | 'claude'
  ) => Promise<KanbanTask>
  getWorktreeStatus: (
    workspaceDir: string,
    worktreeId: string
  ) => Promise<KanbanWorktreeStatusDetail>
  createWorktreeIncludeFromGitignore: (workspaceDir: string) => Promise<KanbanSettings>
  runScriptShortcut: (
    workspaceDir: string,
    taskId: string,
    shortcutId: string
  ) => Promise<KanbanScriptShortcutResult>
  createTaskTerminal: (workspaceDir: string, taskId: string) => Promise<KanbanTaskTerminal>
  getTaskTerminal: (workspaceDir: string, taskId: string) => Promise<KanbanTaskTerminal | null>
  connectTaskTerminal: (
    workspaceDir: string,
    taskId: string
  ) => Promise<{ ptyID: string; directory: string; connected: boolean }>
  closeTaskTerminal: (workspaceDir: string, taskId: string) => Promise<boolean>
  getTaskDetail: (workspaceDir: string, taskId: string) => Promise<KanbanTaskDetail>
  createCheckpoint: (
    workspaceDir: string,
    taskId: string,
    label?: string
  ) => Promise<KanbanTaskCheckpoint>
  listCheckpoints: (workspaceDir: string, taskId: string) => Promise<KanbanTaskCheckpoint[]>
  getCheckpointDiff: (
    workspaceDir: string,
    taskId: string,
    fromCheckpointId: string,
    toCheckpointId?: string
  ) => Promise<KanbanCheckpointDiff>
  addReviewComment: (
    workspaceDir: string,
    taskId: string,
    filePath: string,
    line: number,
    body: string
  ) => Promise<KanbanReviewComment>
  sendReviewFeedback: (workspaceDir: string, taskId: string, body: string) => Promise<KanbanTask>
  commitTask: (workspaceDir: string, taskId: string, message?: string) => Promise<KanbanRun>
  openTaskPr: (
    workspaceDir: string,
    taskId: string,
    baseBranch?: string,
    message?: string
  ) => Promise<KanbanRun>
  gitState: (workspaceDir: string) => Promise<KanbanGitState>
  gitFetch: (workspaceDir: string) => Promise<KanbanGitState>
  gitPull: (workspaceDir: string) => Promise<KanbanGitState>
  gitPush: (workspaceDir: string) => Promise<KanbanGitState>
  gitCheckout: (workspaceDir: string, branch: string) => Promise<KanbanGitState>
  listRuns: (workspaceDir: string) => Promise<KanbanRun[]>
  getRun: (workspaceDir: string, runId: string) => Promise<KanbanRun | null>
  listAutomations: (workspaceDir: string) => Promise<KanbanAutomation[]>
  createAutomation: (input: KanbanCreateAutomationInput) => Promise<KanbanAutomation>
  updateAutomation: (input: KanbanUpdateAutomationInput) => Promise<KanbanAutomation>
  deleteAutomation: (workspaceDir: string, automationId: string) => Promise<boolean>
  runAutomationNow: (workspaceDir: string, automationId: string) => Promise<KanbanRun>
  startManagementSession: (
    workspaceDir: string,
    provider: 'opencode' | 'codex' | 'claude'
  ) => Promise<KanbanManagementSession>
  getManagementSession: (
    workspaceDir: string,
    provider: 'opencode' | 'codex' | 'claude'
  ) => Promise<KanbanManagementSession | null>
  sendManagementPrompt: (
    workspaceDir: string,
    provider: 'opencode' | 'codex' | 'claude',
    prompt: string
  ) => Promise<KanbanManagementPromptResult>
}
