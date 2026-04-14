import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const originalPlatform = process.platform
Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

class FakeEventEmitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private readonly onceListeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  once(event: string, listener: (...args: unknown[]) => void) {
    const listeners = this.onceListeners.get(event) ?? new Set()
    listeners.add(listener)
    this.onceListeners.set(event, listeners)
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args)
    }
    const onceListeners = this.onceListeners.get(event)
    if (!onceListeners) return
    this.onceListeners.delete(event)
    for (const listener of onceListeners) {
      listener(...args)
    }
  }
}

class FakeBrowserWindow extends FakeEventEmitter {
  static lastInstance: FakeBrowserWindow | null = null

  readonly setTitle = vi.fn()
  readonly show = vi.fn(() => {
    this.visible = true
  })
  readonly focus = vi.fn(() => {
    this.focused = true
  })
  readonly loadURL = vi.fn((url: string) => {
    this.currentUrl = url
  })
  readonly webContents = {
    on: (event: string, listener: (...args: unknown[]) => void) =>
      this.webContentsEmitter.on(event, listener),
    once: (event: string, listener: (...args: unknown[]) => void) =>
      this.webContentsEmitter.once(event, listener),
    emit: (event: string, ...args: unknown[]) => this.webContentsEmitter.emit(event, ...args),
    getURL: () => this.currentUrl,
    setWindowOpenHandler: vi.fn(),
    openDevTools: vi.fn(),
  }

  private readonly webContentsEmitter = new FakeEventEmitter()
  private currentUrl = 'about:blank'
  private visible = false
  private focused = false
  private destroyed = false

  constructor(options: unknown) {
    super()
    void options
    FakeBrowserWindow.lastInstance = this
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  isFocused() {
    return this.focused
  }
}

vi.mock('electron', () => ({
  app: {
    focus: vi.fn(),
  },
  BrowserWindow: FakeBrowserWindow,
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
  shell: {
    openExternal: vi.fn(),
  },
}))

describe('createMainWindow', () => {
  beforeEach(() => {
    FakeBrowserWindow.lastInstance = null
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('surfaces the window after did-finish-load even if ready-to-show has not fired', async () => {
    const { createMainWindow } = await import('./main.window')
    const { app } = await import('electron')
    const host = {
      config: {
        displayName: 'Orxa Code',
        desktopScheme: 'orxa',
        isDevelopment: false,
        backendPort: 3773,
      },
      resolveIconPath: () => null,
      notifyDidFinishLoad: vi.fn(),
      setMainWindow: vi.fn(),
      isMainWindow: vi.fn(() => true),
    }

    createMainWindow(host)
    const window = FakeBrowserWindow.lastInstance
    if (!window) {
      throw new Error('Expected a BrowserWindow instance')
    }

    window.webContents.emit('did-finish-load')

    expect(host.notifyDidFinishLoad).toHaveBeenCalledTimes(1)
    expect(app.focus).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('keeps a deferred-load window hidden until app content finishes loading', async () => {
    const { createMainWindow, loadMainWindowContent } = await import('./main.window')
    const { app } = await import('electron')
    const host = {
      config: {
        displayName: 'Orxa Code',
        desktopScheme: 'orxa',
        isDevelopment: false,
        backendPort: 3773,
        deferInitialLoad: true,
      },
      resolveIconPath: () => null,
      notifyDidFinishLoad: vi.fn(),
      setMainWindow: vi.fn(),
      isMainWindow: vi.fn(() => true),
    }

    createMainWindow(host)
    const window = FakeBrowserWindow.lastInstance
    if (!window) {
      throw new Error('Expected a BrowserWindow instance')
    }

    // Deferred load: no content requested yet, so window stays hidden.
    expect(window.loadURL).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
    expect(app.focus).not.toHaveBeenCalled()

    // A did-finish-load without a content request (e.g. about:blank) must not surface.
    window.webContents.emit('did-finish-load')
    expect(host.notifyDidFinishLoad).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()

    // Once content is requested and finishes loading, the window surfaces.
    loadMainWindowContent(window as never, host.config)
    window.webContents.emit('did-finish-load')
    expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3773')
    expect(host.notifyDidFinishLoad).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(app.focus).toHaveBeenCalledTimes(1)
  })
})
