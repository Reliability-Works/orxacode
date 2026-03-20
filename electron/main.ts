import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { execSync, type ChildProcess } from "node:child_process";
import { app, BrowserWindow, Menu, nativeImage, type MenuItemConstructorOptions } from "electron";
import { IPC, type OrxaEvent } from "../shared/ipc";
import { OpencodeService } from "./services/opencode-service";
import { CodexService } from "./services/codex-service";
import { trackCodexTokenUsage, trackCodexThread, initCodexUsageTracking } from "./services/usage-stats-service";
import { BrowserController } from "./services/browser-controller";
import { setupAutoUpdates, type AutoUpdaterController } from "./services/auto-updater";
import { createStartupBootstrapTracker } from "./services/startup-bootstrap";
import { resolveRendererHtmlPath } from "./services/renderer-entry";
import { registerAppHandlers } from "./ipc/app-handlers";
import { registerUpdatesHandlers } from "./ipc/updates-handlers";
import { registerRuntimeOpencodeHandlers } from "./ipc/runtime-opencode-handlers";
import { registerMemoryArtifactHandlers } from "./ipc/memory-artifact-handlers";
import { registerTerminalHandlers } from "./ipc/terminal-handlers";
import { registerBrowserHandlers } from "./ipc/browser-handlers";
import { registerCodexHandlers } from "./ipc/codex-handlers";
import { createAssertBrowserSender } from "./ipc/validators";

// Fix PATH on macOS — Electron doesn't inherit the user's shell PATH
if (process.platform === "darwin") {
  const shellPath = process.env.SHELL ?? "/bin/zsh";
  try {
    const stdout = execSync(`${shellPath} -ilc 'echo $PATH'`, { encoding: "utf8", timeout: 5000 });
    process.env.PATH = stdout.trim() || process.env.PATH;
  } catch {
    // If shell PATH extraction fails, append common paths
    const extraPaths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      `${process.env.HOME}/.nvm/versions/node/current/bin`,
      `${process.env.HOME}/.volta/bin`,
    ].join(":");
    process.env.PATH = `${process.env.PATH}:${extraPaths}`;
  }
}

// Enable CDP remote debugging so that chrome-devtools-mcp can connect
// to our Electron browser views. Use a fixed port to make discovery reliable.
app.commandLine.appendSwitch("remote-debugging-port", "9222");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const service = new OpencodeService();
const codexService = new CodexService();
let mainWindow: BrowserWindow | null = null;
let browserController: BrowserController | null = null;
let autoUpdaterController: AutoUpdaterController | undefined;
let resolvedCdpPort: number | null = null;
const startupBootstrap = createStartupBootstrapTracker();
const PTY_OUTPUT_FLUSH_MS = 16;
const SMOKE_TEST_FLAG = "--smoke-test";
const ptyOutputBuffer = new Map<string, { directory: string; ptyID: string; chunks: string[] }>();
const ptyOutputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const claudeTerminalState = {
  nextId: 0,
  processes: new Map<string, { proc: ChildProcess; directory: string }>(),
};

async function resolveCdpPort(): Promise<number> {
  if (resolvedCdpPort !== null) {
    return resolvedCdpPort;
  }

  // Try the configured port (9222) and nearby ports in case of conflict
  for (const port of [9222, 9223, 9224, 9225, 9226]) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        console.log(`[MCP DevTools] Found CDP endpoint on port ${port}`);
        resolvedCdpPort = port;
        return port;
      }
    } catch {
      continue;
    }
  }

  throw new Error("Could not resolve CDP debugging port. The app may need to be restarted for the debugging port to take effect.");
}

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.mjs");

  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    // Match renderer base tone to avoid a blue flash before first paint.
    backgroundColor: "#121316",
    title: "",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Prevent renderer-triggered popups from auto-launching external browsers.
  // Explicit user-triggered opens are handled via validated IPC.
  window.webContents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    const htmlPath = resolveRendererHtmlPath(__dirname);
    void window.loadFile(htmlPath);
  }

  return window;
}

function attachMainWindow(window: BrowserWindow) {
  mainWindow = window;
  browserController?.setWindow(window);
  window.on("closed", () => {
    if (mainWindow === window) {
      browserController?.setWindow(null);
      mainWindow = null;
    }
  });
  return window;
}

function buildAppMenuTemplate(): MenuItemConstructorOptions[] {
  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: "Check for updates",
        click: () => {
          void autoUpdaterController?.checkNow();
        },
      },
    ],
  };

  if (process.platform === "darwin") {
    return [
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      helpMenu,
    ];
  }

  return [{ role: "fileMenu" }, { role: "viewMenu" }, { role: "windowMenu" }, helpMenu];
}

function setupApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate()));
}


async function configureMacAppIdentity() {
  if (process.platform !== "darwin") {
    return;
  }

  app.setName("Orxa Code");

  const dockIconPath = path.join(process.cwd(), "build", "icon.png");
  try {
    await access(dockIconPath);
  } catch {
    return;
  }

  setTimeout(() => {
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }, 0);
}

function inferMimeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".bmp") {
    return "image/bmp";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "image/png";
}

function registerIpcHandlers() {
  registerAppHandlers({
    getMainWindow: () => mainWindow,
  });

  registerUpdatesHandlers({
    getAutoUpdaterController: () => autoUpdaterController,
  });

  registerRuntimeOpencodeHandlers({
    service,
    startupBootstrap,
    getMainWindow: () => mainWindow,
    inferMimeFromPath,
  });

  registerMemoryArtifactHandlers({
    service,
  });

  registerTerminalHandlers({
    service,
    claudeState: claudeTerminalState,
    publishEvent,
  });

  registerBrowserHandlers({
    service,
    getBrowserController: () => browserController,
    assertBrowserSender: createAssertBrowserSender(() => mainWindow),
    resolveCdpPort,
    publishEvent,
  });

  registerCodexHandlers({
    codexService,
  });

  codexService.on("state", (payload: unknown) => {
    publishEvent({ type: "codex.state", payload } as OrxaEvent);
  });

  codexService.on("notification", (payload: unknown) => {
    publishEvent({ type: "codex.notification", payload } as OrxaEvent);
    const notification = payload as { method?: string; params?: Record<string, unknown> } | undefined;
    if (notification?.method === "thread/tokenUsage/updated" && notification.params) {
      trackCodexTokenUsage(notification.params);
    }
    if (notification?.method === "thread/started") {
      trackCodexThread();
    }
  });

  codexService.on("approval", (payload: unknown) => {
    publishEvent({ type: "codex.approval", payload } as OrxaEvent);
  });

  codexService.on("userInput", (payload: unknown) => {
    publishEvent({ type: "codex.userInput", payload } as OrxaEvent);
  });
}

function flushBufferedPtyOutput(key: string) {
  const timer = ptyOutputFlushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    ptyOutputFlushTimers.delete(key);
  }
  const pending = ptyOutputBuffer.get(key);
  if (!pending) {
    return;
  }
  ptyOutputBuffer.delete(key);
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(IPC.events, {
    type: "pty.output",
    payload: {
      directory: pending.directory,
      ptyID: pending.ptyID,
      chunk: pending.chunks.join(""),
    },
  } satisfies OrxaEvent);
}

function flushAllPtyOutput() {
  const keys = [...ptyOutputBuffer.keys()];
  for (const key of keys) {
    flushBufferedPtyOutput(key);
  }
}

function publishEvent(event: OrxaEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (event.type !== "pty.output") {
    mainWindow.webContents.send(IPC.events, event);
    return;
  }

  const key = `${event.payload.directory}::${event.payload.ptyID}`;
  const existing = ptyOutputBuffer.get(key);
  if (existing) {
    existing.chunks.push(event.payload.chunk);
  } else {
    ptyOutputBuffer.set(key, {
      directory: event.payload.directory,
      ptyID: event.payload.ptyID,
      chunks: [event.payload.chunk],
    });
  }

  if (!ptyOutputFlushTimers.has(key)) {
    const timer = setTimeout(() => {
      flushBufferedPtyOutput(key);
    }, PTY_OUTPUT_FLUSH_MS);
    ptyOutputFlushTimers.set(key, timer);
  }
}

async function boot() {
  await app.whenReady();
  browserController = new BrowserController({
    onEvent: (event) => publishEvent(event),
  });
  registerIpcHandlers();
  void initCodexUsageTracking();

  service.onEvent = (event) => publishEvent(event);

  if (process.argv.includes(SMOKE_TEST_FLAG) || process.env.ORXA_SMOKE_TEST === "1") {
    setTimeout(() => {
      app.quit();
    }, 300);
    return;
  }

  attachMainWindow(createWindow());
  void configureMacAppIdentity();
  autoUpdaterController = setupAutoUpdates(
    () => mainWindow,
    (payload) =>
      publishEvent({
        type: "updater.telemetry",
        payload,
      }),
  );
  setupApplicationMenu();

  void service.initializeFromStoredProfile().then((runtime) => {
    if (runtime.status === "error" && runtime.lastError) {
      service.setErrorStatus(runtime.lastError);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachMainWindow(createWindow());
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    autoUpdaterController?.cleanup();
    browserController?.dispose();
    browserController = null;
    flushAllPtyOutput();
    void service.stopLocal();
  });
}

void boot();
