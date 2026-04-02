/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}))

async function loadBridge() {
  vi.resetModules()
  electronMocks.exposeInMainWorld.mockReset()
  electronMocks.invoke.mockReset()
  electronMocks.on.mockReset()
  electronMocks.removeListener.mockReset()

  await import('./preload')

  expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1)
  const call = electronMocks.exposeInMainWorld.mock.calls[0]
  expect(call?.[0]).toBe('orxa')
  return call?.[1] as OrxaBridge
}

type OrxaBridge = {
  app: {
    openExternal: (url: string) => Promise<unknown>
    listDiagnostics: (limit?: number) => Promise<unknown>
    reportRendererDiagnostic: (input: unknown) => Promise<unknown>
    reportPerf: (input: unknown) => Promise<unknown>
    listPerfSummary: (filter?: unknown) => Promise<unknown>
    exportPerfSnapshot: (input?: unknown) => Promise<unknown>
  }
  opencode: {
    selectProject: (directory: string) => Promise<unknown>
    refreshProject: (directory: string) => Promise<unknown>
    refreshProjectDelta: (directory: string) => Promise<unknown>
    refreshProjectCold: (directory: string) => Promise<unknown>
    getSessionRuntimeCore: (directory: string, sessionID: string) => Promise<unknown>
    loadSessionDiff: (directory: string, sessionID: string) => Promise<unknown>
    getArtifactRetentionPolicy: () => Promise<unknown>
    setArtifactRetentionPolicy: (input: unknown) => Promise<unknown>
    pruneArtifactsNow: (workspace?: string) => Promise<unknown>
    exportArtifactBundle: (input: unknown) => Promise<unknown>
  }
  claudeChat: {
    listSessions: () => Promise<unknown>
    resumeProviderSession: (providerThreadId: string, directory: string) => Promise<unknown>
  }
  codex: {
    listBrowserThreads: () => Promise<unknown>
    listWorkspaceThreads: (workspaceRoot: string) => Promise<unknown>
    resumeThread: (threadId: string) => Promise<unknown>
    resumeProviderThread: (threadId: string, directory: string) => Promise<unknown>
    archiveThreadTree: (threadId: string) => Promise<unknown>
    setThreadName: (threadId: string, name: string) => Promise<unknown>
    generateRunMetadata: (cwd: string, prompt: string) => Promise<unknown>
    steerTurn: (threadId: string, turnId: string, prompt: string) => Promise<unknown>
    interruptThreadTree: (threadId: string, turnId?: string) => Promise<unknown>
  }
  browser: {
    getState: () => Promise<unknown>
    setVisible: (visible: boolean) => Promise<unknown>
    setBounds: (bounds: unknown) => Promise<unknown>
    openTab: (url?: string, activate?: boolean) => Promise<unknown>
    closeTab: (tabID?: string) => Promise<unknown>
    switchTab: (tabID: string) => Promise<unknown>
    navigate: (url: string, tabID?: string) => Promise<unknown>
    back: (tabID?: string) => Promise<unknown>
    forward: (tabID?: string) => Promise<unknown>
    reload: (tabID?: string) => Promise<unknown>
    listHistory: (limit?: number) => Promise<unknown>
    clearHistory: () => Promise<unknown>
    performAgentAction: (request: unknown) => Promise<unknown>
  }
}

describe('preload browser bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('browser methods', () => {
    it('wires state and visibility to expected IPC channels', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      await bridge.browser.getState()
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserGetState)

      await bridge.browser.setVisible(true)
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSetVisible, true)

      await bridge.browser.setBounds({ x: 10, y: 20, width: 800, height: 600 })
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSetBounds, {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
      })
    })

    it('wires tab operations to expected IPC channels', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      await bridge.browser.openTab('https://example.com', false)
      expect(electronMocks.invoke).toHaveBeenCalledWith(
        IPC.browserOpenTab,
        'https://example.com',
        false
      )

      await bridge.browser.closeTab('tab-1')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserCloseTab, 'tab-1')

      await bridge.browser.switchTab('tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSwitchTab, 'tab-2')

      await bridge.browser.navigate('https://example.org', 'tab-2')
      expect(electronMocks.invoke).toHaveBeenCalledWith(
        IPC.browserNavigate,
        'https://example.org',
        'tab-2'
      )
    })

    it('wires history controls to expected IPC channels', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      await bridge.browser.back('tab-2')
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserBack, 'tab-2')

      await bridge.browser.forward('tab-2')
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserForward, 'tab-2')

      await bridge.browser.reload('tab-2')
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserReload, 'tab-2')

      await bridge.browser.listHistory(30)
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserListHistory, 30)

      await bridge.browser.clearHistory()
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserClearHistory)
    })

    it('wires agent actions to expected IPC channel', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      const request = { action: 'extract_text', tabID: 'tab-2', selector: 'body' }
      await bridge.browser.performAgentAction(request)
      expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.browserPerformAgentAction, request)
    })
  })
})

describe('preload app bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires external-open to expected IPC channel', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(true)

    await bridge.app.openExternal('https://example.com')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.appOpenExternal,
      'https://example.com'
    )
  })

  it('wires diagnostics to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    await bridge.app.listDiagnostics(25)
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.appListDiagnostics, 25)

    const payload = {
      level: 'error',
      source: 'renderer',
      category: 'renderer.error',
      message: 'boom',
    }
    await bridge.app.reportRendererDiagnostic(payload)
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.appReportRendererDiagnostic, payload)
  })

  it('wires perf APIs to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    const perfPayload = {
      surface: 'ipc',
      metric: 'ipc.invoke_rtt_ms',
      kind: 'span',
      value: 12,
      unit: 'ms',
      process: 'renderer',
    }
    await bridge.app.reportPerf(perfPayload)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.appReportPerf, perfPayload)

    await bridge.app.listPerfSummary({ surface: 'browser', limit: 10 })
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.appListPerfSummary, {
      surface: 'browser',
      limit: 10,
    })

    const exportFilter = { sinceMs: 15 * 60_000, includeEvents: false }
    await bridge.app.exportPerfSnapshot(exportFilter)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.appExportPerfSnapshot, exportFilter)
  })
})

describe('preload opencode bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires artifact retention to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    await bridge.opencode.getArtifactRetentionPolicy()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsGetRetention)

    await bridge.opencode.setArtifactRetentionPolicy({ maxBytes: 1024 })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsSetRetention, {
      maxBytes: 1024,
    })

    await bridge.opencode.pruneArtifactsNow('/tmp/workspace')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.opencodeArtifactsPrune,
      '/tmp/workspace'
    )

    const exportInput = { workspace: '/tmp/workspace', limit: 20 }
    await bridge.opencode.exportArtifactBundle(exportInput)
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.opencodeArtifactsExportBundle,
      exportInput
    )
  })

  it('dedupes in-flight delta refresh for same workspace', async () => {
    const bridge = await loadBridge()
    let resolveRefresh: ((value: unknown) => void) | undefined
    const refreshPromise = new Promise(resolve => {
      resolveRefresh = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.opencodeRefreshProjectDelta) {
        return refreshPromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.opencode.refreshProjectDelta('/repo')
    const second = bridge.opencode.refreshProjectDelta('/repo')

    const refreshInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.opencodeRefreshProjectDelta
    )
    expect(refreshInvocations).toHaveLength(1)

    resolveRefresh?.({ directory: '/repo' })
    await Promise.all([first, second])
  })

  it('dedupes in-flight project selection for same workspace', async () => {
    const bridge = await loadBridge()
    let resolveSelection: ((value: unknown) => void) | undefined
    const selectionPromise = new Promise(resolve => {
      resolveSelection = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.opencodeSelectProject) {
        return selectionPromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.opencode.selectProject('/repo')
    const second = bridge.opencode.selectProject('/repo')

    const selectionInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.opencodeSelectProject
    )
    expect(selectionInvocations).toHaveLength(1)

    resolveSelection?.({ directory: '/repo' })
    await Promise.all([first, second])
  })

  it('dedupes in-flight session runtime core requests for same session', async () => {
    const bridge = await loadBridge()
    let resolveRuntime: ((value: unknown) => void) | undefined
    const runtimePromise = new Promise(resolve => {
      resolveRuntime = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.opencodeGetSessionRuntimeCore) {
        return runtimePromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.opencode.getSessionRuntimeCore('/repo', 'session-1')
    const second = bridge.opencode.getSessionRuntimeCore('/repo', 'session-1')

    const runtimeInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.opencodeGetSessionRuntimeCore
    )
    expect(runtimeInvocations).toHaveLength(1)

    resolveRuntime?.({ directory: '/repo', sessionID: 'session-1' })
    await Promise.all([first, second])
  })

  it('dedupes in-flight cold project refresh for same workspace', async () => {
    const bridge = await loadBridge()
    let resolveRefresh: ((value: unknown) => void) | undefined
    const refreshPromise = new Promise(resolve => {
      resolveRefresh = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.opencodeRefreshProjectCold) {
        return refreshPromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.opencode.refreshProjectCold('/repo')
    const second = bridge.opencode.refreshProjectCold('/repo')

    const refreshInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.opencodeRefreshProjectCold
    )
    expect(refreshInvocations).toHaveLength(1)

    resolveRefresh?.({ directory: '/repo' })
    await Promise.all([first, second])
  })
})

describe('preload codex bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires thread management to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    await bridge.codex.listBrowserThreads()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.codexListBrowserThreads)

    await bridge.codex.listWorkspaceThreads('/repo')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.codexListWorkspaceThreads, '/repo')

    await bridge.codex.archiveThreadTree('thread-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.codexArchiveThreadTree, 'thread-1')

    await bridge.codex.resumeThread('thread-1')
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.codexResumeThread, 'thread-1')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexResumeThread,
        metric: 'ipc.inflight_count',
        surface: 'codex',
      })
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexResumeThread,
        metric: 'ipc.invoke_rtt_ms',
        surface: 'codex',
      })
    )

    await bridge.codex.resumeProviderThread('thread-1', '/repo')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.codexResumeProviderThread,
      'thread-1',
      '/repo'
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexResumeProviderThread,
        metric: 'ipc.inflight_count',
        surface: 'codex',
      })
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexResumeProviderThread,
        metric: 'ipc.invoke_rtt_ms',
        surface: 'codex',
      })
    )

    await bridge.codex.setThreadName('thread-1', 'New Name')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexSetThreadName,
      'thread-1',
      'New Name'
    )
  })

  it('wires turn control to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    await bridge.codex.generateRunMetadata('/repo', 'Fix the sidebar')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexGenerateRunMetadata,
      '/repo',
      'Fix the sidebar'
    )

    await bridge.codex.steerTurn('thread-1', 'turn-1', 'continue with this')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.codexSteerTurn,
      'thread-1',
      'turn-1',
      'continue with this'
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexSteerTurn,
        metric: 'ipc.inflight_count',
        surface: 'codex',
      })
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.codexSteerTurn,
        metric: 'ipc.invoke_rtt_ms',
        surface: 'codex',
      })
    )

    await bridge.codex.interruptThreadTree('thread-1', 'turn-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexInterruptThreadTree,
      'thread-1',
      'turn-1'
    )
  })

  it('dedupes in-flight provider resume calls for the same thread', async () => {
    const bridge = await loadBridge()
    let resolveResume: ((value: unknown) => void) | undefined
    const resumePromise = new Promise(resolve => {
      resolveResume = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.codexResumeProviderThread) {
        return resumePromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.codex.resumeProviderThread('thread-1', '/repo')
    const second = bridge.codex.resumeProviderThread('thread-1', '/repo')

    const resumeInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.codexResumeProviderThread
    )
    expect(resumeInvocations).toHaveLength(1)

    resolveResume?.({ ok: true })
    await Promise.all([first, second])
  })
})

describe('preload claude chat bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('wires session browser actions to expected IPC channels', async () => {
    const bridge = await loadBridge()
    electronMocks.invoke.mockResolvedValue(undefined)

    await bridge.claudeChat.listSessions()
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.claudeChatListSessions)

    await bridge.claudeChat.resumeProviderSession('provider-thread-1', '/repo')
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.claudeChatResumeProviderSession,
      'provider-thread-1',
      '/repo'
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.claudeChatResumeProviderSession,
        metric: 'ipc.inflight_count',
        surface: 'claude_chat',
      })
    )
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      IPC.appReportPerf,
      expect.objectContaining({
        channel: IPC.claudeChatResumeProviderSession,
        metric: 'ipc.invoke_rtt_ms',
        surface: 'claude_chat',
      })
    )
  })

  it('dedupes in-flight provider session resume for matching inputs', async () => {
    const bridge = await loadBridge()
    let resolveResume: ((value: unknown) => void) | undefined
    const resumePromise = new Promise(resolve => {
      resolveResume = resolve
    })

    electronMocks.invoke.mockImplementation((channel: string) => {
      if (channel === IPC.claudeChatResumeProviderSession) {
        return resumePromise
      }
      if (channel === IPC.appReportPerf) {
        return Promise.resolve(undefined)
      }
      return Promise.resolve(undefined)
    })

    const first = bridge.claudeChat.resumeProviderSession('provider-thread-1', '/repo')
    const second = bridge.claudeChat.resumeProviderSession('provider-thread-1', '/repo')

    const resumeInvocations = electronMocks.invoke.mock.calls.filter(
      call => call[0] === IPC.claudeChatResumeProviderSession
    )
    expect(resumeInvocations).toHaveLength(1)

    resolveResume?.({ sessionKey: 'provider-thread-1' })
    await Promise.all([first, second])
  })
})
