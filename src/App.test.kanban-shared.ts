export function createEmptyBoardState(workspaceDir: string) {
  return {
    workspaceDir,
    settings: {
      workspaceDir,
      autoCommit: false,
      autoPr: false,
      defaultProvider: 'opencode',
      providerDefaults: {},
      scriptShortcuts: [],
      worktreeInclude: { detected: false, source: 'none', entries: [], updatedAt: Date.now() },
      updatedAt: Date.now(),
    },
    tasks: [],
    runtimes: [],
    dependencies: [],
    runs: [],
    automations: [],
    reviewComments: [],
    trashedTasks: [],
    worktrees: [],
  }
}

export function createEmptyBranchState(current: string) {
  return { current, branches: [current], hasChanges: false, ahead: 0, behind: 0 }
}

export function createDefaultKanbanTask(workspaceDir: string) {
  return {
    id: 'task-1',
    workspaceDir,
    title: 'Task',
    prompt: 'Prompt',
    description: '',
    provider: 'opencode' as const,
    columnId: 'backlog',
    position: 0,
    statusSummary: 'idle',
    autoStartWhenUnblocked: false,
    blocked: false,
    shipStatus: 'unshipped',
    trashStatus: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function createDefaultKanbanGitState(workspaceDir: string, branch = 'main') {
  return {
    workspaceDir,
    repoRoot: workspaceDir,
    branchState: createEmptyBranchState(branch),
    statusText: '',
    commits: [],
    graphText: '',
  }
}

export function createDefaultKanbanTaskDetail(workspaceDir: string) {
  return {
    task: createDefaultKanbanTask(workspaceDir),
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

export function createDefaultKanbanManagementSession(workspaceDir: string) {
  return {
    workspaceDir,
    provider: 'opencode' as const,
    sessionKey: 'session-1',
    status: 'idle' as const,
    transcript: [],
    updatedAt: Date.now(),
  }
}

export function createDefaultKanbanTaskTerminal(workspaceDir: string) {
  return {
    id: 'pty-1',
    directory: workspaceDir,
    cwd: workspaceDir,
    title: 'Kanban',
    owner: 'kanban',
    status: 'running',
    pid: 1,
    exitCode: null,
    createdAt: Date.now(),
  }
}

export function createDefaultKanbanWorktreeStatus(workspaceDir: string) {
  return {
    workspaceDir,
    worktree: {
      id: 'wt-1',
      workspaceDir,
      label: 'Worktree',
      repoRoot: workspaceDir,
      directory: `${workspaceDir}/.worktrees/worktree`,
      branch: 'feature/test',
      baseRef: 'main',
      status: 'ready',
      mergeStatus: 'clean',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    branchState: createEmptyBranchState('feature/test'),
    statusText: '',
    conflicts: [],
  }
}
