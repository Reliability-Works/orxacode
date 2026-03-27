import path from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { app, BrowserWindow, Menu, nativeImage, type MenuItemConstructorOptions } from "electron";
import type { OrxaEvent } from "../shared/ipc";
import { OpencodeService } from "./services/opencode-service";
import { CodexService } from "./services/codex-service";
import { ClaudeChatService } from "./services/claude-chat-service";
import { BrowserController } from "./services/browser-controller";
import { OrxaTerminalService } from "./services/orxa-terminal-service";
import { PersistenceService } from "./services/persistence-service";
import { ProviderSessionDirectory } from "./services/provider-session-directory";
import { KanbanService } from "./services/kanban-service";
import { setupAutoUpdates, type AutoUpdaterController } from "./services/auto-updater";
import { createMainWindowEventPublisher } from "./services/main-window-event-publisher";
import { registerProviderEventBridge } from "./services/provider-event-bridge";
import { createStartupBootstrapTracker } from "./services/startup-bootstrap";
import { resolveRendererHtmlPath } from "./services/renderer-entry";
import { DiagnosticsService } from "./services/diagnostics-service";
import { registerAppHandlers } from "./ipc/app-handlers";
import { registerPersistenceHandlers } from "./ipc/persistence-handlers";
import { registerUpdatesHandlers } from "./ipc/updates-handlers";
import { registerRuntimeOpencodeHandlers } from "./ipc/runtime-opencode-handlers";
import { registerArtifactHandlers } from "./ipc/artifact-handlers";
import { registerTerminalHandlers } from "./ipc/terminal-handlers";
import { registerBrowserHandlers } from "./ipc/browser-handlers";
import { registerClaudeChatHandlers } from "./ipc/claude-chat-handlers";
import { registerCodexHandlers } from "./ipc/codex-handlers";
import { registerKanbanHandlers } from "./ipc/kanban-handlers";
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
const claudeChatService = new ClaudeChatService();
const terminalService = new OrxaTerminalService();
let persistenceService: PersistenceService | null = null;
let providerSessionDirectory: ProviderSessionDirectory | null = null;
let kanbanService: KanbanService | null = null;
let mainWindow: BrowserWindow | null = null;
let browserController: BrowserController | null = null;
let autoUpdaterController: AutoUpdaterController | undefined;
let diagnosticsService: DiagnosticsService | null = null;
let resolvedCdpPort: number | null = null;
const startupBootstrap = createStartupBootstrapTracker();
const SMOKE_TEST_FLAG = "--smoke-test";
const claudeTerminalState = {
  processes: new Map<string, { directory: string }>(),
};
const eventPublisher = createMainWindowEventPublisher(() => mainWindow);

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
    backgroundColor: "#0C0C0C",
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
  const webContents = window.webContents;
  const onDidFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ) => {
    recordMainDiagnostic({
      level: "error",
      source: "main",
      category: "main.did-fail-load",
      message: `Renderer failed to load: ${errorDescription || errorCode}`,
      details: JSON.stringify({ errorCode, errorDescription, validatedURL, isMainFrame }),
    });
  };
  const onConsoleMessage = (
    _event: Electron.Event,
    level: number,
    message: string,
    line: number,
    sourceId: string,
  ) => {
    if (level < 2) {
      return;
    }
    recordMainDiagnostic({
      level: level >= 3 ? "error" : "warn",
      source: "main",
      category: "renderer.console",
      message,
      details: JSON.stringify({ level, line, sourceId }),
    });
  };
  const onRenderProcessGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
    recordMainDiagnostic({
      level: "error",
      source: "main",
      category: "main.render-process-gone",
      message: `Renderer process exited: ${details.reason}`,
      details: JSON.stringify(details),
    });
  };
  const onUnresponsive = () => {
    recordMainDiagnostic({
      level: "warn",
      source: "main",
      category: "main.window-unresponsive",
      message: "Main window became unresponsive",
    });
  };
  const onResponsive = () => {
    recordMainDiagnostic({
      level: "info",
      source: "main",
      category: "main.window-responsive",
      message: "Main window became responsive again",
    });
  };
  webContents.on("did-fail-load", onDidFailLoad);
  webContents.on("console-message", onConsoleMessage);
  webContents.on("render-process-gone", onRenderProcessGone);
  window.on("unresponsive", onUnresponsive);
  window.on("responsive", onResponsive);
  window.on("closed", () => {
    webContents.off("did-fail-load", onDidFailLoad);
    webContents.off("console-message", onConsoleMessage);
    webContents.off("render-process-gone", onRenderProcessGone);
    window.off("unresponsive", onUnresponsive);
    window.off("responsive", onResponsive);
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
  if (!persistenceService) {
    throw new Error("Persistence service not initialized");
  }
  if (!diagnosticsService) {
    throw new Error("Diagnostics service not initialized");
  }
  if (!providerSessionDirectory) {
    providerSessionDirectory = new ProviderSessionDirectory(persistenceService);
    service.setProviderSessionDirectory(providerSessionDirectory);
    codexService.setProviderSessionDirectory(providerSessionDirectory);
    claudeChatService.setProviderSessionDirectory(providerSessionDirectory);
  }
  if (!kanbanService) {
    kanbanService = new KanbanService({
      opencodeService: service,
      codexService,
      claudeChatService,
      terminalService,
    });
  }

  registerPersistenceHandlers({
    service: persistenceService,
  });

  registerAppHandlers({
    getMainWindow: () => mainWindow,
    diagnosticsService,
  });

  registerUpdatesHandlers({
    getAutoUpdaterController: () => autoUpdaterController,
  });

  registerRuntimeOpencodeHandlers({
    service,
    terminalService,
    startupBootstrap,
    getMainWindow: () => mainWindow,
    inferMimeFromPath,
  });

  registerArtifactHandlers({
    service,
  });

  registerTerminalHandlers({
    service: terminalService,
    claudeState: claudeTerminalState,
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

  registerClaudeChatHandlers({
    claudeChatService,
  });

  registerKanbanHandlers({
    kanbanService,
    getMainWindow: () => mainWindow,
  });

  registerProviderEventBridge({
    codexService,
    claudeChatService,
    publishEvent: (event) => {
      kanbanService?.handleEvent(event);
      publishEvent(event);
    },
  });
}

function publishEvent(event: OrxaEvent) {
  eventPublisher.publish(event);
}

function recordMainDiagnostic(input: Parameters<DiagnosticsService["record"]>[0]) {
  if (!diagnosticsService) {
    return;
  }
  void diagnosticsService.record(input).then((entry) => {
    publishEvent({
      type: "app.diagnostic",
      payload: entry,
    });
  });
}

async function boot() {
  await app.whenReady();
  diagnosticsService = new DiagnosticsService();
  await diagnosticsService.hydrate();
  process.on("uncaughtException", (error) => {
    recordMainDiagnostic({
      level: "error",
      source: "main",
      category: "main.uncaught-exception",
      message: error.message,
      details: error.stack,
    });
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const details = reason instanceof Error ? reason.stack : undefined;
    recordMainDiagnostic({
      level: "error",
      source: "main",
      category: "main.unhandled-rejection",
      message,
      details,
    });
  });
  app.on("child-process-gone", (_event, details) => {
    recordMainDiagnostic({
      level: details.reason === "clean-exit" ? "info" : "warn",
      source: "main",
      category: "main.child-process-gone",
      message: `Child process exited: ${details.type} (${details.reason})`,
      details: JSON.stringify(details),
    });
  });
  persistenceService = new PersistenceService();
  browserController = new BrowserController({
    onEvent: (event) => publishEvent(event),
  });
  registerIpcHandlers();

  service.onEvent = (event) => {
    kanbanService?.handleEvent(event);
    publishEvent(event);
  };
  terminalService.onEvent = (event) => publishEvent(event);
  if (kanbanService) {
    kanbanService.onEvent = (event) => publishEvent(event);
  }

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
    kanbanService?.destroy();
    kanbanService = null;
    eventPublisher.flushAll();
    void service.stopLocal();
  });
}

void boot();
