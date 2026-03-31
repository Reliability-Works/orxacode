import { vi } from 'vitest'

import {
  createDefaultKanbanGitState,
  createDefaultKanbanManagementSession,
  createDefaultKanbanTask,
  createDefaultKanbanTaskDetail,
  createDefaultKanbanTaskTerminal,
  createDefaultKanbanWorktreeStatus,
  createEmptyBoardState,
} from './App.test.kanban-shared'
import { useUnifiedRuntimeStore } from './state/unified-runtime-store'

export type AppDependencyCheckResult = {
  checkedAt: number
  missingAny: boolean
  missingRequired: boolean
  dependencies: Array<{
    key: 'opencode' | 'orxa'
    label: string
    required: boolean
    installed: boolean
    description: string
    reason: string
    installCommand: string
    sourceUrl: string
  }>
}

export function createDependencyCheckResult(installed: boolean): AppDependencyCheckResult {
  return {
    checkedAt: Date.now(),
    missingAny: !installed,
    missingRequired: !installed,
    dependencies: [
      {
        key: 'opencode',
        label: 'OpenCode CLI',
        required: true,
        installed,
        description:
          'Core runtime and CLI backend used by the app for sessions, tools, and streaming.',
        reason: 'Required. Orxa Code depends on the OpenCode server and CLI APIs.',
        installCommand: 'npm install -g opencode-ai',
        sourceUrl: 'https://github.com/anomalyco/opencode',
      },
      {
        key: 'orxa',
        label: 'Orxa Code Plugin Package',
        required: false,
        installed,
        description:
          'Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.',
        reason: 'Optional. Needed only when using Orxa mode features.',
        installCommand: 'npm install -g @reliabilityworks/opencode-orxa',
        sourceUrl: 'https://github.com/Reliability-Works/opencode-orxa',
      },
    ],
  }
}

export function createBootstrapMock(name: string, worktree: string) {
  return vi.fn(async () => ({
    projects: [
      {
        id: 'proj-1',
        name,
        worktree,
        source: 'local' as const,
      },
    ],
    runtime: { status: 'disconnected' as const, managedServer: false },
  }))
}

export function createProjectData(
  directory: string,
  sessions: Array<{
    id: string
    slug: string
    title: string
    time: { created: number; updated: number }
  }>
) {
  return {
    directory,
    path: {},
    sessions,
    sessionStatus: Object.fromEntries(
      sessions.map(session => [session.id, { type: 'idle' as const }])
    ),
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {},
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys: [],
  }
}

export function seedClaudeChatRuntimeState(sessionKey: string) {
  useUnifiedRuntimeStore.setState({
    claudeChatSessions: {
      [sessionKey]: {
        key: sessionKey,
        directory: '/repo/reliabilityworks',
        connectionStatus: 'connected',
        providerThreadId: 'claude-thread-1',
        activeTurnId: 'turn-1',
        messages: [],
        historyMessages: [],
        pendingApproval: {
          id: 'approval-1',
          sessionKey,
          threadId: 'claude-thread-1',
          turnId: 'turn-1',
          itemId: 'item-1',
          toolName: 'Edit',
          reason: 'Allow file edit',
          availableDecisions: ['accept', 'decline'],
        },
        pendingUserInput: null,
        isStreaming: true,
        subagents: [
          {
            id: 'agent-1',
            name: 'Scout',
            role: 'explorer',
            status: 'thinking',
            statusText: 'Working',
            prompt: 'Inspect repository',
          },
        ],
        lastError: undefined,
      },
    },
  })
}

export function resetAppTestStoreState() {
  useUnifiedRuntimeStore.setState({
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    pendingSessionId: undefined,
    activeProvider: undefined,
    projectDataByDirectory: {},
    workspaceMetaByDirectory: {},
    opencodeSessions: {},
    codexSessions: {},
    claudeSessions: {},
    claudeChatSessions: {},
    sessionReadTimestamps: {},
    collapsedProjects: {},
  })
}

type AsyncMock = ReturnType<typeof vi.fn>

function mockAsync<T>(value: T) {
  return vi.fn(async () => value)
}

function mockThrowing(message: string) {
  return vi.fn(async () => {
    throw new Error(message)
  })
}

function createDefaultAppApi() {
  return {
    openExternal: mockAsync(true),
    openFile: mockAsync(undefined),
    scanPorts: mockAsync([]),
    httpRequest: mockAsync({ status: 200, headers: {}, body: '', elapsed: 0 }),
  }
}

function createDefaultUpdatesApi() {
  return {
    getPreferences: mockAsync({ autoCheckEnabled: true, releaseChannel: 'stable' }),
    setPreferences: mockAsync({ autoCheckEnabled: true, releaseChannel: 'stable' }),
    checkNow: mockAsync({ ok: true, status: 'started' }),
  }
}

function createDefaultRuntimeApi() {
  return {
    getState: mockAsync({ status: 'disconnected', managedServer: false }),
    listProfiles: mockAsync([]),
    saveProfile: mockAsync([]),
    deleteProfile: mockAsync([]),
    attach: mockAsync({ status: 'connected', managedServer: false }),
    startLocal: mockAsync({ status: 'connected', managedServer: true }),
    stopLocal: mockAsync({ status: 'disconnected', managedServer: false }),
  }
}

function createDefaultWorktreesApi() {
  return {
    list: mockAsync([]),
    create: mockAsync({
      id: '/tmp/project/.worktrees/feature-test',
      name: 'feature-test',
      directory: '/tmp/project/.worktrees/feature-test',
      repoRoot: '/tmp/project',
      branch: 'feature-test',
      isMain: false,
      locked: false,
      prunable: false,
    }),
    open: mockAsync({ target: 'zed', ok: true, detail: 'opened' }),
    delete: mockAsync(true),
  }
}

function createDefaultOpencodeApi(checkDependenciesMock: AsyncMock) {
  const opencodeMock = {
    bootstrap: mockAsync({ projects: [], runtime: { status: 'disconnected', managedServer: false } }),
    checkDependencies: checkDependenciesMock,
    addProjectDirectory: mockAsync(undefined),
    removeProjectDirectory: mockAsync(true),
    selectProject: mockThrowing('not used'),
    refreshProject: mockThrowing('not used'),
    createSession: mockThrowing('not used'),
    deleteSession: mockAsync(true),
    abortSession: mockAsync(true),
    renameSession: mockAsync({ id: 'session-1', title: 'Renamed' }),
    archiveSession: mockAsync({ id: 'session-1', title: 'Archived' }),
    createWorktreeSession: mockAsync({
      worktree: { name: 'feature-test', branch: 'feature-test', directory: '/tmp/feature-test' },
      session: {
        id: 'session-2',
        title: 'Worktree: test',
        slug: 'worktree-test',
        parentID: undefined,
        sharing: undefined,
        revert: [],
        time: { created: Date.now(), updated: Date.now() },
      },
    }),
    getSessionRuntime: mockAsync({
      directory: '/repo/reliabilityworks',
      sessionID: 'session-1',
      session: null,
      sessionStatus: undefined,
      permissions: [],
      questions: [],
      commands: [],
      messages: [],
      sessionDiff: [],
      executionLedger: { cursor: 0, records: [] },
      changeProvenance: { cursor: 0, records: [] },
    }),
    loadMessages: mockAsync([]),
    loadExecutionLedger: mockAsync({ cursor: 0, records: [] }),
    clearExecutionLedger: mockAsync(true),
    loadChangeProvenance: mockAsync({ cursor: 0, records: [] }),
    getFileProvenance: mockAsync([]),
    sendPrompt: mockAsync(true),
    replyPermission: mockAsync(true),
    replyQuestion: mockAsync(true),
    rejectQuestion: mockAsync(true),
    getConfig: mockAsync({}),
    updateConfig: mockAsync({}),
    readRawConfig: mockAsync({ scope: 'global', path: 'config.json', content: '{}' }),
    writeRawConfig: mockAsync({ scope: 'global', path: 'config.json', content: '{}' }),
    listProviders: mockAsync({ all: [], connected: [], default: {} }),
    listAgents: mockAsync([]),
    pickImage: mockAsync(undefined),
    gitCommitSummary: mockAsync({ repoRoot: '/repo/dreamweaver', branch: 'main', filesChanged: 0, insertions: 0, deletions: 0 }),
    gitGenerateCommitMessage: mockAsync('test commit'),
    gitCommit: mockAsync({ repoRoot: '/repo/dreamweaver', branch: 'main', commitSha: 'abc123', pushed: false, createdPullRequest: false }),
    gitBranches: mockAsync({ current: 'main', branches: ['main'], hasChanges: false, ahead: 0, behind: 0 }),
    gitCheckoutBranch: mockAsync({ current: 'main', branches: ['main'], hasChanges: false, ahead: 0, behind: 0 }),
    gitStageAll: mockAsync(true),
    gitRestoreAllUnstaged: mockAsync(true),
    gitStagePath: mockAsync(true),
    gitRestorePath: mockAsync(true),
    gitUnstagePath: mockAsync(true),
    getServerDiagnostics: mockAsync({ runtime: { status: 'disconnected', managedServer: false }, health: 'disconnected' }),
    repairRuntime: mockAsync({ runtime: { status: 'disconnected', managedServer: false }, health: 'disconnected' }),
    listAgentFiles: mockAsync([]),
    readAgentFile: mockAsync({ filename: 'test.md', name: 'test', mode: 'primary', model: '', content: '', path: '' }),
    writeAgentFile: mockAsync(true),
    deleteAgentFile: mockAsync(true),
  }
  return opencodeMock
}

function createDefaultClaudeChatApi() {
  return {
    health: mockAsync({ available: true, authenticated: true, version: '2.0.25' }),
    listModels: mockAsync([]),
    getState: mockAsync({ sessionKey: 'session-1', status: 'disconnected' }),
    startTurn: mockAsync(undefined),
    interruptTurn: mockAsync(undefined),
    approve: mockAsync(undefined),
    respondToUserInput: mockAsync(undefined),
    getSessionMessages: mockAsync([]),
    listSessions: mockAsync([]),
    resumeProviderSession: mockAsync({
      providerThreadId: 'claude-thread-1',
      sessionKey: '/tmp/project::claude-thread-1',
      sessionID: 'claude-thread-1',
      directory: '/tmp/project',
      title: 'Recovered Claude Session',
    }),
    renameProviderSession: mockAsync(undefined),
    archiveSession: mockAsync(undefined),
    archiveProviderSession: mockAsync(undefined),
  }
}

function createDefaultCodexApi() {
  return {
    doctor: mockAsync({ ok: true, issues: [] }),
    update: mockAsync({ ok: true }),
    listModels: mockAsync([]),
    listCollaborationModes: mockAsync([]),
    start: mockAsync({ status: 'disconnected' }),
    stop: mockAsync({ status: 'disconnected' }),
    getState: mockAsync({ status: 'disconnected' }),
    startThread: mockAsync({
      id: 'thr-1',
      preview: 'Test thread',
      modelProvider: 'openai',
      createdAt: Date.now(),
      status: { type: 'idle' as const },
    }),
    listWorkspaceThreads: mockAsync([]),
    listThreads: mockAsync({ threads: [], nextCursor: undefined }),
    getThreadRuntime: mockAsync({
      thread: {
        id: 'thr-1',
        preview: 'Test thread',
        modelProvider: 'openai',
        createdAt: Date.now(),
        status: { type: 'idle' as const },
      },
      childThreads: [],
    }),
    resumeThread: mockAsync({}),
    archiveThreadTree: mockAsync(undefined),
    setThreadName: mockAsync(undefined),
    generateRunMetadata: mockAsync({
      cwd: '/tmp/project',
      prompt: 'Test prompt',
      title: 'Test thread',
    }),
    startTurn: mockAsync(undefined),
    steerTurn: mockAsync(undefined),
    approve: mockAsync(undefined),
    deny: mockAsync(undefined),
    respondToUserInput: mockAsync(undefined),
    interruptTurn: mockAsync(undefined),
    interruptThreadTree: mockAsync(undefined),
  }
}

function createDefaultKanbanApi() {
  const workspaceDir = '/tmp/project'
  return {
    listWorkspaces: mockAsync([]),
    addWorkspaceDirectory: mockAsync(undefined),
    removeWorkspaceDirectory: mockAsync(true),
    getSettings: mockAsync({
      workspaceDir,
      autoCommit: false,
      autoPr: false,
      defaultProvider: 'opencode',
      providerDefaults: {},
      scriptShortcuts: [],
      worktreeInclude: { detected: false, source: 'none', entries: [], updatedAt: Date.now() },
      updatedAt: Date.now(),
    }),
    updateSettings: mockAsync({ workspaceDir }),
    getBoard: mockAsync(createEmptyBoardState(workspaceDir)),
    importLegacyJobs: mockAsync(true),
    createTask: mockAsync(createDefaultKanbanTask(workspaceDir)),
    updateTask: mockAsync(undefined),
    moveTask: mockAsync(createEmptyBoardState(workspaceDir)),
    trashTask: mockAsync(undefined),
    restoreTask: mockAsync(undefined),
    deleteTask: mockAsync(true),
    linkTasks: mockAsync(createEmptyBoardState(workspaceDir)),
    unlinkTasks: mockAsync(createEmptyBoardState(workspaceDir)),
    startTask: mockAsync(undefined),
    resumeTask: mockAsync(undefined),
    stopTask: mockAsync(undefined),
    getTaskRuntime: mockAsync(null),
    createTaskTerminal: mockAsync(createDefaultKanbanTaskTerminal(workspaceDir)),
    getTaskTerminal: mockAsync(null),
    connectTaskTerminal: mockAsync({ ptyID: 'pty-1', directory: workspaceDir, connected: true }),
    closeTaskTerminal: mockAsync(true),
    getTaskDetail: mockAsync(createDefaultKanbanTaskDetail(workspaceDir)),
    createCheckpoint: mockAsync({ id: 'checkpoint-1', workspaceDir, taskId: 'task-1', label: 'Manual checkpoint', source: 'manual', diffRaw: '', createdAt: Date.now() }),
    listCheckpoints: mockAsync([]),
    getCheckpointDiff: mockAsync({ workspaceDir, taskId: 'task-1', fromCheckpointId: 'checkpoint-1', raw: '', files: [] }),
    addReviewComment: mockAsync(undefined),
    sendReviewFeedback: mockAsync(undefined),
    commitTask: mockAsync(undefined),
    openTaskPr: mockAsync(undefined),
    gitState: mockAsync(createDefaultKanbanGitState(workspaceDir)),
    gitFetch: mockAsync(createDefaultKanbanGitState(workspaceDir)),
    gitPull: mockAsync(createDefaultKanbanGitState(workspaceDir)),
    gitPush: mockAsync(createDefaultKanbanGitState(workspaceDir)),
    gitCheckout: mockAsync(createDefaultKanbanGitState(workspaceDir)),
    listWorktrees: mockAsync([]),
    createWorktree: mockAsync(undefined),
    openWorktree: mockAsync(undefined),
    deleteWorktree: mockAsync(true),
    mergeWorktree: mockAsync(undefined),
    resolveMergeWithAgent: mockAsync(undefined),
    getWorktreeStatus: mockAsync(createDefaultKanbanWorktreeStatus(workspaceDir)),
    createWorktreeIncludeFromGitignore: mockAsync({ detected: true, source: 'generated_from_gitignore', entries: [], updatedAt: Date.now() }),
    runScriptShortcut: mockAsync({ stdout: '', stderr: '', exitCode: 0 }),
    listRuns: mockAsync([]),
    getRun: mockAsync(null),
    listAutomations: mockAsync([]),
    createAutomation: mockAsync(undefined),
    updateAutomation: mockAsync(undefined),
    deleteAutomation: mockAsync(true),
    runAutomationNow: mockAsync(undefined),
    startManagementSession: mockAsync(createDefaultKanbanManagementSession(workspaceDir)),
    getManagementSession: mockAsync(null),
    sendManagementPrompt: mockAsync({
      session: createDefaultKanbanManagementSession(workspaceDir),
      rawResponse: '',
      operations: [],
      applied: [],
    }),
  }
}

function createDefaultTerminalApi() {
  return {
    list: mockAsync([]),
    create: mockAsync({ id: 'pty-1' }),
    connect: mockAsync({ connected: true }),
    write: mockAsync(true),
    resize: mockAsync(true),
    close: mockAsync(true),
  }
}

function createDefaultBrowserApi() {
  const state = { partition: 'persist:orxa-browser', bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] }
  return {
    getState: mockAsync(state),
    setVisible: mockAsync(state),
    setBounds: mockAsync(state),
    openTab: mockAsync(state),
    closeTab: mockAsync(state),
    switchTab: mockAsync(state),
    navigate: mockAsync(state),
    back: mockAsync(state),
    forward: mockAsync(state),
    reload: mockAsync(state),
    listHistory: mockAsync([]),
    clearHistory: mockAsync([]),
    performAgentAction: mockAsync({ action: 'navigate', ok: true, state }),
  }
}

export function installAppTestEnvironment() {
  resetAppTestStoreState()
  window.localStorage.clear()
  const subscribe = vi.fn(() => () => undefined)
  const checkDependenciesMock = vi.fn(async () => createDependencyCheckResult(true))

  Object.defineProperty(window, 'orxa', {
    value: {
      app: createDefaultAppApi(),
      updates: createDefaultUpdatesApi(),
      runtime: createDefaultRuntimeApi(),
      worktrees: createDefaultWorktreesApi(),
      opencode: createDefaultOpencodeApi(checkDependenciesMock as AsyncMock),
      codex: createDefaultCodexApi(),
      claudeChat: createDefaultClaudeChatApi(),
      kanban: createDefaultKanbanApi(),
      terminal: createDefaultTerminalApi(),
      browser: createDefaultBrowserApi(),
      events: { subscribe },
    },
    configurable: true,
  })

  return { checkDependenciesMock, subscribe }
}
