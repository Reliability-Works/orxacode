/** @vitest-environment node */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, WebContentsView } from "electron";
import type { BrowserHistoryItem, BrowserBounds, OrxaEvent } from "../../shared/ipc";

const electronMocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  getPath: vi.fn(() => "/tmp/orxa-code-test"),
}));

vi.mock("electron", () => ({
  app: {
    getPath: electronMocks.getPath,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
  WebContentsView: class {},
}));

import { BrowserController } from "./browser-controller";

class FakeWebContents extends EventEmitter {
  private url = "about:blank";

  private title = "New Tab";

  private loading = false;

  private destroyed = false;

  private history = ["about:blank"];

  private historyIndex = 0;

  private executeResults: unknown[] = [];

  private nextCapture = {
    png: Buffer.from("png-binary"),
    jpeg: Buffer.from("jpeg-binary"),
  };

  windowOpenHandler: ((details: { url: string }) => { action: "allow" | "deny" }) | undefined;

  enqueueExecuteResult(result: unknown) {
    this.executeResults.push(result);
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: "allow" | "deny" }) {
    this.windowOpenHandler = handler;
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  isLoading() {
    return this.loading;
  }

  canGoBack() {
    return this.historyIndex > 0;
  }

  canGoForward() {
    return this.historyIndex < this.history.length - 1;
  }

  async loadURL(url: string) {
    let prevented = false;
    this.emit(
      "will-navigate",
      {
        url,
        preventDefault: () => {
          prevented = true;
        },
      },
    );

    if (prevented) {
      throw new Error("Navigation blocked");
    }

    this.loading = true;
    this.emit("did-start-loading");

    this.url = url;
    this.title = url;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    this.historyIndex = this.history.length - 1;

    this.loading = false;
    this.emit("did-stop-loading");
    this.emit("did-navigate", undefined, url);
  }

  goBack() {
    if (!this.canGoBack()) {
      return;
    }
    this.historyIndex -= 1;
    this.url = this.history[this.historyIndex] ?? this.url;
    this.emit("did-navigate", undefined, this.url);
  }

  goForward() {
    if (!this.canGoForward()) {
      return;
    }
    this.historyIndex += 1;
    this.url = this.history[this.historyIndex] ?? this.url;
    this.emit("did-navigate", undefined, this.url);
  }

  reload() {
    this.emit("did-start-loading");
    this.emit("did-stop-loading");
  }

  async executeJavaScript(script: string) {
    void script;
    if (this.executeResults.length === 0) {
      return { ok: true };
    }
    return this.executeResults.shift();
  }

  async capturePage(rect?: unknown) {
    void rect;
    return {
      toPNG: () => this.nextCapture.png,
      toJPEG: (quality?: number) => {
        void quality;
        return this.nextCapture.jpeg;
      },
      getSize: () => ({ width: 1280, height: 720 }),
    };
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }

  close() {
    this.destroy();
  }
}

class FakeView {
  readonly setBounds = vi.fn();
  readonly webContents: FakeWebContents;

  constructor(webContents: FakeWebContents) {
    this.webContents = webContents;
  }
}

type SetupResult = {
  controller: BrowserController;
  created: Array<{ view: FakeView; webContents: FakeWebContents }>;
  events: OrxaEvent[];
  historyState: { items: BrowserHistoryItem[] };
  permissionRequestHandlerSpy: ReturnType<typeof vi.fn>;
  permissionCheckHandlerSpy: ReturnType<typeof vi.fn>;
  addChildViewSpy: ReturnType<typeof vi.fn>;
  removeChildViewSpy: ReturnType<typeof vi.fn>;
};

function createControllerSetup(): SetupResult {
  const created: Array<{ view: FakeView; webContents: FakeWebContents }> = [];
  const events: OrxaEvent[] = [];
  const historyState: { items: BrowserHistoryItem[] } = {
    items: [],
  };

  const permissionRequestHandlerSpy = vi.fn();
  const permissionCheckHandlerSpy = vi.fn();
  const addChildViewSpy = vi.fn();
  const removeChildViewSpy = vi.fn();

  electronMocks.fromPartition.mockReturnValue({
    setPermissionRequestHandler: permissionRequestHandlerSpy,
    setPermissionCheckHandler: permissionCheckHandlerSpy,
  });

  const controller = new BrowserController({
    onEvent: (event) => {
      events.push(event);
    },
    historyStore: {
      get: (_key, fallback) => (historyState.items.length === 0 ? fallback : [...historyState.items]),
      set: (_key, value) => {
        historyState.items = [...value];
      },
    },
    createView: () => {
      const webContents = new FakeWebContents();
      const view = new FakeView(webContents);
      created.push({ view, webContents });
      return view as unknown as WebContentsView;
    },
    createID: (() => {
      let counter = 0;
      return () => {
        counter += 1;
        return `tab-${counter}`;
      };
    })(),
    now: (() => {
      let ts = 1_000;
      return () => {
        ts += 1;
        return ts;
      };
    })(),
  });

  const fakeWindow = {
    contentView: {
      addChildView: addChildViewSpy,
      removeChildView: removeChildViewSpy,
    },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    isDestroyed: () => false,
  } as unknown as BrowserWindow;

  controller.setWindow(fakeWindow);

  return {
    controller,
    created,
    events,
    historyState,
    permissionRequestHandlerSpy,
    permissionCheckHandlerSpy,
    addChildViewSpy,
    removeChildViewSpy,
  };
}

describe("BrowserController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("manages tab lifecycle, bounds, and history persistence", async () => {
    const setup = createControllerSetup();

    await setup.controller.openTab("https://example.com");
    await setup.controller.openTab("https://example.org");
    expect(setup.addChildViewSpy).not.toHaveBeenCalled();

    // setVisible(true) with zero/invalid bounds should NOT attach the view yet —
    // it waits for valid bounds via setBounds() to avoid full-window coverage.
    setup.controller.setVisible(true);
    expect(setup.addChildViewSpy).not.toHaveBeenCalled();

    let state = setup.controller.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabID).toBe(state.tabs[1]?.id);

    setup.controller.switchTab("tab-1");
    const bounds: BrowserBounds = { x: 10, y: 20, width: 900, height: 600 };
    // Once valid bounds arrive (x > 0), the view should be attached.
    setup.controller.setBounds(bounds);
    expect(setup.addChildViewSpy).toHaveBeenCalledTimes(1);

    state = setup.controller.getState();
    expect(state.activeTabID).toBe("tab-1");
    expect(state.bounds).toEqual(bounds);
    expect(setup.created[0]?.view.setBounds).toHaveBeenCalledWith(bounds);

    expect(setup.controller.listHistory()).toHaveLength(2);
    expect(setup.historyState.items[0]?.url).toContain("https://example.org");

    setup.controller.clearHistory();
    expect(setup.controller.listHistory()).toHaveLength(0);

    setup.controller.closeTab("tab-1");
    expect(setup.controller.getState().tabs).toHaveLength(1);

    setup.controller.setVisible(false);
    expect(setup.removeChildViewSpy).toHaveBeenCalled();

    expect(setup.events.some((event) => event.type === "browser.state")).toBe(true);
    expect(setup.events.some((event) => event.type === "browser.history.added")).toBe(true);
    expect(setup.events.some((event) => event.type === "browser.history.cleared")).toBe(true);
  });

  it("creates a tab when navigating without an active tab", async () => {
    const setup = createControllerSetup();

    await setup.controller.navigate("https://first-nav.example");
    const state = setup.controller.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabID).toBe(state.tabs[0]?.id);
    expect(state.tabs[0]?.url).toBe("https://first-nav.example/");

    await expect(setup.controller.navigate("https://nope.example", "missing-tab")).rejects.toThrow("Browser tab not found");
  });

  it("allows first browser agent action to be navigate", async () => {
    const setup = createControllerSetup();

    const result = await setup.controller.performAgentAction({
      action: "navigate",
      url: "https://agent-first-nav.example",
    });

    expect(result.ok).toBe(true);
    expect(result.tabID).toBe(setup.controller.getState().activeTabID);
    expect(setup.controller.getState().tabs).toHaveLength(1);
    expect(setup.controller.getState().tabs[0]?.url).toBe("https://agent-first-nav.example/");
  });

  it("blocks dangerous schemes and defaults permissions to deny", async () => {
    const setup = createControllerSetup();

    expect(setup.permissionRequestHandlerSpy).toHaveBeenCalledTimes(1);
    expect(setup.permissionCheckHandlerSpy).toHaveBeenCalledTimes(1);

    const permissionCallback = vi.fn();
    const requestHandler = setup.permissionRequestHandlerSpy.mock.calls[0]?.[0] as
      | ((contents: unknown, permission: string, callback: (allow: boolean) => void) => void)
      | undefined;
    requestHandler?.(undefined, "media", permissionCallback);
    expect(permissionCallback).toHaveBeenCalledWith(false);

    const checkHandler = setup.permissionCheckHandlerSpy.mock.calls[0]?.[0] as (() => boolean) | undefined;
    expect(checkHandler?.()).toBe(false);

    await expect(setup.controller.openTab("file:///etc/passwd")).rejects.toThrow("URL scheme is not allowed");

    await setup.controller.openTab("https://safe.example");
    const webContents = setup.created[0]?.webContents;
    expect(webContents).toBeDefined();

    const popupDecision = webContents?.windowOpenHandler?.({ url: "javascript:alert(1)" });
    expect(popupDecision).toEqual({ action: "deny" });

    const preventDefault = vi.fn();
    webContents?.emit("will-navigate", { url: "javascript:alert(1)", preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("performs browser agent actions and returns structured results", async () => {
    const setup = createControllerSetup();
    await setup.controller.openTab("https://actions.example");

    const activeTabID = setup.controller.getState().activeTabID;
    expect(activeTabID).toBeDefined();

    const webContents = setup.created[0]?.webContents;
    expect(webContents).toBeDefined();

    webContents?.enqueueExecuteResult({ ok: true });
    const clickResult = await setup.controller.performAgentAction({
      action: "click",
      tabID: activeTabID,
      selector: "#cta",
    });
    expect(clickResult.ok).toBe(true);

    webContents?.enqueueExecuteResult({ ok: true });
    const typeResult = await setup.controller.performAgentAction({
      action: "type",
      tabID: activeTabID,
      selector: "input[name='email']",
      text: "user@example.com",
      submit: true,
    });
    expect(typeResult.ok).toBe(true);

    webContents?.enqueueExecuteResult({ ok: true, text: "Page body text" });
    const extractResult = await setup.controller.performAgentAction({
      action: "extract_text",
      tabID: activeTabID,
      selector: "body",
    });
    expect(extractResult.ok).toBe(true);
    expect(extractResult.data?.text).toBe("Page body text");

    const screenshotResult = await setup.controller.performAgentAction({
      action: "screenshot",
      tabID: activeTabID,
      format: "jpeg",
      quality: 70,
    });
    expect(screenshotResult.ok).toBe(true);
    expect(screenshotResult.data?.mime).toBe("image/jpeg");
    expect(typeof screenshotResult.data?.artifactID).toBe("string");
    expect(String(screenshotResult.data?.fileUrl ?? "")).toContain("file://");

    webContents?.enqueueExecuteResult({ ok: false, error: "selector_not_found" });
    const failedResult = await setup.controller.performAgentAction({
      action: "click",
      tabID: activeTabID,
      selector: "#missing",
      maxAttempts: 1,
    });
    expect(failedResult.ok).toBe(false);
    expect(failedResult.error).toContain("selector_not_found");

    const actionEvents = setup.events.filter((event) => event.type === "browser.agent.action");
    expect(actionEvents.length).toBeGreaterThanOrEqual(5);
  });
});
