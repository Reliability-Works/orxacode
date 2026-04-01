import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import {
  WebContentsView,
  session,
  type BrowserWindow,
  type Session,
  type WebContents,
} from 'electron'
import type {
  BrowserAgentActionRequest,
  BrowserAgentActionResult,
  BrowserBounds,
  BrowserHistoryItem,
  BrowserState,
  OrxaEvent,
} from '../../shared/ipc'
import { ArtifactStore } from './artifact-store'
import { readHistory, recordHistoryEntry } from './browser-controller-history'
import { isAllowedBrowserUrl, toSafeBrowserUrl } from './browser-controller-utils'
import {
  DEFAULT_NEW_TAB_URL,
  requireTab,
  resolveTabID,
  snapshotTab,
  titleForRecord,
} from './browser-controller-tabs'
import type { BrowserTabRecord } from './browser-controller-tabs'
import {
  disableBrowserInspect,
  enableBrowserInspect,
  performBrowserAgentAction,
} from './browser-controller-actions'

const DEFAULT_BROWSER_PARTITION = 'persist:orxa-browser'
const DEFAULT_HISTORY_LIMIT = 1_000
const DEFAULT_HISTORY_READ_LIMIT = 200

type BrowserHistoryStoreState = {
  version: 1
  items: BrowserHistoryItem[]
}

type BrowserHistoryStore = {
  get: (key: 'items', defaultValue: BrowserHistoryItem[]) => BrowserHistoryItem[]
  set: (key: 'items', value: BrowserHistoryItem[]) => void
}

type BrowserControllerOptions = {
  onEvent?: (event: OrxaEvent) => void
  partition?: string
  historyLimit?: number
  historyStore?: BrowserHistoryStore
  createView?: () => WebContentsView
  browserSession?: Session
  now?: () => number
  createID?: () => string
  artifactStore?: ArtifactStore
}

export class BrowserController {
  private readonly onEvent: (event: OrxaEvent) => void

  private readonly partition: string

  private readonly historyLimit: number

  private readonly historyStore: BrowserHistoryStore

  private readonly createView: () => WebContentsView

  private readonly browserSession: Session

  private readonly now: () => number

  private readonly createID: () => string

  readonly artifactStore: ArtifactStore

  private readonly tabs = new Map<string, BrowserTabRecord>()

  private activeTabID: string | undefined

  private attachedTabID: string | undefined

  private window: BrowserWindow | null = null

  private visible = false

  private bounds: BrowserBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }

  constructor(options: BrowserControllerOptions = {}) {
    this.onEvent = options.onEvent ?? (() => undefined)
    this.partition = options.partition ?? DEFAULT_BROWSER_PARTITION
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT
    this.historyStore =
      options.historyStore ??
      (new Store<BrowserHistoryStoreState>({
        name: 'browser-history',
        defaults: {
          version: 1,
          items: [],
        },
      }) as BrowserHistoryStore)
    this.createView =
      options.createView ??
      (() =>
        new WebContentsView({
          webPreferences: {
            partition: this.partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            safeDialogs: true,
          },
        }))
    this.browserSession = options.browserSession ?? session.fromPartition(this.partition)
    this.now = options.now ?? (() => Date.now())
    this.createID = options.createID ?? (() => randomUUID())
    this.artifactStore = options.artifactStore ?? new ArtifactStore()

    this.configureSessionSecurityGuards()
  }

  setWindow(window: BrowserWindow | null): BrowserState {
    if (this.window === window) {
      return this.getState()
    }

    this.detachCurrentView()
    this.window = window

    this.attachActiveView()
    this.emitState()
    return this.getState()
  }

  setVisible(visible: boolean): BrowserState {
    if (this.visible === visible) {
      return this.getState()
    }
    this.visible = visible
    if (!visible) {
      this.detachCurrentView()
    } else {
      this.attachActiveView()
    }
    this.emitState()
    return this.getState()
  }

  dispose() {
    this.detachCurrentView()

    const records = [...this.tabs.values()]
    this.tabs.clear()
    this.activeTabID = undefined
    this.attachedTabID = undefined
    this.visible = false
    this.window = null

    for (const record of records) {
      const webContents = record.view.webContents
      if (!webContents.isDestroyed()) {
        webContents.close()
      }
    }
  }

  getState(): BrowserState {
    return {
      partition: this.partition,
      bounds: { ...this.bounds },
      tabs: [...this.tabs.values()].map(record => snapshotTab(record)),
      activeTabID: this.activeTabID,
    }
  }

  setBounds(bounds: BrowserBounds): BrowserState {
    const nextBounds = {
      x: Math.floor(bounds.x),
      y: Math.floor(bounds.y),
      width: Math.max(0, Math.floor(bounds.width)),
      height: Math.max(0, Math.floor(bounds.height)),
    }

    // Safety guard: reject bounds that would expand the browser pane to fill the
    // full window (x=0 with a non-trivial width). The browser panel is always
    // inset from the left edge of the window, so x=0 combined with a large width
    // indicates stale/erroneous bounds from before the sidebar was positioned.
    if (nextBounds.x === 0 && nextBounds.width > 0) {
      return this.getState()
    }

    if (
      this.bounds.x === nextBounds.x &&
      this.bounds.y === nextBounds.y &&
      this.bounds.width === nextBounds.width &&
      this.bounds.height === nextBounds.height
    ) {
      return this.getState()
    }
    this.bounds = nextBounds

    // If the controller is visible but the view was previously held back because
    // bounds were invalid (x=0 / zero-sized), now that we have valid bounds we
    // need to attach+position the view, not just update its rect.
    if (this.visible) {
      this.attachActiveView()
    } else {
      this.applyBoundsToActiveView()
    }
    this.emitState()
    return this.getState()
  }

  async openTab(url?: string, activate = true): Promise<BrowserState> {
    const target = toSafeBrowserUrl(url)
    const tabID = this.createID()
    const record: BrowserTabRecord = {
      id: tabID,
      view: this.createView(),
      lastActivityAt: this.now(),
    }

    this.tabs.set(tabID, record)
    this.configureTabGuards(record)

    if (!this.activeTabID || activate) {
      this.activateTab(tabID)
    }

    try {
      await record.view.webContents.loadURL(target)
    } catch {
      // If the URL fails to load (e.g. connection refused), keep the tab
      // open on about:blank instead of destroying it
      if (target !== 'about:blank') {
        try {
          await record.view.webContents.loadURL('about:blank')
        } catch {
          // Silently ignore — tab remains in whatever state it's in
        }
      }
    }

    this.emitState()
    return this.getState()
  }

  closeTab(tabID?: string): BrowserState {
    const resolvedTabID = resolveTabID(tabID, this.activeTabID, this.tabs)
    if (!resolvedTabID) {
      return this.getState()
    }

    this.removeTabRecord(resolvedTabID)
    this.emitState()
    return this.getState()
  }

  switchTab(tabID: string): BrowserState {
    requireTab(tabID, this.activeTabID, this.tabs)
    this.activateTab(tabID)
    this.emitState()
    return this.getState()
  }

  async navigate(url: string, tabID?: string): Promise<BrowserState> {
    const target = toSafeBrowserUrl(url)
    if (!tabID && !this.activeTabID) {
      return this.openTab(target, true)
    }
    const record = requireTab(tabID, this.activeTabID, this.tabs)
    await record.view.webContents.loadURL(target)
    this.emitState()
    return this.getState()
  }

  back(tabID?: string): BrowserState {
    const record = requireTab(tabID, this.activeTabID, this.tabs)
    const webContents = record.view.webContents
    if (webContents.navigationHistory?.canGoBack?.()) {
      webContents.goBack()
    }
    this.emitState()
    return this.getState()
  }

  forward(tabID?: string): BrowserState {
    const record = requireTab(tabID, this.activeTabID, this.tabs)
    const webContents = record.view.webContents
    if (webContents.navigationHistory?.canGoForward?.()) {
      webContents.goForward()
    }
    this.emitState()
    return this.getState()
  }

  reload(tabID?: string): BrowserState {
    const record = requireTab(tabID, this.activeTabID, this.tabs)
    record.view.webContents.reload()
    this.emitState()
    return this.getState()
  }

  listHistory(limit = DEFAULT_HISTORY_READ_LIMIT): BrowserHistoryItem[] {
    const normalizedLimit = Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : DEFAULT_HISTORY_READ_LIMIT
    return readHistory(this.historyStore).slice(0, normalizedLimit)
  }

  clearHistory(): BrowserHistoryItem[] {
    const existing = readHistory(this.historyStore)
    this.historyStore.set('items', [])
    this.emit({
      type: 'browser.history.cleared',
      payload: {
        count: existing.length,
      },
    })
    return []
  }

  async performAgentAction(request: BrowserAgentActionRequest): Promise<BrowserAgentActionResult> {
    return performBrowserAgentAction(
      this as unknown as Parameters<typeof performBrowserAgentAction>[0],
      request
    )
  }

  private emitState() {
    this.emit({
      type: 'browser.state',
      payload: this.getState(),
    })
  }

  private emit(event: OrxaEvent) {
    this.onEvent(event)
  }

  private configureSessionSecurityGuards() {
    this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    this.browserSession.setPermissionCheckHandler(() => false)
  }

  private configureTabGuards(record: BrowserTabRecord) {
    const webContents = record.view.webContents

    webContents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedBrowserUrl(url)) {
        return { action: 'deny' }
      }
      void this.openTab(url, false).catch(() => undefined)
      return { action: 'deny' }
    })

    const blockUnsafeNavigation = (event: { preventDefault: () => void }, candidateUrl: string) => {
      if (!isAllowedBrowserUrl(candidateUrl)) {
        event.preventDefault()
      }
    }

    webContents.on('will-navigate', details => {
      blockUnsafeNavigation(details, String(details.url))
    })
    webContents.on('will-frame-navigate', details => {
      blockUnsafeNavigation(details, String(details.url))
    })
    webContents.on('will-redirect', details => {
      blockUnsafeNavigation(details, String(details.url))
    })

    webContents.on('did-start-loading', () => {
      record.lastActivityAt = this.now()
      this.emitState()
    })
    webContents.on('did-stop-loading', () => {
      record.lastActivityAt = this.now()
      this.emitState()
    })
    webContents.on('did-fail-load', () => {
      record.lastActivityAt = this.now()
      this.emitState()
    })
    webContents.on('page-title-updated', () => {
      record.lastActivityAt = this.now()
      this.emitState()
    })

    const onDidNavigate = (_event: unknown, candidateUrl: string) => {
      const normalized = String(candidateUrl)
      if (!isAllowedBrowserUrl(normalized) || normalized === DEFAULT_NEW_TAB_URL) {
        record.lastActivityAt = this.now()
        this.emitState()
        return
      }
      const now = this.now()
      record.lastNavigatedAt = now
      record.lastActivityAt = now
      recordHistoryEntry({
        url: normalized,
        title: titleForRecord(record),
        historyStore: this.historyStore,
        historyLimit: this.historyLimit,
        now: this.now,
        createID: this.createID,
        emit: event => this.emit(event),
      })
      this.emitState()
    }

    webContents.on('did-navigate', onDidNavigate)
    webContents.on('did-navigate-in-page', onDidNavigate)

    webContents.on('destroyed', () => {
      if (!this.tabs.has(record.id)) {
        return
      }
      this.removeTabRecord(record.id, false)
      this.emitState()
    })
  }

  private removeTabRecord(tabID: string, destroy = true) {
    const record = this.tabs.get(tabID)
    if (!record) {
      return
    }

    if (this.attachedTabID === tabID) {
      this.detachCurrentView()
    }

    this.tabs.delete(tabID)

    if (destroy) {
      const webContents = record.view.webContents
      if (!webContents.isDestroyed()) {
        webContents.close()
      }
    }

    if (this.activeTabID === tabID) {
      const remainingTabIDs = [...this.tabs.keys()]
      this.activeTabID =
        remainingTabIDs.length > 0 ? remainingTabIDs[remainingTabIDs.length - 1] : undefined
      this.attachActiveView()
    }
  }

  private activateTab(tabID: string) {
    if (!this.tabs.has(tabID)) {
      throw new Error('Browser tab not found')
    }
    if (this.activeTabID === tabID) {
      this.attachActiveView()
      return
    }

    this.activeTabID = tabID
    this.attachActiveView()
  }

  requireTab(tabID?: string): BrowserTabRecord {
    return requireTab(tabID, this.activeTabID, this.tabs)
  }

  titleForRecord(record: BrowserTabRecord): string {
    return titleForRecord(record)
  }

  private applyBoundsToActiveView() {
    if (!this.activeTabID) {
      return
    }
    const record = this.tabs.get(this.activeTabID)
    if (!record) {
      return
    }
    record.view.setBounds({ ...this.bounds })
  }

  private getWindowContentView() {
    if (!this.window || this.window.isDestroyed()) {
      return undefined
    }

    const contentView = (
      this.window as BrowserWindow & {
        contentView?: {
          addChildView?: (view: WebContentsView) => void
          removeChildView?: (view: WebContentsView) => void
        }
      }
    ).contentView

    if (
      !contentView ||
      typeof contentView.addChildView !== 'function' ||
      typeof contentView.removeChildView !== 'function'
    ) {
      return undefined
    }

    return contentView
  }

  private detachCurrentView() {
    if (!this.attachedTabID) {
      return
    }

    const contentView = this.getWindowContentView()
    if (!contentView) {
      this.attachedTabID = undefined
      return
    }

    const record = this.tabs.get(this.attachedTabID)
    if (record) {
      contentView.removeChildView(record.view)
    }

    this.attachedTabID = undefined
  }

  private attachActiveView() {
    if (!this.visible || !this.activeTabID) {
      this.detachCurrentView()
      return
    }

    // Guard: if bounds are zero-sized or indicate full-window coverage (x=0 with
    // any width), the bounds are stale. Keep the view detached until valid bounds
    // are delivered via setBounds().
    const boundsAreValid = this.bounds.width > 0 && this.bounds.height > 0 && this.bounds.x > 0
    if (!boundsAreValid) {
      this.detachCurrentView()
      return
    }

    const record = this.tabs.get(this.activeTabID)
    const contentView = this.getWindowContentView()
    if (!record || !contentView) {
      return
    }

    if (this.attachedTabID && this.attachedTabID !== record.id) {
      const current = this.tabs.get(this.attachedTabID)
      if (current) {
        contentView.removeChildView(current.view)
      }
      this.attachedTabID = undefined
    }

    if (this.attachedTabID !== record.id) {
      contentView.addChildView(record.view)
      this.attachedTabID = record.id
    }

    record.view.setBounds({ ...this.bounds })
  }

  // ── Inspect mode ────────────────────────────────────────────────────

  inspectPollTimer: ReturnType<typeof setInterval> | null = null
  inspectEventCallback: ((annotation: unknown) => void) | null = null

  async enableInspect(onAnnotation: (annotation: unknown) => void): Promise<void> {
    return enableBrowserInspect(
      this as unknown as Parameters<typeof enableBrowserInspect>[0],
      onAnnotation
    )
  }

  async disableInspect(): Promise<void> {
    return disableBrowserInspect(this as unknown as Parameters<typeof disableBrowserInspect>[0])
  }

  getActiveWebContents(): WebContents | null {
    if (!this.activeTabID) return null
    const record = this.tabs.get(this.activeTabID)
    if (!record || record.view.webContents.isDestroyed()) return null
    return record.view.webContents
  }
}

export const BROWSER_CONTROLLER_PARTITION = DEFAULT_BROWSER_PARTITION
