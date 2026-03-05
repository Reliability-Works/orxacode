/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC } from "../shared/ipc";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

async function loadBridge() {
  vi.resetModules();
  electronMocks.exposeInMainWorld.mockReset();
  electronMocks.invoke.mockReset();
  electronMocks.on.mockReset();
  electronMocks.removeListener.mockReset();

  await import("./preload");

  expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1);
  const call = electronMocks.exposeInMainWorld.mock.calls[0];
  expect(call?.[0]).toBe("orxa");
  return call?.[1] as {
    app: {
      openExternal: (url: string) => Promise<unknown>;
    };
    opencode: {
      getArtifactRetentionPolicy: () => Promise<unknown>;
      setArtifactRetentionPolicy: (input: unknown) => Promise<unknown>;
      pruneArtifactsNow: (workspace?: string) => Promise<unknown>;
      exportArtifactBundle: (input: unknown) => Promise<unknown>;
    };
    browser: {
      getState: () => Promise<unknown>;
      setVisible: (visible: boolean) => Promise<unknown>;
      setBounds: (bounds: unknown) => Promise<unknown>;
      openTab: (url?: string, activate?: boolean) => Promise<unknown>;
      closeTab: (tabID?: string) => Promise<unknown>;
      switchTab: (tabID: string) => Promise<unknown>;
      navigate: (url: string, tabID?: string) => Promise<unknown>;
      back: (tabID?: string) => Promise<unknown>;
      forward: (tabID?: string) => Promise<unknown>;
      reload: (tabID?: string) => Promise<unknown>;
      listHistory: (limit?: number) => Promise<unknown>;
      clearHistory: () => Promise<unknown>;
      performAgentAction: (request: unknown) => Promise<unknown>;
    };
  };
}

describe("preload browser bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires browser methods to the expected IPC channels", async () => {
    const bridge = await loadBridge();

    electronMocks.invoke.mockResolvedValue(undefined);

    await bridge.browser.getState();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserGetState);

    await bridge.browser.setVisible(true);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSetVisible, true);

    await bridge.browser.setBounds({ x: 10, y: 20, width: 800, height: 600 });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSetBounds, {
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    });

    await bridge.browser.openTab("https://example.com", false);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserOpenTab, "https://example.com", false);

    await bridge.browser.closeTab("tab-1");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserCloseTab, "tab-1");

    await bridge.browser.switchTab("tab-2");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserSwitchTab, "tab-2");

    await bridge.browser.navigate("https://example.org", "tab-2");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserNavigate, "https://example.org", "tab-2");

    await bridge.browser.back("tab-2");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserBack, "tab-2");

    await bridge.browser.forward("tab-2");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserForward, "tab-2");

    await bridge.browser.reload("tab-2");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserReload, "tab-2");

    await bridge.browser.listHistory(30);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserListHistory, 30);

    await bridge.browser.clearHistory();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserClearHistory);

    const request = { action: "extract_text", tabID: "tab-2", selector: "body" };
    await bridge.browser.performAgentAction(request);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.browserPerformAgentAction, request);
  });

  it("wires app external-open method to expected IPC channel", async () => {
    const bridge = await loadBridge();
    electronMocks.invoke.mockResolvedValue(true);

    await bridge.app.openExternal("https://example.com");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.appOpenExternal, "https://example.com");
  });

  it("wires artifact retention methods to expected IPC channels", async () => {
    const bridge = await loadBridge();
    electronMocks.invoke.mockResolvedValue(undefined);

    await bridge.opencode.getArtifactRetentionPolicy();
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsGetRetention);

    await bridge.opencode.setArtifactRetentionPolicy({ maxBytes: 1024 });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsSetRetention, { maxBytes: 1024 });

    await bridge.opencode.pruneArtifactsNow("/tmp/workspace");
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsPrune, "/tmp/workspace");

    const exportInput = { workspace: "/tmp/workspace", limit: 20 };
    await bridge.opencode.exportArtifactBundle(exportInput);
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(IPC.opencodeArtifactsExportBundle, exportInput);
  });
});
