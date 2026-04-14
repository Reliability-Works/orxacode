import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternalMock = vi.hoisted(() => vi.fn())

class MockWebContents extends EventEmitter {
  private currentUrl = 'about:blank'
  private currentTitle = 'New Tab'
  private inspectResult: unknown = null
  private windowOpenHandler:
    | ((details: { url: string }) => { action: 'deny' | 'allow' })
    | undefined

  async loadURL(url: string) {
    this.currentUrl = url
    this.currentTitle = new URL(url).hostname || url
    this.emit('did-start-loading')
    this.emit('did-navigate')
    this.emit('did-stop-loading')
  }

  goBack() {
    this.emit('did-navigate-in-page')
  }

  goForward() {
    this.emit('did-navigate-in-page')
  }

  reload() {
    this.emit('did-start-loading')
    this.emit('did-stop-loading')
  }

  destroy() {
    this.emit('destroyed')
  }

  canGoBack() {
    return this.currentUrl !== 'about:blank'
  }

  canGoForward() {
    return false
  }

  getURL() {
    return this.currentUrl
  }

  getTitle() {
    return this.currentTitle
  }

  async executeJavaScript() {
    return this.inspectResult
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }) {
    this.windowOpenHandler = handler
  }

  triggerWindowOpen(url: string) {
    return this.windowOpenHandler?.({ url })
  }

  setInspectResult(value: unknown) {
    this.inspectResult = value
  }
}

class MockBrowserView {
  webContents = new MockWebContents()
  bounds = { x: 0, y: 0, width: 0, height: 0 }

  setBounds(bounds: { x: number; y: number; width: number; height: number }) {
    this.bounds = bounds
  }
}

class MockBrowserWindow {
  private views: MockBrowserView[] = []
  zoomFactor = 1
  contentView = {
    addChildView: (view: MockBrowserView) => {
      if (!this.views.includes(view)) {
        this.views.push(view)
      }
    },
    removeChildView: (view: MockBrowserView) => {
      this.views = this.views.filter(current => current !== view)
    },
  }
  webContents = {
    getZoomFactor: () => this.zoomFactor,
  }

  getAttachedViews() {
    return [...this.views]
  }

  getContentBounds() {
    return { x: 0, y: 0, width: 1200, height: 800 }
  }
}

const WebContentsViewMock = vi.hoisted(() => {
  class WebContentsViewMockClass {
    constructor() {
      return new MockBrowserView() as unknown as MockBrowserView
    }
  }

  return WebContentsViewMockClass
})

vi.mock('electron', () => ({
  WebContentsView: WebContentsViewMock,
  shell: {
    openExternal: openExternalMock,
  },
}))

import { createBrowserRuntimeController } from './browserRuntime'

function createController(mainWindow: MockBrowserWindow) {
  let tabCounter = 0
  return createBrowserRuntimeController(
    {
      mainWindow: () => mainWindow as unknown as never,
    },
    {
      randomId: () => `tab-${++tabCounter}`,
    }
  )
}

async function openBlankTabWithController(mainWindow: MockBrowserWindow) {
  const controller = createController(mainWindow)
  await controller.openTab('about:blank')
  return controller
}

function resetTestWindowState() {
  return new MockBrowserWindow()
}

function expectSearchBoxAnnotation(value: unknown) {
  expect(value).toEqual({
    element: 'Search box',
    selector: 'input[name="q"]',
    text: null,
    boundingBox: { x: 12, y: 34, width: 320, height: 44 },
    computedStyles: 'display:block;',
  })
}

describe('createBrowserRuntimeController tab state', () => {
  let mainWindow: MockBrowserWindow

  beforeEach(() => {
    mainWindow = resetTestWindowState()
    openExternalMock.mockReset()
  })

  it('opens and switches tabs while keeping browser state in sync', async () => {
    const controller = createController(mainWindow)

    const snapshot = await controller.openTab('example.com')
    expect(snapshot.activeTabId).toBe('tab-1')
    expect(snapshot.tabs).toHaveLength(1)
    expect(snapshot.activeUrl).toBe('https://example.com/')
    expect(snapshot.tabs[0]).toMatchObject({
      id: 'tab-1',
      isActive: true,
      isLoading: false,
    })
    expect(mainWindow.getAttachedViews()).toHaveLength(0)

    const next = await controller.navigate('https://example.org/docs')
    expect(next.activeUrl).toBe('https://example.org/docs')
    expect(next.tabs[0]?.url).toBe('https://example.org/docs')
    expect(next.canGoBack).toBe(true)

    const second = await controller.openTab()
    expect(second.activeTabId).toBe('tab-2')
    expect(second.tabs).toHaveLength(2)

    const switched = await controller.switchTab('tab-1')
    expect(switched.activeTabId).toBe('tab-1')
    expect(switched.tabs.find(tab => tab.id === 'tab-1')?.isActive).toBe(true)
  })
})

describe('createBrowserRuntimeController embedded bounds', () => {
  let mainWindow: MockBrowserWindow

  beforeEach(() => {
    mainWindow = resetTestWindowState()
    openExternalMock.mockReset()
  })

  it('applies bounds to the active browser view and opens external windows safely', async () => {
    const controller = await openBlankTabWithController(mainWindow)
    const next = await controller.setBounds({ x: 10, y: 20, width: 300, height: 400 })
    expect(next.bounds).toEqual({ x: 10, y: 20, width: 300, height: 400 })
    expect(mainWindow.getAttachedViews()[0]?.bounds).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    })

    const activeView = mainWindow.getAttachedViews()[0] as unknown as MockBrowserView | undefined
    activeView?.webContents.triggerWindowOpen('https://example.net')
    expect(openExternalMock).toHaveBeenCalledWith('https://example.net/')
  })

  it('clamps oversized bounds so the browser view cannot exceed the window content area', async () => {
    const controller = await openBlankTabWithController(mainWindow)
    const next = await controller.setBounds({ x: 950, y: 700, width: 500, height: 300 })

    expect(next.bounds).toEqual({ x: 950, y: 700, width: 250, height: 100 })
    expect(mainWindow.getAttachedViews()[0]?.bounds).toEqual({
      x: 950,
      y: 700,
      width: 250,
      height: 100,
    })
  })

  it('converts renderer css bounds into window dip bounds using the zoom factor', async () => {
    mainWindow.zoomFactor = 0.8333333333
    const controller = await openBlankTabWithController(mainWindow)

    const next = await controller.setBounds({ x: 859, y: 228, width: 915, height: 708 })

    expect(next.bounds).toEqual({ x: 716, y: 190, width: 484, height: 590 })
    expect(mainWindow.getAttachedViews()[0]?.bounds).toEqual({
      x: 716,
      y: 190,
      width: 484,
      height: 590,
    })
  })
})

describe('createBrowserRuntimeController inspect tools', () => {
  let mainWindow: MockBrowserWindow

  beforeEach(() => {
    mainWindow = resetTestWindowState()
    openExternalMock.mockReset()
  })

  it('enables native inspect mode and polls annotations from the active tab', async () => {
    const controller = await openBlankTabWithController(mainWindow)
    await controller.setBounds({ x: 10, y: 20, width: 300, height: 400 })

    await controller.enableInspect()
    const activeView = mainWindow.getAttachedViews()[0] as unknown as MockBrowserView | undefined
    activeView?.webContents.setInspectResult({
      element: 'Search box',
      selector: 'input[name="q"]',
      text: null,
      boundingBox: { x: 12, y: 34, width: 320, height: 44 },
      computedStyles: 'display:block;',
    })

    const first = await controller.pollInspectAnnotation()
    const second = await controller.pollInspectAnnotation()

    expectSearchBoxAnnotation(first)
    expectSearchBoxAnnotation(second)

    await controller.disableInspect()
  })

  it('inspects the active tab at a point relative to the embedded bounds', async () => {
    const controller = createController(mainWindow)

    await controller.openTab('https://example.com')
    await controller.setBounds({ x: 10, y: 20, width: 500, height: 400 })

    const activeView = mainWindow.getAttachedViews()[0] as unknown as MockBrowserView | undefined
    activeView?.webContents.setInspectResult({
      element: 'Primary CTA',
      selector: 'button.primary',
      text: 'Continue',
      boundingBox: { x: 40, y: 60, width: 120, height: 36 },
      computedStyles: 'display: block;',
    })

    const result = await controller.inspectAtPoint({ x: 50, y: 80 })
    expect(result).toEqual({
      element: 'Primary CTA',
      selector: 'button.primary',
      text: 'Continue',
      boundingBox: { x: 40, y: 60, width: 120, height: 36 },
      computedStyles: 'display: block;',
    })
  })
})
