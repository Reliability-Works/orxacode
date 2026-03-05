import { randomUUID } from "node:crypto";
import Store from "electron-store";
import { WebContentsView, session, type BrowserWindow, type Rectangle, type Session, type WebContents } from "electron";
import type {
  BrowserAgentActionRequest,
  BrowserAgentActionResult,
  BrowserBounds,
  BrowserHistoryItem,
  BrowserLocator,
  BrowserState,
  BrowserTab,
  OrxaEvent,
} from "../../shared/ipc";
import { ArtifactStore } from "./artifact-store";

const DEFAULT_BROWSER_PARTITION = "persist:orxa-browser";
const DEFAULT_NEW_TAB_URL = "about:blank";
const DEFAULT_HISTORY_LIMIT = 1_000;
const DEFAULT_HISTORY_READ_LIMIT = 200;
const DEFAULT_ACTION_TIMEOUT_MS = 12_000;
const DEFAULT_WAIT_INTERVAL_MS = 120;
const DEFAULT_WAIT_FOR_IDLE_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const SCHEMES_ALLOWLIST = new Set(["http:", "https:"]);

type BrowserHistoryStoreState = {
  version: 1;
  items: BrowserHistoryItem[];
};

type BrowserHistoryStore = {
  get: (key: "items", defaultValue: BrowserHistoryItem[]) => BrowserHistoryItem[];
  set: (key: "items", value: BrowserHistoryItem[]) => void;
};

type BrowserControllerOptions = {
  onEvent?: (event: OrxaEvent) => void;
  partition?: string;
  historyLimit?: number;
  historyStore?: BrowserHistoryStore;
  createView?: () => WebContentsView;
  browserSession?: Session;
  now?: () => number;
  createID?: () => string;
  artifactStore?: ArtifactStore;
};

type BrowserTabRecord = {
  id: string;
  view: WebContentsView;
  lastNavigatedAt?: number;
  lastActivityAt: number;
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown browser error";
}

function isAllowedBrowserUrl(rawUrl: string): boolean {
  if (rawUrl === DEFAULT_NEW_TAB_URL) {
    return true;
  }

  try {
    const parsed = new URL(rawUrl);
    return SCHEMES_ALLOWLIST.has(parsed.protocol);
  } catch {
    return false;
  }
}

function toSafeBrowserUrl(rawUrl?: string): string {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return DEFAULT_NEW_TAB_URL;
  }

  const value = rawUrl.trim();
  if (!isAllowedBrowserUrl(value)) {
    throw new Error("URL scheme is not allowed");
  }

  if (value === DEFAULT_NEW_TAB_URL) {
    return value;
  }

  return new URL(value).toString();
}

function clampJpegQuality(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 80;
  }
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function clampTimeoutMs(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ACTION_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(120_000, Math.floor(value)));
}

function clampAttempts(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.min(8, Math.floor(value)));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toLocatorFromRequest(request: {
  selector?: string;
  locator?: BrowserLocator;
}): BrowserLocator {
  const locator = request.locator ?? {};
  if (request.selector && !locator.selector) {
    return {
      ...locator,
      selector: request.selector,
    };
  }
  return locator;
}

function toRectFromBounds(bounds?: Partial<BrowserBounds>): Rectangle | undefined {
  if (!bounds) {
    return undefined;
  }

  const x = typeof bounds.x === "number" ? bounds.x : undefined;
  const y = typeof bounds.y === "number" ? bounds.y : undefined;
  const width = typeof bounds.width === "number" ? bounds.width : undefined;
  const height = typeof bounds.height === "number" ? bounds.height : undefined;

  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.floor(width),
    height: Math.floor(height),
  };
}

export class BrowserController {
  private readonly onEvent: (event: OrxaEvent) => void;

  private readonly partition: string;

  private readonly historyLimit: number;

  private readonly historyStore: BrowserHistoryStore;

  private readonly createView: () => WebContentsView;

  private readonly browserSession: Session;

  private readonly now: () => number;

  private readonly createID: () => string;

  private readonly artifactStore: ArtifactStore;

  private readonly tabs = new Map<string, BrowserTabRecord>();

  private activeTabID: string | undefined;

  private attachedTabID: string | undefined;

  private window: BrowserWindow | null = null;

  private visible = false;

  private bounds: BrowserBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  constructor(options: BrowserControllerOptions = {}) {
    this.onEvent = options.onEvent ?? (() => undefined);
    this.partition = options.partition ?? DEFAULT_BROWSER_PARTITION;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.historyStore =
      options.historyStore ??
      (new Store<BrowserHistoryStoreState>({
        name: "browser-history",
        defaults: {
          version: 1,
          items: [],
        },
      }) as BrowserHistoryStore);
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
        }));
    this.browserSession = options.browserSession ?? session.fromPartition(this.partition);
    this.now = options.now ?? (() => Date.now());
    this.createID = options.createID ?? (() => randomUUID());
    this.artifactStore = options.artifactStore ?? new ArtifactStore();

    this.configureSessionSecurityGuards();
  }

  setWindow(window: BrowserWindow | null): BrowserState {
    if (this.window === window) {
      return this.getState();
    }

    this.detachCurrentView();
    this.window = window;

    this.attachActiveView();
    this.emitState();
    return this.getState();
  }

  setVisible(visible: boolean): BrowserState {
    if (this.visible === visible) {
      return this.getState();
    }
    this.visible = visible;
    if (!visible) {
      this.detachCurrentView();
    } else {
      this.attachActiveView();
    }
    this.emitState();
    return this.getState();
  }

  dispose() {
    this.detachCurrentView();

    const records = [...this.tabs.values()];
    this.tabs.clear();
    this.activeTabID = undefined;
    this.attachedTabID = undefined;
    this.visible = false;
    this.window = null;

    for (const record of records) {
      const webContents = record.view.webContents;
      if (!webContents.isDestroyed()) {
        webContents.close();
      }
    }
  }

  getState(): BrowserState {
    return {
      partition: this.partition,
      bounds: { ...this.bounds },
      tabs: [...this.tabs.values()].map((record) => this.snapshotTab(record)),
      activeTabID: this.activeTabID,
    };
  }

  setBounds(bounds: BrowserBounds): BrowserState {
    const nextBounds = {
      x: Math.floor(bounds.x),
      y: Math.floor(bounds.y),
      width: Math.max(0, Math.floor(bounds.width)),
      height: Math.max(0, Math.floor(bounds.height)),
    };
    if (
      this.bounds.x === nextBounds.x &&
      this.bounds.y === nextBounds.y &&
      this.bounds.width === nextBounds.width &&
      this.bounds.height === nextBounds.height
    ) {
      return this.getState();
    }
    this.bounds = nextBounds;

    this.applyBoundsToActiveView();
    this.emitState();
    return this.getState();
  }

  async openTab(url?: string, activate = true): Promise<BrowserState> {
    const target = toSafeBrowserUrl(url);
    const tabID = this.createID();
    const record: BrowserTabRecord = {
      id: tabID,
      view: this.createView(),
      lastActivityAt: this.now(),
    };

    this.tabs.set(tabID, record);
    this.configureTabGuards(record);

    if (!this.activeTabID || activate) {
      this.activateTab(tabID);
    }

    try {
      await record.view.webContents.loadURL(target);
    } catch (error) {
      this.removeTabRecord(tabID);
      throw new Error(normalizeErrorMessage(error));
    }

    this.emitState();
    return this.getState();
  }

  closeTab(tabID?: string): BrowserState {
    const resolvedTabID = this.resolveTabID(tabID);
    if (!resolvedTabID) {
      return this.getState();
    }

    this.removeTabRecord(resolvedTabID);
    this.emitState();
    return this.getState();
  }

  switchTab(tabID: string): BrowserState {
    this.requireTab(tabID);
    this.activateTab(tabID);
    this.emitState();
    return this.getState();
  }

  async navigate(url: string, tabID?: string): Promise<BrowserState> {
    const target = toSafeBrowserUrl(url);
    if (!tabID && !this.activeTabID) {
      return this.openTab(target, true);
    }
    const record = this.requireTab(tabID);
    await record.view.webContents.loadURL(target);
    this.emitState();
    return this.getState();
  }

  back(tabID?: string): BrowserState {
    const record = this.requireTab(tabID);
    const webContents = record.view.webContents;
    if (webContents.canGoBack()) {
      webContents.goBack();
    }
    this.emitState();
    return this.getState();
  }

  forward(tabID?: string): BrowserState {
    const record = this.requireTab(tabID);
    const webContents = record.view.webContents;
    if (webContents.canGoForward()) {
      webContents.goForward();
    }
    this.emitState();
    return this.getState();
  }

  reload(tabID?: string): BrowserState {
    const record = this.requireTab(tabID);
    record.view.webContents.reload();
    this.emitState();
    return this.getState();
  }

  listHistory(limit = DEFAULT_HISTORY_READ_LIMIT): BrowserHistoryItem[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_HISTORY_READ_LIMIT;
    return this.readHistory().slice(0, normalizedLimit);
  }

  clearHistory(): BrowserHistoryItem[] {
    const existing = this.readHistory();
    this.historyStore.set("items", []);
    this.emit({
      type: "browser.history.cleared",
      payload: {
        count: existing.length,
      },
    });
    return [];
  }

  async performAgentAction(request: BrowserAgentActionRequest): Promise<BrowserAgentActionResult> {
    let tabID = "tabID" in request ? request.tabID : undefined;

    try {
      let data: Record<string, unknown> | undefined;

      switch (request.action) {
        case "open_tab": {
          await this.openTab(request.url, request.activate ?? true);
          tabID = this.activeTabID;
          break;
        }
        case "close_tab": {
          this.closeTab(request.tabID);
          tabID = request.tabID;
          break;
        }
        case "switch_tab": {
          this.switchTab(request.tabID);
          tabID = request.tabID;
          break;
        }
        case "navigate": {
          await this.navigate(request.url, request.tabID);
          tabID = request.tabID ?? this.activeTabID;
          break;
        }
        case "back": {
          this.back(request.tabID);
          tabID = request.tabID ?? this.activeTabID;
          break;
        }
        case "forward": {
          this.forward(request.tabID);
          tabID = request.tabID ?? this.activeTabID;
          break;
        }
        case "reload": {
          this.reload(request.tabID);
          tabID = request.tabID ?? this.activeTabID;
          break;
        }
        case "click": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const attempts = clampAttempts(request.maxAttempts);
          const outcome = await this.runDomActionWithRetry(
            record.view.webContents,
            this.buildInteractionScript("click", locator, { timeoutMs }),
            "click",
            attempts,
          );
          if (request.waitForNavigation) {
            await this.waitForNavigation(record, timeoutMs);
          }
          data = {
            ...outcome,
            locator,
            attempts,
            timeoutMs,
            waitForNavigation: request.waitForNavigation ?? false,
          };
          break;
        }
        case "type": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const attempts = clampAttempts(request.maxAttempts);
          const outcome = await this.runDomActionWithRetry(
            record.view.webContents,
            this.buildInteractionScript("type", locator, {
              timeoutMs,
              text: request.text,
              clear: request.clear ?? true,
            }),
            "type",
            attempts,
          );
          if (request.submit) {
            await this.runDomAction(record.view.webContents, this.buildPressScript("Enter"), "press");
          }
          data = {
            ...outcome,
            locator,
            typed: request.text.length,
            submitted: request.submit ?? false,
            attempts,
            timeoutMs,
          };
          break;
        }
        case "press": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          await this.runDomAction(record.view.webContents, this.buildPressScript(request.key), "press");
          data = { key: request.key };
          break;
        }
        case "scroll": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          await this.runDomAction(
            record.view.webContents,
            this.buildScrollScript(request.x, request.y, request.top, request.left, request.behavior),
            "scroll",
          );
          data = {
            x: request.x,
            y: request.y,
            top: request.top,
            left: request.left,
            behavior: request.behavior,
          };
          break;
        }
        case "extract_text": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const attempts = clampAttempts(request.maxAttempts);
          const outcome = await this.runDomActionWithRetry(
            record.view.webContents,
            this.buildInteractionScript("extract_text", locator, {
              maxLength: request.maxLength,
              timeoutMs,
            }),
            "extract_text",
            attempts,
          );
          const extractedText = outcome["text"];
          const selectorUsed = outcome["selectorUsed"];
          const strategyUsed = outcome["strategyUsed"];
          data = {
            text: typeof extractedText === "string" ? extractedText : "",
            locator,
            selectorUsed: typeof selectorUsed === "string" ? selectorUsed : undefined,
            strategyUsed: typeof strategyUsed === "string" ? strategyUsed : undefined,
            attempts,
            timeoutMs,
          };
          break;
        }
        case "exists": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const outcome = await this.runDomAction(
            record.view.webContents,
            this.buildInteractionScript("exists", locator, { timeoutMs }),
            "exists",
          );
          data = {
            exists: Boolean(outcome.found),
            locator,
            selectorUsed: outcome.selectorUsed,
            strategyUsed: outcome.strategyUsed,
            timeoutMs,
          };
          break;
        }
        case "visible": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const outcome = await this.runDomAction(
            record.view.webContents,
            this.buildInteractionScript("visible", locator, { timeoutMs }),
            "visible",
          );
          data = {
            visible: Boolean(outcome.visible),
            locator,
            selectorUsed: outcome.selectorUsed,
            strategyUsed: outcome.strategyUsed,
            timeoutMs,
          };
          break;
        }
        case "wait_for": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const locator = toLocatorFromRequest(request);
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const state = request.state ?? "visible";
          const outcome = await this.waitForLocatorState(record.view.webContents, locator, state, timeoutMs);
          data = {
            state,
            locator,
            timeoutMs,
            ...outcome,
          };
          break;
        }
        case "wait_for_navigation": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          await this.waitForNavigation(record, timeoutMs);
          data = { timeoutMs };
          break;
        }
        case "wait_for_idle": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const timeoutMs = clampTimeoutMs(request.timeoutMs);
          const idleMs = Math.max(100, Math.min(30_000, Math.floor(request.idleMs ?? DEFAULT_WAIT_FOR_IDLE_MS)));
          await this.waitForIdle(record, idleMs, timeoutMs);
          data = { idleMs, timeoutMs };
          break;
        }
        case "screenshot": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          const image = await record.view.webContents.capturePage(toRectFromBounds(request.bounds));
          const format = request.format === "jpeg" ? "jpeg" : "png";
          const mime = format === "jpeg" ? "image/jpeg" : "image/png";
          const buffer = format === "jpeg" ? image.toJPEG(clampJpegQuality(request.quality)) : image.toPNG();
          const workspace = typeof request.workspace === "string" && request.workspace.trim().length > 0
            ? request.workspace
            : "global";
          const sessionID = typeof request.sessionID === "string" && request.sessionID.trim().length > 0
            ? request.sessionID
            : "browser";
          const tabUrl = record.view.webContents.getURL();
          const tabTitle = this.titleForRecord(record);
          const artifact = await this.artifactStore.writeImageArtifact({
            workspace,
            sessionID,
            kind: "browser.screenshot",
            mime,
            buffer,
            width: image.getSize().width,
            height: image.getSize().height,
            title: tabTitle,
            url: tabUrl,
            actionID: request.actionID,
            metadata: {
              tabID: record.id,
            },
          });
          this.emit({
            type: "artifact.created",
            payload: artifact,
          });
          data = {
            artifactID: artifact.id,
            artifactPath: artifact.artifactPath,
            fileUrl: artifact.fileUrl,
            mime: artifact.mime,
            width: artifact.width,
            height: artifact.height,
          };
          break;
        }
      }

      const success: BrowserAgentActionResult = {
        action: request.action,
        ok: true,
        state: this.getState(),
        tabID,
        data,
      };
      this.emit({
        type: "browser.agent.action",
        payload: success,
      });
      return success;
    } catch (error) {
      const failure: BrowserAgentActionResult = {
        action: request.action,
        ok: false,
        state: this.getState(),
        tabID,
        error: normalizeErrorMessage(error),
      };
      this.emit({
        type: "browser.agent.action",
        payload: failure,
      });
      return failure;
    }
  }

  private emitState() {
    this.emit({
      type: "browser.state",
      payload: this.getState(),
    });
  }

  private emit(event: OrxaEvent) {
    this.onEvent(event);
  }

  private configureSessionSecurityGuards() {
    this.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    this.browserSession.setPermissionCheckHandler(() => false);
  }

  private configureTabGuards(record: BrowserTabRecord) {
    const webContents = record.view.webContents;

    webContents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedBrowserUrl(url)) {
        return { action: "deny" };
      }
      void this.openTab(url, false).catch(() => undefined);
      return { action: "deny" };
    });

    const blockUnsafeNavigation = (event: { preventDefault: () => void }, candidateUrl: string) => {
      if (!isAllowedBrowserUrl(candidateUrl)) {
        event.preventDefault();
      }
    };

    webContents.on("will-navigate", (details) => {
      blockUnsafeNavigation(details, String(details.url));
    });
    webContents.on("will-frame-navigate", (details) => {
      blockUnsafeNavigation(details, String(details.url));
    });
    webContents.on("will-redirect", (details) => {
      blockUnsafeNavigation(details, String(details.url));
    });

    webContents.on("did-start-loading", () => {
      record.lastActivityAt = this.now();
      this.emitState();
    });
    webContents.on("did-stop-loading", () => {
      record.lastActivityAt = this.now();
      this.emitState();
    });
    webContents.on("did-fail-load", () => {
      record.lastActivityAt = this.now();
      this.emitState();
    });
    webContents.on("page-title-updated", () => {
      record.lastActivityAt = this.now();
      this.emitState();
    });

    const onDidNavigate = (_event: unknown, candidateUrl: string) => {
      const normalized = String(candidateUrl);
      if (!isAllowedBrowserUrl(normalized) || normalized === DEFAULT_NEW_TAB_URL) {
        record.lastActivityAt = this.now();
        this.emitState();
        return;
      }
      const now = this.now();
      record.lastNavigatedAt = now;
      record.lastActivityAt = now;
      this.recordHistoryEntry(normalized, this.titleForRecord(record));
      this.emitState();
    };

    webContents.on("did-navigate", onDidNavigate);
    webContents.on("did-navigate-in-page", onDidNavigate);

    webContents.on("destroyed", () => {
      if (!this.tabs.has(record.id)) {
        return;
      }
      this.removeTabRecord(record.id, false);
      this.emitState();
    });
  }

  private snapshotTab(record: BrowserTabRecord): BrowserTab {
    const webContents = record.view.webContents;
    const url = webContents.getURL();

    return {
      id: record.id,
      url: isAllowedBrowserUrl(url) ? url : DEFAULT_NEW_TAB_URL,
      title: this.titleForRecord(record),
      loading: webContents.isLoading(),
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      lastNavigatedAt: record.lastNavigatedAt,
    };
  }

  private titleForRecord(record: BrowserTabRecord): string {
    const title = record.view.webContents.getTitle().trim();
    if (title.length > 0) {
      return title;
    }

    const url = record.view.webContents.getURL();
    if (url.trim().length > 0) {
      return url;
    }

    return "New Tab";
  }

  private resolveTabID(tabID?: string): string | undefined {
    if (tabID) {
      if (!this.tabs.has(tabID)) {
        throw new Error("Browser tab not found");
      }
      return tabID;
    }

    return this.activeTabID;
  }

  private requireTab(tabID?: string): BrowserTabRecord {
    const resolvedTabID = this.resolveTabID(tabID);
    if (!resolvedTabID) {
      throw new Error("No browser tab is active");
    }

    const record = this.tabs.get(resolvedTabID);
    if (!record) {
      throw new Error("Browser tab not found");
    }

    return record;
  }

  private removeTabRecord(tabID: string, destroy = true) {
    const record = this.tabs.get(tabID);
    if (!record) {
      return;
    }

    if (this.attachedTabID === tabID) {
      this.detachCurrentView();
    }

    this.tabs.delete(tabID);

    if (destroy) {
      const webContents = record.view.webContents;
      if (!webContents.isDestroyed()) {
        webContents.close();
      }
    }

    if (this.activeTabID === tabID) {
      const remainingTabIDs = [...this.tabs.keys()];
      this.activeTabID = remainingTabIDs.length > 0 ? remainingTabIDs[remainingTabIDs.length - 1] : undefined;
      this.attachActiveView();
    }
  }

  private activateTab(tabID: string) {
    if (!this.tabs.has(tabID)) {
      throw new Error("Browser tab not found");
    }
    if (this.activeTabID === tabID) {
      this.attachActiveView();
      return;
    }

    this.activeTabID = tabID;
    this.attachActiveView();
  }

  private applyBoundsToActiveView() {
    if (!this.activeTabID) {
      return;
    }
    const record = this.tabs.get(this.activeTabID);
    if (!record) {
      return;
    }
    record.view.setBounds({ ...this.bounds });
  }

  private getWindowContentView() {
    if (!this.window || this.window.isDestroyed()) {
      return undefined;
    }

    const contentView = (this.window as BrowserWindow & {
      contentView?: {
        addChildView?: (view: WebContentsView) => void;
        removeChildView?: (view: WebContentsView) => void;
      };
    }).contentView;

    if (!contentView || typeof contentView.addChildView !== "function" || typeof contentView.removeChildView !== "function") {
      return undefined;
    }

    return contentView;
  }

  private detachCurrentView() {
    if (!this.attachedTabID) {
      return;
    }

    const contentView = this.getWindowContentView();
    if (!contentView) {
      this.attachedTabID = undefined;
      return;
    }

    const record = this.tabs.get(this.attachedTabID);
    if (record) {
      contentView.removeChildView(record.view);
    }

    this.attachedTabID = undefined;
  }

  private attachActiveView() {
    if (!this.visible || !this.activeTabID) {
      this.detachCurrentView();
      return;
    }

    const record = this.tabs.get(this.activeTabID);
    const contentView = this.getWindowContentView();
    if (!record || !contentView) {
      return;
    }

    if (this.attachedTabID && this.attachedTabID !== record.id) {
      const current = this.tabs.get(this.attachedTabID);
      if (current) {
        contentView.removeChildView(current.view);
      }
      this.attachedTabID = undefined;
    }

    if (this.attachedTabID !== record.id) {
      contentView.addChildView(record.view);
      this.attachedTabID = record.id;
    }

    record.view.setBounds({ ...this.bounds });
  }

  private readHistory(): BrowserHistoryItem[] {
    const value = this.historyStore.get("items", []);
    if (!Array.isArray(value)) {
      return [];
    }
    return value;
  }

  private recordHistoryEntry(url: string, title: string) {
    if (!isAllowedBrowserUrl(url) || url === DEFAULT_NEW_TAB_URL) {
      return;
    }

    const items = this.readHistory();
    const now = this.now();

    if (items.length > 0 && items[0]?.url === url) {
      const updated = {
        ...items[0],
        title,
        visitedAt: now,
      };
      const next = [updated, ...items.slice(1, this.historyLimit)];
      this.historyStore.set("items", next);
      this.emit({
        type: "browser.history.added",
        payload: updated,
      });
      return;
    }

    const entry: BrowserHistoryItem = {
      id: this.createID(),
      url,
      title,
      visitedAt: now,
    };

    const nextItems = [entry, ...items].slice(0, this.historyLimit);
    this.historyStore.set("items", nextItems);
    this.emit({
      type: "browser.history.added",
      payload: entry,
    });
  }

  private async runDomAction(
    webContents: WebContents,
    script: string,
    actionName: BrowserAgentActionRequest["action"],
  ): Promise<Record<string, unknown>> {
    const result = await webContents.executeJavaScript(script, true);
    if (!result || typeof result !== "object") {
      return {};
    }

    const payload = result as { ok?: unknown; error?: unknown } & Record<string, unknown>;
    if (payload.ok === false) {
      const details = typeof payload.error === "string" ? payload.error : "Unknown DOM action failure";
      throw new Error(`${actionName} failed: ${details}`);
    }

    return payload;
  }

  private async runDomActionWithRetry(
    webContents: WebContents,
    script: string,
    actionName: BrowserAgentActionRequest["action"],
    attempts: number,
  ): Promise<Record<string, unknown> & { attempt: number }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const outcome = await this.runDomAction(webContents, script, actionName);
        return {
          ...outcome,
          attempt,
        };
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await this.runRecoveryPlanner(webContents, attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(normalizeErrorMessage(lastError));
  }

  private async runRecoveryPlanner(webContents: WebContents, attempt: number) {
    if (webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          webContents.off("did-stop-loading", onStop);
          resolve();
        }, Math.max(800, DEFAULT_WAIT_INTERVAL_MS * 8));
        const onStop = () => {
          clearTimeout(timeout);
          webContents.off("did-stop-loading", onStop);
          resolve();
        };
        webContents.on("did-stop-loading", onStop);
      });
    }
    if (attempt <= 1) {
      await delay(DEFAULT_WAIT_INTERVAL_MS);
      return;
    }
    const step = attempt === 2 ? "dismiss_overlays" : "stabilize";
    await webContents.executeJavaScript(this.buildRecoveryScript(step), true).catch(() => undefined);
    await delay(DEFAULT_WAIT_INTERVAL_MS * attempt);
  }

  private buildRecoveryScript(step: "dismiss_overlays" | "stabilize"): string {
    return `(() => {
      const step = ${JSON.stringify(step)};
      if (step === "dismiss_overlays") {
        const selectors = [
          "[aria-modal='true'] button",
          "button[aria-label*='close' i]",
          "button[title*='close' i]",
          "button[class*='close' i]",
          "button[id*='close' i]",
          "button[name*='close' i]",
          "button[data-testid*='close' i]",
          "button[data-test*='close' i]",
          "button:where([aria-label*='accept' i], [aria-label*='agree' i], [aria-label*='consent' i])",
          "button:where([id*='accept' i], [name*='accept' i], [class*='accept' i])",
          "[role='dialog'] button",
          ".modal button",
          ".popup button",
          ".cookie button",
        ];
        let dismissed = 0;
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") continue;
            try {
              node.click();
              dismissed += 1;
              if (dismissed >= 4) break;
            } catch {
              // ignore recovery failures
            }
          }
          if (dismissed >= 4) break;
        }
        return { ok: true, step, dismissed };
      }

      try {
        window.dispatchEvent(new Event("resize"));
        window.scrollBy({ top: 0, left: 0, behavior: "auto" });
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      } catch {
        // ignore recovery failures
      }
      return { ok: true, step };
    })();`;
  }

  private buildInteractionScript(
    mode: "click" | "type" | "extract_text" | "exists" | "visible" | "inspect",
    locator: BrowserLocator,
    options: {
      text?: string;
      clear?: boolean;
      maxLength?: number;
      timeoutMs?: number;
    },
  ): string {
    return `(() => {
      const mode = ${JSON.stringify(mode)};
      const locator = ${JSON.stringify(locator)};
      const options = ${JSON.stringify(options)};

      const includeShadowDom = locator.includeShadowDom !== false;
      const exact = locator.exact === true;

      const toStringSafe = (value) => {
        if (typeof value === "string") return value;
        if (value === null || value === undefined) return "";
        return String(value);
      };

      const normalize = (value) => toStringSafe(value).replace(/\\s+/g, " ").trim();
      const normalizeMatch = (value) => normalize(value).toLowerCase();
      const cssEscape = (value) => {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          return CSS.escape(value);
        }
        return toStringSafe(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
      };
      const dedupe = (values) => {
        const out = [];
        const seen = new Set();
        for (const raw of values) {
          const value = normalize(raw);
          if (!value) continue;
          const key = value.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(value);
        }
        return out;
      };

      const textMatches = (haystack, needle) => {
        const h = normalizeMatch(haystack);
        const n = normalizeMatch(needle);
        if (!n) return false;
        return exact ? h === n : h.includes(n);
      };

      const isElementVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const collectElements = (root) => {
        const out = [];
        const visited = new Set();
        const walk = (node) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (node instanceof Element) {
            out.push(node);
            if (includeShadowDom && node.shadowRoot) {
              walk(node.shadowRoot);
            }
          }
          const children = node instanceof Document || node instanceof ShadowRoot || node instanceof Element
            ? node.children
            : undefined;
          if (children) {
            for (const child of children) {
              walk(child);
            }
          }
        };
        walk(root);
        return out;
      };

      const queryCssDeepAll = (root, selector) => {
        if (!selector) return null;
        const matches = [];
        const seen = new Set();
        const push = (element) => {
          if (!element || seen.has(element)) return;
          seen.add(element);
          matches.push(element);
        };
        if (!includeShadowDom) {
          try {
            for (const element of root.querySelectorAll(selector)) {
              push(element);
            }
            const first = root.querySelector(selector);
            if (first) {
              push(first);
            }
          } catch {
            // invalid selector
          }
          return matches;
        }
        const all = collectElements(root);
        for (const candidate of all) {
          if (candidate.matches) {
            try {
              if (candidate.matches(selector)) {
                push(candidate);
              }
            } catch {
              // invalid selector
            }
          }
        }
        return matches;
      };

      const queryByText = (root, text) => {
        if (!text) return null;
        const all = collectElements(root);
        for (const element of all) {
          const rendered = element instanceof HTMLElement ? element.innerText : element.textContent;
          if (textMatches(rendered ?? "", text)) {
            return [element];
          }
        }
        return [];
      };

      const queryByLabel = (root, labelText) => {
        if (!labelText) return null;
        const labels = root.querySelectorAll("label");
        for (const label of labels) {
          const rendered = label instanceof HTMLElement ? label.innerText : label.textContent;
          if (!textMatches(rendered ?? "", labelText)) {
            continue;
          }
          const htmlFor = label.getAttribute("for");
          if (htmlFor) {
            const byID = root.getElementById ? root.getElementById(htmlFor) : root.querySelector("#" + cssEscape(htmlFor));
            if (byID) return [byID];
          }
          const nested = label.querySelector("input, textarea, select, [contenteditable='true']");
          if (nested) return [nested];
        }
        return [];
      };

      const roleTagMatches = (element, role) => {
        const tag = element.tagName.toLowerCase();
        if (role === "button") return tag === "button";
        if (role === "link") return tag === "a";
        if (role === "textbox") return tag === "input" || tag === "textarea";
        if (role === "checkbox") return tag === "input" && element.getAttribute("type") === "checkbox";
        return false;
      };

      const queryByRole = (root, role, name) => {
        if (!role) return null;
        const all = collectElements(root);
        for (const element of all) {
          const attrRole = (element.getAttribute("role") || "").toLowerCase();
          const matchesRole = attrRole === role.toLowerCase() || roleTagMatches(element, role.toLowerCase());
          if (!matchesRole) continue;
          if (!name) return [element];
          const ariaLabel = element.getAttribute("aria-label") || "";
          const rendered = element instanceof HTMLElement ? element.innerText : element.textContent;
          const accessibleName = normalize(ariaLabel || rendered || "");
          if (textMatches(accessibleName, name)) {
            return [element];
          }
        }
        return [];
      };

      const toHintCandidates = () => {
        const explicit = dedupe([
          locator.name,
          locator.label,
          locator.text,
          locator.selector,
          ...(Array.isArray(locator.selectors) ? locator.selectors : []),
        ]);
        const hints = [];
        for (const value of explicit) {
          hints.push(value);
          const tokenized = value
            .replace(/[>+~*\\[\\]().,:#'"=]/g, " ")
            .replace(/\\s+/g, " ")
            .trim();
          if (tokenized.length > 0) {
            hints.push(tokenized);
          }
        }
        return dedupe(hints);
      };

      const buildFallbackSelectors = (hints) => {
        const candidates = [];
        for (const hint of hints) {
          const shortHint = hint.length > 80 ? hint.slice(0, 80) : hint;
          const escapedHint = cssEscape(shortHint);
          candidates.push("[data-testid='" + escapedHint + "']");
          candidates.push("[data-test='" + escapedHint + "']");
          candidates.push("[data-qa='" + escapedHint + "']");
          candidates.push("[name='" + escapedHint + "']");
          candidates.push("[id='" + escapedHint + "']");
          if (!shortHint.includes(" ")) {
            candidates.push("#" + escapedHint);
          }
          candidates.push("[aria-label*='" + escapedHint + "' i]");
          candidates.push("[title*='" + escapedHint + "' i]");
        }
        return dedupe(candidates);
      };

      const scoreElement = (element, hints) => {
        if (!(element instanceof HTMLElement)) {
          return -1000;
        }
        let score = 0;
        if (isElementVisible(element)) {
          score += 25;
        }
        const tag = element.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable) {
          score += 12;
        }
        if (element.hasAttribute("disabled")) {
          score -= 20;
        }
        const role = normalize(element.getAttribute("role"));
        if (role === "button" || role === "link" || role === "textbox") {
          score += 8;
        }
        const rendered = normalize(element.innerText || element.textContent || "");
        const aria = normalize(element.getAttribute("aria-label"));
        const title = normalize(element.getAttribute("title"));
        const id = normalize(element.id);
        const name = normalize(element.getAttribute("name"));
        const testid = normalize(element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("data-qa"));
        for (const hint of hints) {
          const hintNorm = normalize(hint);
          if (!hintNorm) continue;
          if (textMatches(rendered, hintNorm)) score += 32;
          if (textMatches(aria, hintNorm)) score += 40;
          if (textMatches(title, hintNorm)) score += 16;
          if (textMatches(name, hintNorm)) score += 20;
          if (textMatches(testid, hintNorm)) score += 26;
          if (textMatches(id, hintNorm)) score += 14;
        }
        return score;
      };

      const chooseBestCandidate = (candidates, hints) => {
        let best = null;
        let bestScore = -10000;
        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement)) {
            continue;
          }
          const score = scoreElement(candidate, hints);
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
        return best;
      };

      const resolveRoot = () => {
        if (!locator.frameSelector) return document;
        const iframe = document.querySelector(locator.frameSelector);
        if (!(iframe instanceof HTMLIFrameElement)) return document;
        try {
          return iframe.contentDocument || document;
        } catch {
          return document;
        }
      };

      const root = resolveRoot();
      const selectors = Array.isArray(locator.selectors) ? locator.selectors.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
      if (locator.selector && !selectors.includes(locator.selector)) {
        selectors.unshift(locator.selector);
      }
      const hintCandidates = toHintCandidates();
      const fallbackSelectors = buildFallbackSelectors(hintCandidates);
      for (const fallbackSelector of fallbackSelectors) {
        if (!selectors.includes(fallbackSelector)) {
          selectors.push(fallbackSelector);
        }
      }

      const strategyList = [];
      for (const selector of selectors) {
        strategyList.push({ type: "css", value: selector });
      }
      if (locator.text) {
        strategyList.push({ type: "text", value: locator.text });
      }
      if (locator.label) {
        strategyList.push({ type: "label", value: locator.label });
      }
      if (locator.role) {
        strategyList.push({ type: "role", role: locator.role, name: locator.name });
      }

      if (strategyList.length === 0) {
        strategyList.push({ type: "css", value: "body" });
      }

      let element = null;
      let strategyUsed = null;
      for (const strategy of strategyList) {
        let matches = [];
        if (strategy.type === "css") {
          matches = queryCssDeepAll(root, strategy.value) ?? [];
        } else if (strategy.type === "text") {
          matches = queryByText(root, strategy.value) ?? [];
        } else if (strategy.type === "label") {
          matches = queryByLabel(root, strategy.value) ?? [];
        } else if (strategy.type === "role") {
          matches = queryByRole(root, strategy.role, strategy.name) ?? [];
        }
        element = chooseBestCandidate(matches, hintCandidates);
        if (element) {
          strategyUsed = strategy;
          break;
        }
      }

      if (!element && hintCandidates.length > 0) {
        const all = collectElements(root);
        element = chooseBestCandidate(all, hintCandidates);
        if (element) {
          strategyUsed = { type: "heuristic", value: hintCandidates[0] };
        }
      }

      const visible = isElementVisible(element);
      const strategyLabel = strategyUsed
        ? strategyUsed.type + ":" + (strategyUsed.value || strategyUsed.role || "")
        : undefined;

      if (mode === "inspect") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }
      if (mode === "exists") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }
      if (mode === "visible") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }

      const extractFallbackText = () => {
        const limit = typeof options.maxLength === "number" && Number.isFinite(options.maxLength) && options.maxLength > 0
          ? Math.floor(options.maxLength)
          : 200000;
        const body = document.body;
        const raw = body ? (body.innerText || body.textContent || "") : "";
        return String(raw).slice(0, limit);
      };

      if (!(element instanceof HTMLElement)) {
        if (mode === "extract_text") {
          return {
            ok: true,
            text: extractFallbackText(),
            selectorUsed: "body",
            strategyUsed: strategyLabel || "body_fallback",
            visible: true,
            fallback: true,
          };
        }
        return { ok: false, error: "selector_not_found" };
      }

      element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
      if (mode === "click") {
        if (!visible) {
          const rectHidden = element.getBoundingClientRect();
          if (rectHidden.width <= 0 || rectHidden.height <= 0) {
            return { ok: false, error: "element_not_visible" };
          }
        }
        if (element instanceof HTMLButtonElement && element.disabled) {
          return { ok: false, error: "element_disabled" };
        }
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        try {
          element.focus({ preventScroll: true });
        } catch {
          // ignore focus failures
        }
        const fireMouseEvent = (type) => {
          element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: centerX,
            clientY: centerY,
          }));
        };
        fireMouseEvent("pointerdown");
        fireMouseEvent("mousedown");
        fireMouseEvent("pointerup");
        fireMouseEvent("mouseup");
        if (typeof element.click === "function") {
          element.click();
        }
        fireMouseEvent("click");
        return {
          ok: true,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
          visible,
        };
      }

      if (mode === "type") {
        const value = toStringSafe(options.text);
        const shouldClear = options.clear !== false;
        element.focus();
        const emitInputEvents = (target) => {
          try {
            target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
          } catch {
            // InputEvent not supported in some environments
          }
          target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        };
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          if (shouldClear) {
            element.value = "";
          }
          element.value += value;
          emitInputEvents(element);
          return {
            ok: true,
            typed: value.length,
            selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
            strategyUsed: strategyLabel,
            visible,
          };
        }
        if (element.isContentEditable) {
          if (shouldClear) {
            element.textContent = "";
          }
          element.textContent = (element.textContent ?? "") + value;
          emitInputEvents(element);
          return {
            ok: true,
            typed: value.length,
            selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
            strategyUsed: strategyLabel,
            visible,
          };
        }
        return { ok: false, error: "unsupported_element" };
      }

      if (mode === "extract_text") {
        const limit = typeof options.maxLength === "number" && Number.isFinite(options.maxLength) && options.maxLength > 0
          ? Math.floor(options.maxLength)
          : 200000;
        const raw = element.innerText || element.textContent || "";
        return {
          ok: true,
          text: String(raw).slice(0, limit),
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
          visible,
        };
      }

      return { ok: false, error: "unsupported_mode" };
    })();`;
  }

  private buildPressScript(key: string): string {
    return `(() => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      const down = new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true });
      const up = new KeyboardEvent("keyup", { key: ${JSON.stringify(key)}, bubbles: true });
      target.dispatchEvent(down);
      target.dispatchEvent(up);
      if (${JSON.stringify(key)} === "Enter" && target instanceof HTMLInputElement && target.form) {
        target.form.requestSubmit();
      }
      return { ok: true };
    })();`;
  }

  private async waitForLocatorState(
    webContents: WebContents,
    locator: BrowserLocator,
    state: "attached" | "visible" | "hidden",
    timeoutMs: number,
  ) {
    const startedAt = this.now();
    let attempts = 0;
    while (this.now() - startedAt <= timeoutMs) {
      attempts += 1;
      const outcome = await this.runDomAction(
        webContents,
        this.buildInteractionScript("inspect", locator, { timeoutMs }),
        "wait_for",
      );
      const found = Boolean(outcome.found);
      const visible = Boolean(outcome.visible);
      const satisfied = state === "attached" ? found : state === "visible" ? visible : !found || !visible;
      if (satisfied) {
        return {
          found,
          visible,
          attempts,
          selectorUsed: outcome.selectorUsed,
          strategyUsed: outcome.strategyUsed,
        };
      }
      await delay(DEFAULT_WAIT_INTERVAL_MS);
    }
    throw new Error(`wait_for timed out after ${timeoutMs}ms`);
  }

  private async waitForNavigation(record: BrowserTabRecord, timeoutMs: number) {
    const webContents = record.view.webContents;
    record.lastActivityAt = this.now();

    if (webContents.isLoading()) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          webContents.off("did-stop-loading", onStop);
          reject(new Error(`Navigation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onStop = () => {
          clearTimeout(timeout);
          webContents.off("did-stop-loading", onStop);
          resolve();
        };
        webContents.on("did-stop-loading", onStop);
      });
      return;
    }

    const watchMs = Math.min(timeoutMs, 1_500);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        webContents.off("did-start-loading", onStart);
        webContents.off("did-navigate", onNavigate);
        resolve();
      }, watchMs);
      const cleanup = () => {
        clearTimeout(timeout);
        webContents.off("did-start-loading", onStart);
        webContents.off("did-navigate", onNavigate);
      };
      const onStart = () => {
        cleanup();
        this.waitForNavigation(record, timeoutMs).then(() => resolve()).catch(() => resolve());
      };
      const onNavigate = () => {
        cleanup();
        resolve();
      };
      webContents.on("did-start-loading", onStart);
      webContents.on("did-navigate", onNavigate);
    });
  }

  private async waitForIdle(record: BrowserTabRecord, idleMs: number, timeoutMs: number) {
    const startedAt = this.now();
    while (this.now() - startedAt <= timeoutMs) {
      const elapsed = this.now() - record.lastActivityAt;
      if (!record.view.webContents.isLoading() && elapsed >= idleMs) {
        return;
      }
      await delay(DEFAULT_WAIT_INTERVAL_MS);
    }
    throw new Error(`wait_for_idle timed out after ${timeoutMs}ms`);
  }

  private buildScrollScript(
    x?: number,
    y?: number,
    top?: number,
    left?: number,
    behavior?: "auto" | "smooth",
  ): string {
    return `(() => {
      const scrollBehavior = ${JSON.stringify(behavior ?? "auto")};
      const hasAbsolute = ${JSON.stringify(typeof top === "number" || typeof left === "number")};
      if (hasAbsolute) {
        window.scrollTo({
          top: ${JSON.stringify(typeof top === "number" ? top : 0)},
          left: ${JSON.stringify(typeof left === "number" ? left : 0)},
          behavior: scrollBehavior,
        });
      } else {
        window.scrollBy({
          top: ${JSON.stringify(typeof y === "number" ? y : 0)},
          left: ${JSON.stringify(typeof x === "number" ? x : 0)},
          behavior: scrollBehavior,
        });
      }
      return { ok: true };
    })();`;
  }

}

export const BROWSER_CONTROLLER_PARTITION = DEFAULT_BROWSER_PARTITION;
