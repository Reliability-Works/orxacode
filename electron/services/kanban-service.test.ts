import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { KanbanService } from './kanban-service'

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createGitWorkspace(prefix: string) {
  const workspaceDir = path.join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(workspaceDir, { recursive: true })
  runGit(workspaceDir, ['init', '-b', 'main'])
  runGit(workspaceDir, ['config', 'user.name', 'Test User'])
  runGit(workspaceDir, ['config', 'user.email', 'test@example.com'])
  return workspaceDir
}

function createService() {
  const opencodeService = {
    getSessionRuntime: vi.fn(async () => ({
      directory: '/repo',
      sessionID: 'session-1',
      session: null,
      sessionStatus: { type: 'idle' },
      permissions: [],
      questions: [],
      commands: [],
      messages: [],
      sessionDiff: [],
      executionLedger: { cursor: 0, records: [] },
      changeProvenance: { cursor: 0, records: [] },
    })),
    createSession: vi.fn(async () => ({ id: 'session-1' })),
    sendPrompt: vi.fn(async () => true),
    abortSession: vi.fn(async () => true),
    gitDiff: vi.fn(async () => 'No local changes.'),
    loadMessages: vi.fn(async () => []),
    gitCommit: vi.fn(async () => ({
      repoRoot: '/repo',
      branch: 'main',
      commitHash: 'abc1234',
      message: 'test commit',
      pushed: false,
    })),
    gitBranches: vi.fn(async () => ({
      current: 'main',
      branches: ['main'],
      hasChanges: false,
      ahead: 0,
      behind: 0,
    })),
    gitStatus: vi.fn(async () => ''),
    gitCheckoutBranch: vi.fn(async () => ({
      current: 'main',
      branches: ['main'],
      hasChanges: false,
      ahead: 0,
      behind: 0,
    })),
  } as const
  const codexService = {
    getThreadRuntime: vi.fn(async () => ({ thread: null, childThreads: [] })),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
    startTurn: vi.fn(async () => undefined),
    interruptThreadTree: vi.fn(async () => undefined),
  } as const
  const claudeChatService = {
    getState: vi.fn(async () => ({ sessionKey: 'claude-1', status: 'disconnected' })),
    startTurn: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    getSessionMessages: vi.fn(async () => []),
  } as const
  const terminalService = {
    listPtys: vi.fn(() => []),
    createPty: vi.fn((_directory: string, cwd?: string, title?: string) => ({
      id: 'pty-1',
      directory: '/repo',
      cwd: cwd ?? '/repo',
      title: title ?? 'Kanban',
      owner: 'kanban',
      status: 'running',
      pid: 123,
      exitCode: null,
      createdAt: Date.now(),
    })),
    connectPty: vi.fn(async () => ({ ptyID: 'pty-1', directory: '/repo', connected: true })),
    closePty: vi.fn(async () => true),
  } as const
  const databasePath = path.join(
    tmpdir(),
    `orxa-kanban-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
  )
  const service = new KanbanService({
    databasePath,
    opencodeService: opencodeService as never,
    codexService: codexService as never,
    claudeChatService: claudeChatService as never,
    terminalService: terminalService as never,
  })
  return {
    service,
    databasePath,
    opencodeService,
    codexService,
    claudeChatService,
    terminalService,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function registerWorkspaceCatalogTests() {
  it('tracks Kanban workspaces separately from shell projects', async () => {
    const { service, databasePath } = createService()
    try {
      const workspace = await service.addWorkspaceDirectory('/repo/kanban-only')
      expect(workspace?.directory).toBe('/repo/kanban-only')
      expect(workspace?.name).toBe('kanban-only')

      const workspaces = await service.listWorkspaces()
      expect(workspaces.map(entry => entry.directory)).toEqual(['/repo/kanban-only'])
    } finally {
      rmSync(databasePath, { force: true })
    }
  })

  it('imports legacy jobs and exposes them as automations and runs', async () => {
    const { service, databasePath } = createService()
    try {
      await service.importLegacyJobs({
        jobs: [
          {
            id: 'job-1',
            name: 'Weekly release notes',
            projectDir: '/repo',
            prompt: 'Write notes',
            browserModeEnabled: false,
            agentMode: 'opencode',
            schedule: { type: 'daily', time: '09:00', days: [5] },
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        runs: [
          {
            id: 'run-1',
            jobID: 'job-1',
            jobName: 'Weekly release notes',
            projectDir: '/repo',
            sessionID: 'session-1',
            createdAt: 3,
            completedAt: 4,
            status: 'completed',
            unread: false,
          },
        ],
      })
      const board = await service.getBoard('/repo')
      expect(board.automations).toHaveLength(1)
      expect(board.automations[0]?.name).toBe('Weekly release notes')
      expect(board.runs).toHaveLength(1)
      expect(board.runs[0]?.automationId).toBe('job-1')
    } finally {
      rmSync(databasePath, { force: true })
    }
  })
}

function registerTaskBoardTests() {
  it('creates and moves tasks across columns', async () => {
    const { service, databasePath } = createService()
    try {
      const task = await service.createTask({
        workspaceDir: '/repo',
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
      })
      expect(task.columnId).toBe('backlog')
      const board = await service.moveTask({
        workspaceDir: '/repo',
        taskId: task.id,
        columnId: 'review',
        position: 0,
      })
      expect(board.tasks.find(candidate => candidate.id === task.id)?.columnId).toBe('review')
    } finally {
      rmSync(databasePath, { force: true })
    }
  })

  it('persists provider-specific task configuration', async () => {
    const { service, databasePath } = createService()
    try {
      const created = await service.createTask({
        workspaceDir: '/repo',
        title: 'Task A',
        prompt: 'Do work',
        provider: 'codex',
        providerConfig: {
          codex: {
            model: 'gpt-5.4',
            reasoningEffort: 'high',
          },
        },
      })
      expect(created.providerConfig?.codex?.model).toBe('gpt-5.4')

      await service.updateTask({
        id: created.id,
        workspaceDir: '/repo',
        provider: 'opencode',
        providerConfig: {
          opencode: {
            agent: 'planner',
            model: { providerID: 'openai', modelID: 'gpt-5.4' },
            variant: 'fast',
          },
        },
      })

      const board = await service.getBoard('/repo')
      expect(board.tasks[0]?.provider).toBe('opencode')
      expect(board.tasks[0]?.providerConfig).toEqual({
        opencode: {
          agent: 'planner',
          model: { providerID: 'openai', modelID: 'gpt-5.4' },
          variant: 'fast',
        },
      })
    } finally {
      rmSync(databasePath, { force: true })
    }
  })
}

function registerTaskConfigurationTests() {
  it('persists workspace settings independently of the board snapshot', async () => {
    const { service, databasePath } = createService()
    try {
      const settings = await service.updateSettings({
        workspaceDir: '/repo',
        autoCommit: true,
        autoPr: true,
        providerDefaults: {
          claude: {
            model: 'sonnet',
            effort: 'high',
          },
        },
        scriptShortcuts: [{ id: 'dev', name: 'Dev', command: 'npm run dev' }],
      })
      expect(settings.autoCommit).toBe(true)
      expect(settings.autoPr).toBe(true)
      expect(settings.providerDefaults.claude?.model).toBe('sonnet')
      expect(settings.scriptShortcuts[0]?.command).toBe('npm run dev')

      const board = await service.getBoard('/repo')
      expect(board.settings.autoCommit).toBe(true)
      expect(board.settings.autoPr).toBe(true)
      expect(board.settings.providerDefaults.claude?.effort).toBe('high')
      expect(board.settings.scriptShortcuts).toHaveLength(1)
    } finally {
      rmSync(databasePath, { force: true })
    }
  })

  it('creates task checkpoints and returns checkpoint diffs', async () => {
    const { service, databasePath } = createService()
    try {
      const task = await service.createTask({
        workspaceDir: '/repo',
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
      })
      const checkpoint = await service.createManualCheckpoint('/repo', task.id, 'Before review')
      expect(checkpoint.label).toBe('Before review')

      const checkpoints = await service.listCheckpoints('/repo', task.id)
      expect(checkpoints).toHaveLength(1)

      const diff = await service.getCheckpointDiff('/repo', task.id, checkpoint.id)
      expect(diff.fromCheckpointId).toBe(checkpoint.id)
      expect(diff.raw).toContain('No local changes.')
    } finally {
      rmSync(databasePath, { force: true })
    }
  })

  it('trashes and restores tasks without losing their identity', async () => {
    const { service, databasePath } = createService()
    try {
      const task = await service.createTask({
        workspaceDir: '/repo',
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
      })

      const trashed = await service.trashTask('/repo', task.id)
      expect(trashed.trashStatus).toBe('trashed')
      expect(trashed.restoreColumnId).toBe('backlog')

      const trashedBoard = await service.getBoard('/repo')
      expect(trashedBoard.tasks).toHaveLength(0)
      expect(trashedBoard.trashedTasks.map(entry => entry.id)).toContain(task.id)

      const restored = await service.restoreTask('/repo', task.id)
      expect(restored.trashStatus).toBe('active')
      expect(restored.columnId).toBe('backlog')

      const restoredBoard = await service.getBoard('/repo')
      expect(restoredBoard.tasks.map(entry => entry.id)).toContain(task.id)
      expect(restoredBoard.trashedTasks).toHaveLength(0)
    } finally {
      rmSync(databasePath, { force: true })
    }
  })
}

function registerWorktreeTests() {
  it('creates .worktreeinclude entries from .gitignore', async () => {
    const { service, databasePath } = createService()
    const workspaceDir = path.join(
      tmpdir(),
      `orxa-kanban-worktreeinclude-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    try {
      mkdirSync(workspaceDir, { recursive: true })
      writeFileSync(
        path.join(workspaceDir, '.gitignore'),
        'node_modules\n.cache/\n# comment\n!.env\n',
        'utf8'
      )

      const settings = await service.createWorktreeIncludeFromGitignore(workspaceDir)
      expect(settings.worktreeInclude.detected).toBe(true)
      expect(settings.worktreeInclude.source).toBe('generated_from_gitignore')
      expect(settings.worktreeInclude.entries).toEqual(['node_modules', '.cache/'])

      const reloadedSettings = await service.getSettings(workspaceDir)
      expect(reloadedSettings.worktreeInclude.entries).toEqual(['node_modules', '.cache/'])
      expect(reloadedSettings.worktreeInclude.source).toBe('worktreeinclude')
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
      rmSync(databasePath, { force: true })
    }
  })

  it('only mirrors ignored paths matched by .worktreeinclude patterns', async () => {
    const { service, databasePath } = createService()
    const workspaceDir = createGitWorkspace('orxa-kanban-worktreeinclude-sync')
    try {
      writeFileSync(path.join(workspaceDir, 'README.md'), 'base\n', 'utf8')
      writeFileSync(path.join(workspaceDir, '.gitignore'), 'node_modules/\n.cache/\n', 'utf8')
      writeFileSync(path.join(workspaceDir, '.worktreeinclude'), 'node_modules/\n', 'utf8')
      mkdirSync(path.join(workspaceDir, 'node_modules'), { recursive: true })
      mkdirSync(path.join(workspaceDir, '.cache'), { recursive: true })
      writeFileSync(path.join(workspaceDir, 'node_modules', 'dep.txt'), 'dep\n', 'utf8')
      writeFileSync(path.join(workspaceDir, '.cache', 'cache.txt'), 'cache\n', 'utf8')
      runGit(workspaceDir, ['add', 'README.md', '.gitignore', '.worktreeinclude'])
      runGit(workspaceDir, ['commit', '-m', 'Initial commit'])

      const task = await service.createTask({
        workspaceDir,
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
        baseRef: 'main',
      })
      const started = await service.startTask(workspaceDir, task.id)

      expect(started.worktreePath).toBeTruthy()
      const nodeModulesPath = path.join(started.worktreePath!, 'node_modules')
      const cachePath = path.join(started.worktreePath!, '.cache')
      expect(lstatSync(nodeModulesPath).isSymbolicLink()).toBe(true)
      expect(() => lstatSync(cachePath)).toThrow()
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
      rmSync(databasePath, { force: true })
    }
  })

  it('restores tracked and untracked changes after trashing a task worktree', async () => {
    const { service, databasePath } = createService()
    const workspaceDir = createGitWorkspace('orxa-kanban-trash-restore')
    try {
      writeFileSync(path.join(workspaceDir, 'tracked.txt'), 'base\n', 'utf8')
      runGit(workspaceDir, ['add', 'tracked.txt'])
      runGit(workspaceDir, ['commit', '-m', 'Initial commit'])

      const task = await service.createTask({
        workspaceDir,
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
        baseRef: 'main',
      })
      const started = await service.startTask(workspaceDir, task.id)
      const worktreePath = started.worktreePath!

      writeFileSync(path.join(worktreePath, 'tracked.txt'), 'base\nlocal change\n', 'utf8')
      writeFileSync(path.join(worktreePath, 'notes.txt'), 'untracked\n', 'utf8')

      await service.trashTask(workspaceDir, task.id)
      expect(path.join(worktreePath)).toBeTruthy()

      await service.restoreTask(workspaceDir, task.id)
      const resumed = await service.startTask(workspaceDir, task.id)
      expect(readFileSync(path.join(resumed.worktreePath!, 'tracked.txt'), 'utf8')).toBe(
        'base\nlocal change\n'
      )
      expect(readFileSync(path.join(resumed.worktreePath!, 'notes.txt'), 'utf8')).toBe(
        'untracked\n'
      )
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
      rmSync(databasePath, { force: true })
    }
  })
}

function registerRunManagementTests() {
  it('syncs the latest run when a refreshed task completes in the background', async () => {
    const { service, databasePath, opencodeService } = createService()
    const workspaceDir = createGitWorkspace('orxa-kanban-run-sync')
    try {
      writeFileSync(path.join(workspaceDir, 'tracked.txt'), 'base\n', 'utf8')
      runGit(workspaceDir, ['add', 'tracked.txt'])
      runGit(workspaceDir, ['commit', '-m', 'Initial commit'])

      const task = await service.createTask({
        workspaceDir,
        title: 'Task A',
        prompt: 'Do work',
        provider: 'opencode',
        baseRef: 'main',
      })
      const started = await service.startTask(workspaceDir, task.id)
      const initialRun = await service.getRun(workspaceDir, started.latestRunId!)
      expect(initialRun?.status).toBe('running')

      opencodeService.getSessionRuntime.mockResolvedValue({
        directory: started.worktreePath!,
        sessionID: started.providerThreadId!,
        session: null,
        sessionStatus: { type: 'complete' },
        permissions: [],
        questions: [],
        commands: [],
        messages: [{ parts: [{ text: 'Finished successfully' }] }] as never[],
        sessionDiff: [],
        executionLedger: { cursor: 0, records: [] },
        changeProvenance: { cursor: 0, records: [] },
      })

      const board = await service.getBoard(workspaceDir)
      const completedTask = board.tasks.find(candidate => candidate.id === task.id)
      const completedRun = board.runs.find(candidate => candidate.id === started.latestRunId)

      expect(completedTask?.statusSummary).toBe('completed')
      expect(completedRun?.status).toBe('completed')
      expect(completedRun?.logs.at(-1)?.message).toBe('Task completed')
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true })
      rmSync(databasePath, { force: true })
    }
  })

  it('marks unknown management operations as failed instead of successful', async () => {
    const { service, databasePath } = createService()
    try {
      const applied = await (
        service as unknown as {
          applyManagementOperations: (
            workspaceDir: string,
            operations: Array<{ type: string }>
          ) => Promise<Array<{ ok: boolean; error?: string }>>
        }
      ).applyManagementOperations('/repo', [{ type: 'bogus_operation' }])

      expect(applied).toHaveLength(1)
      expect(applied[0]?.ok).toBe(false)
      expect(applied[0]?.error).toContain('Unsupported management operation type')
    } finally {
      rmSync(databasePath, { force: true })
    }
  })
}

describe('KanbanService', () => {
  registerWorkspaceCatalogTests()
  registerTaskBoardTests()
  registerTaskConfigurationTests()
  registerWorktreeTests()
  registerRunManagementTests()
})
