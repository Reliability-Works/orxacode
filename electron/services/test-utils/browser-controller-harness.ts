import { EventEmitter } from "node:events";
import { vi } from "vitest";
import type { BrowserWindow, WebContentsView } from "electron";
import type { BrowserHistoryItem, OrxaEvent } from "../../../shared/ipc";
import { BrowserController } from "../browser-controller";

export class FakeWebContents extends EventEmitter {
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

export class FakeView {
  readonly setBounds = vi.fn();

  readonly webContents: FakeWebContents;

  constructor(webContents: FakeWebContents) {
    this.webContents = webContents;
  }
}

export type BrowserControllerSetup = {
  controller: BrowserController;
  created: Array<{ view: FakeView; webContents: FakeWebContents }>;
  events: OrxaEvent[];
  historyState: { items: BrowserHistoryItem[] };
  permissionRequestHandlerSpy: ReturnType<typeof vi.fn>;
  permissionCheckHandlerSpy: ReturnType<typeof vi.fn>;
  addChildViewSpy: ReturnType<typeof vi.fn>;
  removeChildViewSpy: ReturnType<typeof vi.fn>;
};

type SetupOptions = {
  fromPartitionMock: ReturnType<typeof vi.fn>;
};

export function createBrowserControllerSetup({ fromPartitionMock }: SetupOptions): BrowserControllerSetup {
  const created: Array<{ view: FakeView; webContents: FakeWebContents }> = [];
  const events: OrxaEvent[] = [];
  const historyState: { items: BrowserHistoryItem[] } = {
    items: [],
  };

  const permissionRequestHandlerSpy = vi.fn();
  const permissionCheckHandlerSpy = vi.fn();
  const addChildViewSpy = vi.fn();
  const removeChildViewSpy = vi.fn();

  fromPartitionMock.mockReturnValue({
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
