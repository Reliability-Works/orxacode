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
import {
  buildInteractionScript,
  buildPressScript,
  buildRecoveryScript,
  buildScrollScript,
} from "./browser-dom-scripts";

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

    // Safety guard: reject bounds that would expand the browser pane to fill the
    // full window (x=0 with a non-trivial width). The browser panel is always
    // inset from the left edge of the window, so x=0 combined with a large width
    // indicates stale/erroneous bounds from before the sidebar was positioned.
    if (nextBounds.x === 0 && nextBounds.width > 0) {
      return this.getState();
    }

    if (
      this.bounds.x === nextBounds.x &&
      this.bounds.y === nextBounds.y &&
      this.bounds.width === nextBounds.width &&
      this.bounds.height === nextBounds.height
    ) {
      return this.getState();
    }
    this.bounds = nextBounds;

    // If the controller is visible but the view was previously held back because
    // bounds were invalid (x=0 / zero-sized), now that we have valid bounds we
    // need to attach+position the view, not just update its rect.
    if (this.visible) {
      this.attachActiveView();
    } else {
      this.applyBoundsToActiveView();
    }
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
    } catch {
      // If the URL fails to load (e.g. connection refused), keep the tab
      // open on about:blank instead of destroying it
      if (target !== "about:blank") {
        try {
          await record.view.webContents.loadURL("about:blank");
        } catch {
          // Silently ignore — tab remains in whatever state it's in
        }
      }
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
    if (webContents.navigationHistory?.canGoBack?.()) {
      webContents.goBack();
    }
    this.emitState();
    return this.getState();
  }

  forward(tabID?: string): BrowserState {
    const record = this.requireTab(tabID);
    const webContents = record.view.webContents;
    if (webContents.navigationHistory?.canGoForward?.()) {
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
            buildInteractionScript("click", locator, { timeoutMs }),
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
            buildInteractionScript("type", locator, {
              timeoutMs,
              text: request.text,
              clear: request.clear ?? true,
            }),
            "type",
            attempts,
          );
          if (request.submit) {
            await this.runDomAction(record.view.webContents, buildPressScript("Enter"), "press");
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
          await this.runDomAction(record.view.webContents, buildPressScript(request.key), "press");
          data = { key: request.key };
          break;
        }
        case "scroll": {
          const record = this.requireTab(request.tabID);
          tabID = record.id;
          await this.runDomAction(
            record.view.webContents,
            buildScrollScript(request.x, request.y, request.top, request.left, request.behavior),
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
            buildInteractionScript("extract_text", locator, {
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
            buildInteractionScript("exists", locator, { timeoutMs }),
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
            buildInteractionScript("visible", locator, { timeoutMs }),
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
      canGoBack: webContents.navigationHistory?.canGoBack?.() ?? false,
      canGoForward: webContents.navigationHistory?.canGoForward?.() ?? false,
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

    // Guard: if bounds are zero-sized or indicate full-window coverage (x=0 with
    // any width), the bounds are stale. Keep the view detached until valid bounds
    // are delivered via setBounds().
    const boundsAreValid =
      this.bounds.width > 0 &&
      this.bounds.height > 0 &&
      this.bounds.x > 0;
    if (!boundsAreValid) {
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
    await webContents.executeJavaScript(buildRecoveryScript(step), true).catch(() => undefined);
    await delay(DEFAULT_WAIT_INTERVAL_MS * attempt);
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
        buildInteractionScript("inspect", locator, { timeoutMs }),
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

}

export const BROWSER_CONTROLLER_PARTITION = DEFAULT_BROWSER_PARTITION;
