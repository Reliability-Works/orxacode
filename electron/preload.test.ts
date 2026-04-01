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
  app: { openExternal: (url: string) => Promise<unknown>; listDiagnostics: (limit?: number) => Promise<unknown>; reportRendererDiagnostic: (input: unknown) => Promise<unknown> }
  opencode: { getArtifactRetentionPolicy: () => Promise<unknown>; setArtifactRetentionPolicy: (input: unknown) => Promise<unknown>; pruneArtifactsNow: (workspace?: string) => Promise<unknown>; exportArtifactBundle: (input: unknown) => Promise<unknown> }
  claudeChat: { listSessions: () => Promise<unknown>; resumeProviderSession: (providerThreadId: string, directory: string) => Promise<unknown> }
  codex: { listBrowserThreads: () => Promise<unknown>; listWorkspaceThreads: (workspaceRoot: string) => Promise<unknown>; resumeThread: (threadId: string) => Promise<unknown>; resumeProviderThread: (threadId: string, directory: string) => Promise<unknown>; archiveThreadTree: (threadId: string) => Promise<unknown>; setThreadName: (threadId: string, name: string) => Promise<unknown>; generateRunMetadata: (cwd: string, prompt: string) => Promise<unknown>; steerTurn: (threadId: string, turnId: string, prompt: string) => Promise<unknown>; interruptThreadTree: (threadId: string, turnId?: string) => Promise<unknown> }
  browser: { getState: () => Promise<unknown>; setVisible: (visible: boolean) => Promise<unknown>; setBounds: (bounds: unknown) => Promise<unknown>; openTab: (url?: string, activate?: boolean) => Promise<unknown>; closeTab: (tabID?: string) => Promise<unknown>; switchTab: (tabID: string) => Promise<unknown>; navigate: (url: string, tabID?: string) => Promise<unknown>; back: (tabID?: string) => Promise<unknown>; forward: (tabID?: string) => Promise<unknown>; reload: (tabID?: string) => Promise<unknown>; listHistory: (limit?: number) => Promise<unknown>; clearHistory: () => Promise<unknown>; performAgentAction: (request: unknown) => Promise<unknown> }
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
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(
        IPC.browserOpenTab,
        'https://example.com',
        false
      )

      await bridge.browser.closeTab('tab-1')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserCloseTab, 'tab-1')

      await bridge.browser.switchTab('tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSwitchTab, 'tab-2')

      await bridge.browser.navigate('https://example.org', 'tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(
        IPC.browserNavigate,
        'https://example.org',
        'tab-2'
      )
    })

    it('wires history controls to expected IPC channels', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      await bridge.browser.back('tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserBack, 'tab-2')

      await bridge.browser.forward('tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserForward, 'tab-2')

      await bridge.browser.reload('tab-2')
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserReload, 'tab-2')

      await bridge.browser.listHistory(30)
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserListHistory, 30)

      await bridge.browser.clearHistory()
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserClearHistory)
    })

    it('wires agent actions to expected IPC channel', async () => {
      const bridge = await loadBridge()
      electronMocks.invoke.mockResolvedValue(undefined)

      const request = { action: 'extract_text', tabID: 'tab-2', selector: 'body' }
      await bridge.browser.performAgentAction(request)
      expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserPerformAgentAction, request)
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
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexListWorkspaceThreads,
      '/repo'
    )

    await bridge.codex.archiveThreadTree('thread-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.codexArchiveThreadTree, 'thread-1')

    await bridge.codex.resumeThread('thread-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.codexResumeThread, 'thread-1')

    await bridge.codex.resumeProviderThread('thread-1', '/repo')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexResumeProviderThread,
      'thread-1',
      '/repo'
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
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexSteerTurn,
      'thread-1',
      'turn-1',
      'continue with this'
    )

    await bridge.codex.interruptThreadTree('thread-1', 'turn-1')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.codexInterruptThreadTree,
      'thread-1',
      'turn-1'
    )
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
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(
      IPC.claudeChatResumeProviderSession,
      'provider-thread-1',
      '/repo'
    )
  })
})
