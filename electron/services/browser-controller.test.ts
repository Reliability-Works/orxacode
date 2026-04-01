/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserBounds } from '../../shared/ipc'
import { createBrowserControllerSetup } from './test-utils/browser-controller-harness'

const electronMocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  getPath: vi.fn(() => '/tmp/orxa-code-test'),
}))

vi.mock('electron', () => ({
  app: {
    getPath: electronMocks.getPath,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
  WebContentsView: class {},
}))

function createSetup() {
  return createBrowserControllerSetup({ fromPartitionMock: electronMocks.fromPartition })
}

function assertHistoryEvent(setup: ReturnType<typeof createSetup>, type: string) {
  expect(setup.events.some(event => event.type === type)).toBe(true)
}

function registerCoreBrowserControllerTests() {
  it('manages tab lifecycle, bounds, and history persistence', async () => {
    const setup = createSetup()

    await setup.controller.openTab('https://example.com')
    await setup.controller.openTab('https://example.org')
    expect(setup.addChildViewSpy).not.toHaveBeenCalled()

    setup.controller.setVisible(true)
    expect(setup.addChildViewSpy).not.toHaveBeenCalled()

    let state = setup.controller.getState()
    expect(state.tabs).toHaveLength(2)
    expect(state.activeTabID).toBe(state.tabs[1]?.id)

    setup.controller.switchTab('tab-1')
    const bounds: BrowserBounds = { x: 10, y: 20, width: 900, height: 600 }
    setup.controller.setBounds(bounds)
    expect(setup.addChildViewSpy).toHaveBeenCalledTimes(1)

    state = setup.controller.getState()
    expect(state.activeTabID).toBe('tab-1')
    expect(state.bounds).toEqual(bounds)
    expect(setup.created[0]?.view.setBounds).toHaveBeenCalledWith(bounds)

    expect(setup.controller.listHistory()).toHaveLength(2)
    expect(setup.historyState.items[0]?.url).toContain('https://example.org')

    setup.controller.clearHistory()
    expect(setup.controller.listHistory()).toHaveLength(0)

    setup.controller.closeTab('tab-1')
    expect(setup.controller.getState().tabs).toHaveLength(1)

    setup.controller.setVisible(false)
    expect(setup.removeChildViewSpy).toHaveBeenCalled()

    assertHistoryEvent(setup, 'browser.state')
    assertHistoryEvent(setup, 'browser.history.added')
    assertHistoryEvent(setup, 'browser.history.cleared')
  })

  it('creates a tab when navigating without an active tab', async () => {
    const setup = createSetup()

    await setup.controller.navigate('https://first-nav.example')
    const state = setup.controller.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.activeTabID).toBe(state.tabs[0]?.id)
    expect(state.tabs[0]?.url).toBe('https://first-nav.example/')

    await expect(setup.controller.navigate('https://nope.example', 'missing-tab')).rejects.toThrow(
      'Browser tab not found'
    )
  })

  it('allows first browser agent action to be navigate', async () => {
    const setup = createSetup()

    const result = await setup.controller.performAgentAction({
      action: 'navigate',
      url: 'https://agent-first-nav.example',
    })

    expect(result.ok).toBe(true)
    expect(result.tabID).toBe(setup.controller.getState().activeTabID)
    expect(setup.controller.getState().tabs).toHaveLength(1)
    expect(setup.controller.getState().tabs[0]?.url).toBe('https://agent-first-nav.example/')
  })

  it('blocks dangerous schemes and defaults permissions to deny', async () => {
    const setup = createSetup()

    expect(setup.permissionRequestHandlerSpy).toHaveBeenCalledTimes(1)
    expect(setup.permissionCheckHandlerSpy).toHaveBeenCalledTimes(1)

    const permissionCallback = vi.fn()
    const requestHandler = setup.permissionRequestHandlerSpy.mock.calls[0]?.[0] as
      | ((contents: unknown, permission: string, callback: (allow: boolean) => void) => void)
      | undefined
    requestHandler?.(undefined, 'media', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const checkHandler = setup.permissionCheckHandlerSpy.mock.calls[0]?.[0] as
      | (() => boolean)
      | undefined
    expect(checkHandler?.()).toBe(false)

    await expect(setup.controller.openTab('file:///etc/passwd')).rejects.toThrow(
      'URL scheme is not allowed'
    )

    await setup.controller.openTab('https://safe.example')
    const webContents = setup.created[0]?.webContents
    expect(webContents).toBeDefined()

    const popupDecision = webContents?.windowOpenHandler?.({ url: 'javascript:alert(1)' })
    expect(popupDecision).toEqual({ action: 'deny' })

    const preventDefault = vi.fn()
    webContents?.emit('will-navigate', { url: 'javascript:alert(1)', preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
}

describe('BrowserController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  registerCoreBrowserControllerTests()

  describe('agent actions', () => {
    it('performs click and returns structured result', async () => {
      const setup = createSetup()
      await setup.controller.openTab('https://actions.example')

      const activeTabID = setup.controller.getState().activeTabID
      const webContents = setup.created[0]?.webContents
      expect(webContents).toBeDefined()

      webContents?.enqueueExecuteResult({ ok: true })
      const clickResult = await setup.controller.performAgentAction({
        action: 'click',
        tabID: activeTabID,
        selector: '#cta',
      })
      expect(clickResult.ok).toBe(true)
    })

    it('performs type and returns structured result', async () => {
      const setup = createSetup()
      await setup.controller.openTab('https://actions.example')

      const activeTabID = setup.controller.getState().activeTabID
      const webContents = setup.created[0]?.webContents

      webContents?.enqueueExecuteResult({ ok: true })
      const typeResult = await setup.controller.performAgentAction({
        action: 'type',
        tabID: activeTabID,
        selector: "input[name='email']",
        text: 'user@example.com',
        submit: true,
      })
      expect(typeResult.ok).toBe(true)
    })

    it('performs extract_text and returns structured result', async () => {
      const setup = createSetup()
      await setup.controller.openTab('https://actions.example')

      const activeTabID = setup.controller.getState().activeTabID
      const webContents = setup.created[0]?.webContents

      webContents?.enqueueExecuteResult({ ok: true, text: 'Page body text' })
      const extractResult = await setup.controller.performAgentAction({
        action: 'extract_text',
        tabID: activeTabID,
        selector: 'body',
      })
      expect(extractResult.ok).toBe(true)
      expect(extractResult.data?.text).toBe('Page body text')
    })

    it('performs screenshot and returns structured result', async () => {
      const setup = createSetup()
      await setup.controller.openTab('https://actions.example')

      const activeTabID = setup.controller.getState().activeTabID
      const screenshotResult = await setup.controller.performAgentAction({
        action: 'screenshot',
        tabID: activeTabID,
        format: 'jpeg',
        quality: 70,
      })
      expect(screenshotResult.ok).toBe(true)
      expect(screenshotResult.data?.mime).toBe('image/jpeg')
      expect(typeof screenshotResult.data?.artifactID).toBe('string')
      expect(String(screenshotResult.data?.fileUrl ?? '')).toContain('file://')
    })

    it('handles failed selector actions', async () => {
      const setup = createSetup()
      await setup.controller.openTab('https://actions.example')

      const activeTabID = setup.controller.getState().activeTabID
      const webContents = setup.created[0]?.webContents

      webContents?.enqueueExecuteResult({ ok: false, error: 'selector_not_found' })
      const failedResult = await setup.controller.performAgentAction({
        action: 'click',
        tabID: activeTabID,
        selector: '#missing',
        maxAttempts: 1,
      })
      expect(failedResult.ok).toBe(false)
      expect(failedResult.error).toContain('selector_not_found')

      const actionEvents = setup.events.filter(event => event.type === 'browser.agent.action')
      expect(actionEvents.length).toBeGreaterThanOrEqual(1)
    })
  })
})
