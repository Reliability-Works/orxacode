import { dialog, ipcMain, type BrowserWindow } from 'electron'
import {
  IPC,
  type KanbanCreateAutomationInput,
  type KanbanCreateWorktreeInput,
  type KanbanCreateTaskInput,
  type KanbanLegacyImportInput,
  type KanbanMoveTaskInput,
  type KanbanUpdateAutomationInput,
  type KanbanUpdateSettingsInput,
  type KanbanUpdateTaskInput,
} from '../../shared/ipc'
import type { KanbanService } from '../services/kanban-service'
import { assertString } from './validators'

type KanbanHandlersDeps = {
  kanbanService: KanbanService
  getMainWindow: () => BrowserWindow | null
}

function asObject<T>(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as T
}

function resolveManagementProvider(provider: unknown) {
  return provider === 'codex' || provider === 'claude' ? provider : 'opencode'
}

function registerKanbanWorkspaceHandlers({
  kanbanService,
  getMainWindow,
}: KanbanHandlersDeps) {
  ipcMain.handle(IPC.kanbanListWorkspaces, async () => kanbanService.listWorkspaces())
  ipcMain.handle(IPC.kanbanAddWorkspaceDirectory, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Add Kanban Workspace',
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return undefined
    }
    return kanbanService.addWorkspaceDirectory(result.filePaths[0]!)
  })
  ipcMain.handle(IPC.kanbanRemoveWorkspaceDirectory, async (_event, workspaceDir: unknown) =>
    kanbanService.removeWorkspaceDirectory(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGetSettings, async (_event, workspaceDir: unknown) =>
    kanbanService.getSettings(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanUpdateSettings, async (_event, input: unknown) =>
    kanbanService.updateSettings(asObject<KanbanUpdateSettingsInput>(input, 'input'))
  )
  ipcMain.handle(IPC.kanbanGetBoard, async (_event, workspaceDir: unknown) =>
    kanbanService.getBoard(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanImportLegacyJobs, async (_event, input: unknown) =>
    kanbanService.importLegacyJobs(asObject<KanbanLegacyImportInput>(input, 'input'))
  )
}

function registerKanbanTaskHandlers({ kanbanService }: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(IPC.kanbanCreateTask, async (_event, input: unknown) =>
    kanbanService.createTask(asObject<KanbanCreateTaskInput>(input, 'input'))
  )
  ipcMain.handle(IPC.kanbanUpdateTask, async (_event, input: unknown) =>
    kanbanService.updateTask(asObject<KanbanUpdateTaskInput>(input, 'input'))
  )
  ipcMain.handle(IPC.kanbanMoveTask, async (_event, input: unknown) =>
    kanbanService.moveTask(asObject<KanbanMoveTaskInput>(input, 'input'))
  )
  ipcMain.handle(IPC.kanbanTrashTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.trashTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanRestoreTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.restoreTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanDeleteTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.deleteTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(
    IPC.kanbanLinkTasks,
    async (_event, workspaceDir: unknown, fromTaskId: unknown, toTaskId: unknown) =>
      kanbanService.linkTasks(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(fromTaskId, 'fromTaskId'),
        assertString(toTaskId, 'toTaskId')
      )
  )
  ipcMain.handle(
    IPC.kanbanUnlinkTasks,
    async (_event, workspaceDir: unknown, fromTaskId: unknown, toTaskId: unknown) =>
      kanbanService.unlinkTasks(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(fromTaskId, 'fromTaskId'),
        assertString(toTaskId, 'toTaskId')
      )
  )
  ipcMain.handle(IPC.kanbanStartTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.startTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanResumeTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.resumeTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanStopTask, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.stopTask(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanGetTaskRuntime, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.getTaskRuntime(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
  ipcMain.handle(IPC.kanbanGetTaskDetail, async (_event, workspaceDir: unknown, taskId: unknown) =>
    kanbanService.getTaskDetail(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(taskId, 'taskId')
    )
  )
}

function registerKanbanWorktreeHandlers({
  kanbanService,
}: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(IPC.kanbanListWorktrees, async (_event, workspaceDir: unknown) =>
    kanbanService.listWorktrees(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanCreateWorktree, async (_event, input: unknown) =>
    kanbanService.createWorktree(asObject<KanbanCreateWorktreeInput>(input, 'input'))
  )
  ipcMain.handle(
    IPC.kanbanOpenWorktree,
    async (_event, workspaceDir: unknown, worktreeId: unknown) =>
      kanbanService.openWorktree(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(worktreeId, 'worktreeId')
      )
  )
  ipcMain.handle(
    IPC.kanbanDeleteWorktree,
    async (_event, workspaceDir: unknown, worktreeId: unknown) =>
      kanbanService.deleteWorktree(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(worktreeId, 'worktreeId')
      )
  )
  ipcMain.handle(
    IPC.kanbanMergeWorktree,
    async (_event, workspaceDir: unknown, worktreeId: unknown) =>
      kanbanService.mergeWorktree(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(worktreeId, 'worktreeId')
      )
  )
  ipcMain.handle(
    IPC.kanbanResolveMergeWithAgent,
    async (_event, workspaceDir: unknown, worktreeId: unknown, provider?: unknown) =>
      kanbanService.resolveMergeWithAgent(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(worktreeId, 'worktreeId'),
        resolveManagementProvider(provider)
      )
  )
  ipcMain.handle(
    IPC.kanbanGetWorktreeStatus,
    async (_event, workspaceDir: unknown, worktreeId: unknown) =>
      kanbanService.getWorktreeStatus(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(worktreeId, 'worktreeId')
      )
  )
  ipcMain.handle(
    IPC.kanbanCreateWorktreeIncludeFromGitignore,
    async (_event, workspaceDir: unknown) =>
      kanbanService.createWorktreeIncludeFromGitignore(assertString(workspaceDir, 'workspaceDir'))
  )
}

function registerKanbanTerminalHandlers({
  kanbanService,
}: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(
    IPC.kanbanRunScriptShortcut,
    async (_event, workspaceDir: unknown, taskId: unknown, shortcutId: unknown) =>
      kanbanService.runScriptShortcut(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        assertString(shortcutId, 'shortcutId')
      )
  )
  ipcMain.handle(
    IPC.kanbanCreateTaskTerminal,
    async (_event, workspaceDir: unknown, taskId: unknown) =>
      kanbanService.createTaskTerminal(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId')
      )
  )
  ipcMain.handle(
    IPC.kanbanGetTaskTerminal,
    async (_event, workspaceDir: unknown, taskId: unknown) =>
      kanbanService.getTaskTerminal(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId')
      )
  )
  ipcMain.handle(
    IPC.kanbanConnectTaskTerminal,
    async (_event, workspaceDir: unknown, taskId: unknown) =>
      kanbanService.connectTaskTerminal(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId')
      )
  )
  ipcMain.handle(
    IPC.kanbanCloseTaskTerminal,
    async (_event, workspaceDir: unknown, taskId: unknown) =>
      kanbanService.closeTaskTerminal(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId')
      )
  )
}

function registerKanbanCheckpointHandlers({
  kanbanService,
}: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(
    IPC.kanbanCreateCheckpoint,
    async (_event, workspaceDir: unknown, taskId: unknown, label?: unknown) =>
      kanbanService.createManualCheckpoint(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        typeof label === 'string' ? label : undefined
      )
  )
  ipcMain.handle(
    IPC.kanbanListCheckpoints,
    async (_event, workspaceDir: unknown, taskId: unknown) =>
      kanbanService.listCheckpoints(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId')
      )
  )
  ipcMain.handle(
    IPC.kanbanGetCheckpointDiff,
    async (
      _event,
      workspaceDir: unknown,
      taskId: unknown,
      fromCheckpointId: unknown,
      toCheckpointId?: unknown
    ) =>
      kanbanService.getCheckpointDiff(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        assertString(fromCheckpointId, 'fromCheckpointId'),
        typeof toCheckpointId === 'string' ? toCheckpointId : undefined
      )
  )
  ipcMain.handle(
    IPC.kanbanAddReviewComment,
    async (
      _event,
      workspaceDir: unknown,
      taskId: unknown,
      filePath: unknown,
      line: unknown,
      body: unknown
    ) =>
      kanbanService.addReviewComment(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        assertString(filePath, 'filePath'),
        typeof line === 'number' ? line : Number(line),
        assertString(body, 'body')
      )
  )
  ipcMain.handle(
    IPC.kanbanSendReviewFeedback,
    async (_event, workspaceDir: unknown, taskId: unknown, body: unknown) =>
      kanbanService.sendReviewFeedback(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        assertString(body, 'body')
      )
  )
  ipcMain.handle(
    IPC.kanbanCommitTask,
    async (_event, workspaceDir: unknown, taskId: unknown, message?: unknown) =>
      kanbanService.commitTask(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        typeof message === 'string' ? message : undefined
      )
  )
  ipcMain.handle(
    IPC.kanbanOpenTaskPr,
    async (
      _event,
      workspaceDir: unknown,
      taskId: unknown,
      baseBranch?: unknown,
      message?: unknown
    ) =>
      kanbanService.openTaskPr(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(taskId, 'taskId'),
        typeof baseBranch === 'string' ? baseBranch : undefined,
        typeof message === 'string' ? message : undefined
      )
  )
}

function registerKanbanGitHandlers({ kanbanService }: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(IPC.kanbanGitState, async (_event, workspaceDir: unknown) =>
    kanbanService.getGitState(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGitFetch, async (_event, workspaceDir: unknown) =>
    kanbanService.gitFetch(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGitPull, async (_event, workspaceDir: unknown) =>
    kanbanService.gitPull(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGitPush, async (_event, workspaceDir: unknown) =>
    kanbanService.gitPush(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGitCheckout, async (_event, workspaceDir: unknown, branch: unknown) =>
    kanbanService.gitCheckout(
      assertString(workspaceDir, 'workspaceDir'),
      assertString(branch, 'branch')
    )
  )
  ipcMain.handle(IPC.kanbanListRuns, async (_event, workspaceDir: unknown) =>
    kanbanService.listRuns(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanGetRun, async (_event, workspaceDir: unknown, runId: unknown) =>
    kanbanService.getRun(assertString(workspaceDir, 'workspaceDir'), assertString(runId, 'runId'))
  )
}

function registerKanbanAutomationHandlers({
  kanbanService,
}: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(IPC.kanbanListAutomations, async (_event, workspaceDir: unknown) =>
    kanbanService.listAutomations(assertString(workspaceDir, 'workspaceDir'))
  )
  ipcMain.handle(IPC.kanbanCreateAutomation, async (_event, input: unknown) =>
    kanbanService.createAutomationPublic(asObject<KanbanCreateAutomationInput>(input, 'input'))
  )
  ipcMain.handle(IPC.kanbanUpdateAutomation, async (_event, input: unknown) =>
    kanbanService.updateAutomation(asObject<KanbanUpdateAutomationInput>(input, 'input'))
  )
  ipcMain.handle(
    IPC.kanbanDeleteAutomation,
    async (_event, workspaceDir: unknown, automationId: unknown) =>
      kanbanService.deleteAutomation(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(automationId, 'automationId')
      )
  )
  ipcMain.handle(
    IPC.kanbanRunAutomationNow,
    async (_event, workspaceDir: unknown, automationId: unknown) =>
      kanbanService.runAutomationNow(
        assertString(workspaceDir, 'workspaceDir'),
        assertString(automationId, 'automationId')
      )
  )
}

function registerKanbanManagementHandlers({
  kanbanService,
}: Pick<KanbanHandlersDeps, 'kanbanService'>) {
  ipcMain.handle(
    IPC.kanbanStartManagementSession,
    async (_event, workspaceDir: unknown, provider: unknown) =>
      kanbanService.startManagementSession(
        assertString(workspaceDir, 'workspaceDir'),
        resolveManagementProvider(provider)
      )
  )
  ipcMain.handle(
    IPC.kanbanGetManagementSession,
    async (_event, workspaceDir: unknown, provider: unknown) =>
      kanbanService.getManagementSession(
        assertString(workspaceDir, 'workspaceDir'),
        resolveManagementProvider(provider)
      )
  )
  ipcMain.handle(
    IPC.kanbanSendManagementPrompt,
    async (_event, workspaceDir: unknown, provider: unknown, prompt: unknown) =>
      kanbanService.sendManagementPrompt(
        assertString(workspaceDir, 'workspaceDir'),
        resolveManagementProvider(provider),
        assertString(prompt, 'prompt')
      )
  )
}

export function registerKanbanHandlers({ kanbanService, getMainWindow }: KanbanHandlersDeps) {
  registerKanbanWorkspaceHandlers({ kanbanService, getMainWindow })
  registerKanbanTaskHandlers({ kanbanService })
  registerKanbanWorktreeHandlers({ kanbanService })
  registerKanbanTerminalHandlers({ kanbanService })
  registerKanbanCheckpointHandlers({ kanbanService })
  registerKanbanGitHandlers({ kanbanService })
  registerKanbanAutomationHandlers({ kanbanService })
  registerKanbanManagementHandlers({ kanbanService })
}
