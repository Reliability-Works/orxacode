import { vi } from 'vitest'
import type { KanbanBoardSnapshot, KanbanTask } from '@shared/ipc'

export function createTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: overrides.id ?? 'task-1',
    workspaceDir: overrides.workspaceDir ?? '/repo/kanban',
    title: overrides.title ?? 'Task 1',
    prompt: overrides.prompt ?? 'Do the task',
    description: overrides.description ?? 'Task description',
    provider: overrides.provider ?? 'opencode',
    providerConfig: overrides.providerConfig,
    columnId: overrides.columnId ?? 'backlog',
    position: overrides.position ?? 0,
    statusSummary: overrides.statusSummary ?? 'idle',
    autoStartWhenUnblocked: overrides.autoStartWhenUnblocked ?? false,
    blocked: overrides.blocked ?? false,
    shipStatus: overrides.shipStatus ?? 'unshipped',
    trashStatus: overrides.trashStatus ?? 'active',
    latestPreview: overrides.latestPreview,
    latestActivityKind: overrides.latestActivityKind,
    taskBranch: overrides.taskBranch,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    completedAt: overrides.completedAt,
    worktreePath: overrides.worktreePath,
    baseRef: overrides.baseRef,
    providerSessionKey: overrides.providerSessionKey,
    providerThreadId: overrides.providerThreadId,
    restoreColumnId: overrides.restoreColumnId,
    trashedAt: overrides.trashedAt,
    mergeStatus: overrides.mergeStatus,
  }
}

export function createBoardSnapshot(
  taskOverrides: Array<Partial<KanbanTask>> = [createTask()]
): KanbanBoardSnapshot {
  const tasks = taskOverrides.map((task, index) => createTask({ position: index, ...task }))
  return {
    workspaceDir: '/repo/kanban',
    settings: {
      workspaceDir: '/repo/kanban',
      autoCommit: false,
      autoPr: false,
      defaultProvider: 'opencode' as const,
      providerDefaults: {},
      scriptShortcuts: [],
      worktreeInclude: {
        detected: false,
        source: 'none' as const,
        entries: [],
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    },
    tasks,
    runtimes: [],
    dependencies: [],
    runs: [],
    automations: [],
    reviewComments: [],
    trashedTasks: [],
    worktrees: [],
  }
}

export function createTaskDetail(task: KanbanTask) {
  return {
    task,
    runtime: null,
    run: null,
    dependencies: [],
    reviewComments: [],
    checkpoints: [],
    diff: '',
    structuredDiff: [],
    transcript: [],
    worktree: null,
  }
}

function createKanbanServiceMock(snapshot: KanbanBoardSnapshot) {
  return {
    ...createKanbanServiceCoreMocks(snapshot),
    ...createKanbanServiceWorkspaceMocks(),
  }
}

function createKanbanServiceCoreMocks(snapshot: KanbanBoardSnapshot) {
  return {
    listWorkspaces: vi.fn(async () => [{ directory: '/repo/kanban', name: 'kanban' }]),
    addWorkspaceDirectory: vi.fn(async () => undefined),
    removeWorkspaceDirectory: vi.fn(async () => true),
    getBoard: vi.fn(async () => snapshot),
    importLegacyJobs: vi.fn(async () => true),
    createTask: vi.fn(async () => undefined),
    updateTask: vi.fn(async () => undefined),
    moveTask: vi.fn(async () => undefined),
    trashTask: vi.fn(async () => undefined),
    restoreTask: vi.fn(async () => undefined),
    deleteTask: vi.fn(async () => true),
    linkTasks: vi.fn(async () => undefined),
    unlinkTasks: vi.fn(async () => undefined),
    startTask: vi.fn(async () => undefined),
    resumeTask: vi.fn(async () => undefined),
    stopTask: vi.fn(async () => undefined),
    getTaskRuntime: vi.fn(async () => null),
    createTaskTerminal: vi.fn(async () => undefined),
    getTaskTerminal: vi.fn(async () => null),
    connectTaskTerminal: vi.fn(async () => undefined),
    closeTaskTerminal: vi.fn(async () => true),
    createCheckpoint: vi.fn(async () => undefined),
    listCheckpoints: vi.fn(async () => []),
    getCheckpointDiff: vi.fn(async () => ({
      workspaceDir: '/repo/kanban',
      taskId: 'task-1',
      fromCheckpointId: 'cp-1',
      raw: '',
      files: [],
    })),
    addReviewComment: vi.fn(async () => undefined),
    sendReviewFeedback: vi.fn(async () => undefined),
    commitTask: vi.fn(async () => undefined),
    openTaskPr: vi.fn(async () => undefined),
    listRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => null),
    listAutomations: vi.fn(async () => []),
    createAutomation: vi.fn(async () => undefined),
    updateAutomation: vi.fn(async () => undefined),
    deleteAutomation: vi.fn(async () => true),
    runAutomationNow: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => snapshot.settings),
    updateSettings: vi.fn(async () => undefined),
  }
}

function createKanbanServiceWorkspaceMocks() {
  return {
    gitState: vi.fn(async () => ({
      workspaceDir: '/repo/kanban',
      repoRoot: '/repo/kanban',
      branchState: {
        current: 'main',
        branches: ['main'],
        hasChanges: false,
        ahead: 0,
        behind: 0,
      },
      statusText: '',
      commits: [],
      graphText: '',
    })),
    gitFetch: vi.fn(async () => undefined),
    gitPull: vi.fn(async () => undefined),
    gitPush: vi.fn(async () => undefined),
    gitCheckout: vi.fn(async () => undefined),
    listWorktrees: vi.fn(async () => []),
    createWorktree: vi.fn(async () => undefined),
    openWorktree: vi.fn(async () => undefined),
    deleteWorktree: vi.fn(async () => true),
    mergeWorktree: vi.fn(async () => undefined),
    resolveMergeWithAgent: vi.fn(async () => undefined),
    getWorktreeStatus: vi.fn(async () => ({
      workspaceDir: '/repo/kanban',
      worktree: {
        id: 'wt-1',
        workspaceDir: '/repo/kanban',
        label: 'Worktree',
        repoRoot: '/repo/kanban',
        directory: '/repo/kanban/.worktrees/worktree',
        branch: 'feature/test',
        baseRef: 'main',
        status: 'ready',
        mergeStatus: 'clean',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      branchState: {
        current: 'feature/test',
        branches: ['main', 'feature/test'],
        hasChanges: false,
        ahead: 0,
        behind: 0,
      },
      statusText: '',
      conflicts: [],
    })),
    createWorktreeIncludeFromGitignore: vi.fn(async () => ({
      detected: true,
      source: 'generated_from_gitignore',
      entries: [],
      updatedAt: Date.now(),
    })),
    runScriptShortcut: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    startManagementSession: vi.fn(async () => undefined),
    getManagementSession: vi.fn(async () => null),
    sendManagementPrompt: vi.fn(async () => undefined),
  }
}

function createKanbanWindowMockIntegrations(runAgentCli: ReturnType<typeof vi.fn>) {
  return {
    app: {
      runAgentCli,
    },
    opencode: {
      listProviders: vi.fn(async () => []),
      listAgents: vi.fn(async () => []),
    },
    codex: {
      listModels: vi.fn(async () => []),
    },
    claudeChat: {
      listModels: vi.fn(async () => []),
    },
  }
}

export function installKanbanWindowMocks(options?: {
  tasks?: Array<Partial<KanbanTask>>
  runAgentCliOutput?: string
  settings?: Partial<ReturnType<typeof createBoardSnapshot>['settings']>
  dependencies?: Array<{
    id: string
    workspaceDir: string
    fromTaskId: string
    toTaskId: string
    createdAt: number
  }>
}) {
  const subscribe = vi.fn(() => vi.fn())
  const snapshot = createBoardSnapshot(options?.tasks)
  snapshot.settings = { ...snapshot.settings, ...options?.settings }
  snapshot.dependencies = options?.dependencies ?? []
  const getTaskDetail = vi.fn(async (_workspaceDir: string, taskId: string) => {
    const task = snapshot.tasks.find(entry => entry.id === taskId) ?? snapshot.tasks[0]!
    return createTaskDetail(task)
  })
  const runAgentCli = vi.fn(async () => ({
    ok: true,
    output: options?.runAgentCliOutput ?? 'Sharper task title',
  }))

  Object.defineProperty(window, 'orxa', {
    configurable: true,
    value: {
      ...createKanbanWindowMockIntegrations(runAgentCli),
      kanban: {
        ...createKanbanServiceMock(snapshot),
        getTaskDetail,
      },
      events: {
        subscribe,
      },
    },
  })

  return {
    subscribe,
    getBoard: window.orxa.kanban.getBoard as ReturnType<typeof vi.fn>,
    getTaskDetail,
    linkTasks: window.orxa.kanban.linkTasks as ReturnType<typeof vi.fn>,
    unlinkTasks: window.orxa.kanban.unlinkTasks as ReturnType<typeof vi.fn>,
    runAgentCli,
  }
}

export function getLastKanbanEventListener(
  subscribe: ReturnType<typeof vi.fn>
): ((event: { type: string; payload: unknown }) => void) | null {
  const listener = (
    subscribe.mock.calls[subscribe.mock.calls.length - 1] as
      | Array<(event: { type: string; payload: unknown }) => void>
      | undefined
  )?.[0]
  return typeof listener === 'function' ? listener : null
}
