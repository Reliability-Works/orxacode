import { randomUUID } from 'node:crypto'
import { WebContentsView, shell, type BrowserWindow } from 'electron'
import type {
  DesktopBrowserAnnotationCandidate,
  DesktopBrowserBounds,
  DesktopBrowserInspectPoint,
  DesktopBrowserState,
  DesktopBrowserTabState,
} from '@orxa-code/contracts'
import { getSafeExternalUrl } from './main.logging'
import {
  clampBoundsToWindow,
  normalizeWindowContentBounds,
  scaleCssBoundsToWindowDips,
} from './browserRuntime.bounds'
import {
  buildInspectScript,
  DEFAULT_URL,
  getFallbackTitle,
  normalizeAnnotationCandidate,
  normalizeBrowserUrl,
} from './browserRuntime.helpers'
import {
  buildInspectDisableScript,
  buildInspectEnableScript,
  buildInspectGetAnnotationScript,
} from './browserInspectScripts'

interface BrowserViewLike {
  webContents: {
    getURL(): string
    getTitle(): string
    loadURL(url: string): Promise<void>
    goBack(): void
    goForward(): void
    reload(): void
    destroy(): void
    canGoBack(): boolean
    canGoForward(): boolean
    executeJavaScript<T = unknown>(code: string): Promise<T>
    on(event: string, listener: (...args: unknown[]) => void): void
    once(event: string, listener: (...args: unknown[]) => void): void
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void
  }
  setBounds(bounds: DesktopBrowserBounds): void
}

interface ContentViewLike {
  addChildView(view: BrowserViewLike): void
  removeChildView(view: BrowserViewLike): void
}

interface BrowserWindowLike {
  contentView?: ContentViewLike
  getContentBounds(): DesktopBrowserBounds
  webContents?: {
    getZoomFactor(): number
  }
}
export interface BrowserRuntimeController {
  getState(): DesktopBrowserState
  navigate(url: string): Promise<DesktopBrowserState>
  back(): Promise<DesktopBrowserState>
  forward(): Promise<DesktopBrowserState>
  reload(): Promise<DesktopBrowserState>
  openTab(url?: string): Promise<DesktopBrowserState>
  closeTab(tabId: string): Promise<DesktopBrowserState>
  switchTab(tabId: string): Promise<DesktopBrowserState>
  setBounds(bounds: DesktopBrowserBounds): Promise<DesktopBrowserState>
  enableInspect(): Promise<{ ok: boolean }>
  disableInspect(): Promise<{ ok: boolean }>
  pollInspectAnnotation(): Promise<DesktopBrowserAnnotationCandidate | null>
  inspectAtPoint(point: DesktopBrowserInspectPoint): Promise<DesktopBrowserAnnotationCandidate | null>
}

interface BrowserRuntimeHost {
  mainWindow(): BrowserWindow | null
}
type BrowserRuntimeDeps = {
  createBrowserView: () => BrowserViewLike
  openExternal: (url: string) => void
  randomId: () => string
}

interface BrowserTabRecord {
  id: string
  view: BrowserViewLike
  title: string
  url: string
  isLoading: boolean
}

function createElectronBrowserView(openExternal: (url: string) => void): BrowserViewLike {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'persist:orxa-browser',
    },
  }) as unknown as BrowserViewLike

  view.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getSafeExternalUrl(url)
    if (externalUrl) {
      openExternal(externalUrl)
    }
    return { action: 'deny' }
  })

  return view
}

class BrowserRuntimeControllerImpl implements BrowserRuntimeController {
  private readonly tabs = new Map<string, BrowserTabRecord>()
  private readonly tabOrder: string[] = []
  private activeTabId: string | null = null
  private bounds: DesktopBrowserBounds | null = null
  private attachedWindow: BrowserWindowLike | null = null
  private attachedTabId: string | null = null
  private inspectEnabled = false

  constructor(
    private readonly host: BrowserRuntimeHost,
    private readonly deps: BrowserRuntimeDeps
  ) {}

  private getMainWindow(): BrowserWindowLike | null {
    return this.host.mainWindow() as BrowserWindowLike | null
  }

  private getActiveTab(): BrowserTabRecord | null {
    if (!this.activeTabId) {
      return null
    }
    return this.tabs.get(this.activeTabId) ?? null
  }

  private refreshTabFromContents(tab: BrowserTabRecord): void {
    tab.title = tab.view.webContents.getTitle().trim() || getFallbackTitle(tab.url)
    tab.url = tab.view.webContents.getURL().trim() || tab.url || DEFAULT_URL
  }

  private async enableInspectForTab(tab: BrowserTabRecord | null): Promise<void> {
    if (!tab) return
    await tab.view.webContents.executeJavaScript(buildInspectEnableScript())
  }

  private buildState(): DesktopBrowserState {
    const tabs = this.tabOrder
      .map(tabId => this.tabs.get(tabId))
      .filter((tab): tab is BrowserTabRecord => Boolean(tab))
      .map<DesktopBrowserTabState>(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: tab.id === this.activeTabId,
        isLoading: tab.isLoading,
        canGoBack: tab.view.webContents.canGoBack(),
        canGoForward: tab.view.webContents.canGoForward(),
      }))
    const activeTab = this.getActiveTab()
    return {
      tabs,
      activeTabId: this.activeTabId,
      activeUrl: activeTab ? activeTab.url : null,
      isLoading: activeTab ? activeTab.isLoading : false,
      canGoBack: activeTab ? activeTab.view.webContents.canGoBack() : false,
      canGoForward: activeTab ? activeTab.view.webContents.canGoForward() : false,
      bounds: this.bounds,
    }
  }

  private applyBoundsToView(view: BrowserViewLike): void {
    const mainWindow = this.getMainWindow()
    if (!mainWindow) {
      return
    }
    const windowBounds = mainWindow.getContentBounds()
    view.setBounds(
      this.bounds
        ? clampBoundsToWindow(this.bounds, windowBounds)
        : normalizeWindowContentBounds(windowBounds)
    )
  }

  private getWindowZoomFactor(mainWindow: BrowserWindowLike | null): number {
    const zoomFactor = mainWindow?.webContents?.getZoomFactor()
    return typeof zoomFactor === 'number' && Number.isFinite(zoomFactor) && zoomFactor > 0
      ? zoomFactor
      : 1
  }

  private getWindowContentView(window: BrowserWindowLike | null): ContentViewLike | null {
    const contentView = window?.contentView
    if (
      !contentView ||
      typeof contentView.addChildView !== 'function' ||
      typeof contentView.removeChildView !== 'function'
    ) {
      return null
    }
    return contentView
  }

  private detachActiveView(): void {
    if (!this.attachedWindow || !this.attachedTabId) {
      return
    }
    const contentView = this.getWindowContentView(this.attachedWindow)
    const attachedTab = this.tabs.get(this.attachedTabId)
    if (contentView && attachedTab) {
      contentView.removeChildView(attachedTab.view)
    }
    this.attachedWindow = null
    this.attachedTabId = null
  }

  private canAttachActiveView(): boolean {
    return Boolean(this.bounds && this.bounds.width > 0 && this.bounds.height > 0 && this.bounds.x > 0)
  }

  private attachActiveView(): void {
    const mainWindow = this.getMainWindow()
    const activeTab = this.getActiveTab()
    if (!mainWindow || !activeTab) {
      this.detachActiveView()
      return
    }
    if (!this.canAttachActiveView()) {
      this.detachActiveView()
      return
    }

    if (this.attachedWindow !== mainWindow) {
      this.detachActiveView()
      this.attachedWindow = mainWindow
    }

    const contentView = this.getWindowContentView(mainWindow)
    if (!contentView) {
      return
    }

    if (this.attachedTabId && this.attachedTabId !== activeTab.id) {
      const previousTab = this.tabs.get(this.attachedTabId)
      if (previousTab) {
        contentView.removeChildView(previousTab.view)
      }
      this.attachedTabId = null
    }

    if (this.attachedTabId !== activeTab.id) {
      contentView.addChildView(activeTab.view)
      this.attachedTabId = activeTab.id
    }
    this.applyBoundsToView(activeTab.view)
  }

  private ensureAttachedIfNeeded(): void {
    if (!this.getActiveTab()) {
      this.detachActiveView()
      return
    }
    this.attachActiveView()
  }

  private createTab(url: string, activate: boolean): BrowserTabRecord {
    const view = this.deps.createBrowserView()

    const id = this.deps.randomId()
    const tab: BrowserTabRecord = {
      id,
      view,
      title: getFallbackTitle(url),
      url,
      isLoading: false,
    }

    const refresh = () => this.refreshTabFromContents(tab)

    view.webContents.on('did-start-loading', () => {
      tab.isLoading = true
      refresh()
    })
    view.webContents.on('did-stop-loading', () => {
      tab.isLoading = false
      refresh()
      if (this.inspectEnabled && tab.id === this.activeTabId) {
        void this.enableInspectForTab(tab).catch(() => undefined)
      }
    })
    view.webContents.on('page-title-updated', (_event, title: unknown) => {
      tab.title = typeof title === 'string' && title.trim() ? title.trim() : getFallbackTitle(tab.url)
    })
    view.webContents.on('did-navigate', refresh)
    view.webContents.on('did-navigate-in-page', refresh)
    view.webContents.once('destroyed', () => {
      this.tabs.delete(tab.id)
      const index = this.tabOrder.indexOf(tab.id)
      if (index >= 0) {
        this.tabOrder.splice(index, 1)
      }
      if (this.activeTabId === tab.id) {
        this.activeTabId = this.tabOrder[0] ?? null
        this.ensureAttachedIfNeeded()
      }
    })

    this.tabs.set(id, tab)
    this.tabOrder.push(id)

    if (activate) {
      this.activeTabId = id
      this.ensureAttachedIfNeeded()
    }

    void view.webContents.loadURL(url).catch(() => undefined)
    refresh()
    return tab
  }

  private getOrCreateActiveTab(url?: string): BrowserTabRecord {
    const activeTab = this.getActiveTab()
    if (activeTab) {
      return activeTab
    }
    return this.createTab(url ?? DEFAULT_URL, true)
  }

  private async runWithActiveTab(
    action: (tab: BrowserTabRecord) => void | Promise<void>,
    fallbackUrl?: string
  ): Promise<DesktopBrowserState> {
    const tab = this.getOrCreateActiveTab(fallbackUrl)
    await Promise.resolve(action(tab))
    this.ensureAttachedIfNeeded()
    return this.buildState()
  }

  private setActiveTab(tabId: string): boolean {
    if (!this.tabs.has(tabId)) {
      return false
    }
    this.activeTabId = tabId
    this.ensureAttachedIfNeeded()
    return true
  }

  getState(): DesktopBrowserState {
    return this.buildState()
  }

  async navigate(url: string): Promise<DesktopBrowserState> {
    const normalized = normalizeBrowserUrl(url)
    if (!normalized) {
      return this.buildState()
    }
    if (!this.getActiveTab()) {
      this.createTab(normalized, true)
      return this.buildState()
    }
    return this.runWithActiveTab(async tab => {
      tab.isLoading = true
      await tab.view.webContents.loadURL(normalized)
    }, normalized)
  }

  async back(): Promise<DesktopBrowserState> {
    const activeTab = this.getActiveTab()
    if (!activeTab || !activeTab.view.webContents.canGoBack()) {
      return this.buildState()
    }
    return this.runWithActiveTab(tab => {
      tab.view.webContents.goBack()
    })
  }

  async forward(): Promise<DesktopBrowserState> {
    const activeTab = this.getActiveTab()
    if (!activeTab || !activeTab.view.webContents.canGoForward()) {
      return this.buildState()
    }
    return this.runWithActiveTab(tab => {
      tab.view.webContents.goForward()
    })
  }

  async reload(): Promise<DesktopBrowserState> {
    const activeTab = this.getActiveTab()
    if (!activeTab) {
      return this.buildState()
    }
    return this.runWithActiveTab(tab => {
      tab.view.webContents.reload()
    })
  }

  async openTab(url?: string): Promise<DesktopBrowserState> {
    const normalized = url ? normalizeBrowserUrl(url) ?? DEFAULT_URL : DEFAULT_URL
    this.createTab(normalized, true)
    return this.buildState()
  }

  async closeTab(tabId: string): Promise<DesktopBrowserState> {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return this.buildState()
    }

    const wasActive = this.activeTabId === tabId
    this.tabs.delete(tabId)
    const index = this.tabOrder.indexOf(tabId)
    if (index >= 0) {
      this.tabOrder.splice(index, 1)
    }
    tab.view.webContents.destroy()

    if (wasActive) {
      this.activeTabId = this.tabOrder[index] ?? this.tabOrder[index - 1] ?? this.tabOrder[0] ?? null
      this.ensureAttachedIfNeeded()
    }

    return this.buildState()
  }

  async switchTab(tabId: string): Promise<DesktopBrowserState> {
    if (!this.setActiveTab(tabId)) {
      return this.buildState()
    }
    if (this.inspectEnabled) {
      await this.enableInspectForTab(this.getActiveTab())
    }
    return this.buildState()
  }

  async setBounds(bounds: DesktopBrowserBounds): Promise<DesktopBrowserState> {
    const mainWindow = this.getMainWindow()
    const cssBounds = {
      x: Math.max(0, Math.floor(bounds.x)),
      y: Math.max(0, Math.floor(bounds.y)),
      width: Math.max(0, Math.floor(bounds.width)),
      height: Math.max(0, Math.floor(bounds.height)),
    }
    this.bounds = mainWindow
      ? scaleCssBoundsToWindowDips(cssBounds, this.getWindowZoomFactor(mainWindow))
      : cssBounds
    if (mainWindow) {
      this.bounds = clampBoundsToWindow(this.bounds, mainWindow.getContentBounds())
    }
    const activeTab = this.getActiveTab()
    if (activeTab) {
      this.ensureAttachedIfNeeded()
      this.applyBoundsToView(activeTab.view)
    }
    return this.buildState()
  }

  async enableInspect(): Promise<{ ok: boolean }> {
    this.inspectEnabled = true
    await this.enableInspectForTab(this.getActiveTab())
    return { ok: true }
  }

  async disableInspect(): Promise<{ ok: boolean }> {
    this.inspectEnabled = false
    const activeTab = this.getActiveTab()
    if (activeTab) {
      await activeTab.view.webContents.executeJavaScript(buildInspectDisableScript())
    }
    return { ok: true }
  }

  async pollInspectAnnotation(): Promise<DesktopBrowserAnnotationCandidate | null> {
    const activeTab = this.getActiveTab()
    if (!activeTab || !this.inspectEnabled) {
      return null
    }
    const raw = await activeTab.view.webContents.executeJavaScript<DesktopBrowserAnnotationCandidate | null>(
      buildInspectGetAnnotationScript()
    )
    return normalizeAnnotationCandidate(raw)
  }

  async inspectAtPoint(
    point: DesktopBrowserInspectPoint
  ): Promise<DesktopBrowserAnnotationCandidate | null> {
    const activeTab = this.getActiveTab()
    if (!activeTab || !this.bounds) {
      return null
    }

    const localX = Math.max(0, Math.floor(point.x - this.bounds.x))
    const localY = Math.max(0, Math.floor(point.y - this.bounds.y))
    const raw = await activeTab.view.webContents.executeJavaScript<DesktopBrowserAnnotationCandidate | null>(
      buildInspectScript(localX, localY)
    )
    return normalizeAnnotationCandidate(raw)
  }
}

export function createBrowserRuntimeController(
  host: BrowserRuntimeHost,
  deps: Partial<BrowserRuntimeDeps> = {}
): BrowserRuntimeController {
  const openExternal = deps.openExternal ?? (url => void shell.openExternal(url))
  const randomId = deps.randomId ?? (() => randomUUID())
  const createBrowserView = deps.createBrowserView ?? (() => createElectronBrowserView(openExternal))
  return new BrowserRuntimeControllerImpl(host, {
    openExternal,
    randomId,
    createBrowserView,
  })
}
