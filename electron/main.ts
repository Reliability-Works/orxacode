import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type MenuItemConstructorOptions } from "electron";
import {
  IPC,
  type AppMode,
  type GitCommitRequest,
  type MemoryGraphQuery,
  type MemorySettingsUpdateInput,
  type OpenDirectoryTarget,
  type OrxaEvent,
  type UpdatePreferences,
  type RuntimeProfileInput,
} from "../shared/ipc";
import { OpencodeService } from "./services/opencode-service";
import { shouldRunOrxaBootstrap } from "./services/app-mode";
import { ModeStore } from "./services/mode-store";
import { setupAutoUpdates, type AutoUpdaterController } from "./services/auto-updater";
import { createStartupBootstrapTracker } from "./services/startup-bootstrap";
import { resolveRendererHtmlPath } from "./services/renderer-entry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const service = new OpencodeService();
const modeStore = new ModeStore();
let mainWindow: BrowserWindow | null = null;
let autoUpdaterController: AutoUpdaterController | undefined;
const startupBootstrap = createStartupBootstrapTracker();
const PTY_OUTPUT_FLUSH_MS = 16;
const SMOKE_TEST_FLAG = "--smoke-test";
const ptyOutputBuffer = new Map<string, { directory: string; ptyID: string; chunks: string[] }>();
const ptyOutputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function assertOpenDirectoryTarget(value: unknown): OpenDirectoryTarget {
  const allowed: OpenDirectoryTarget[] = ["cursor", "antigravity", "finder", "terminal", "ghostty", "xcode", "zed"];
  if (typeof value !== "string" || !allowed.includes(value as OpenDirectoryTarget)) {
    throw new Error("Invalid open target");
  }
  return value as OpenDirectoryTarget;
}

function assertAppMode(value: unknown): AppMode {
  if (value !== "orxa" && value !== "standard") {
    throw new Error("Invalid app mode");
  }
  return value;
}

function assertUpdatePreferencesInput(input: unknown): Partial<UpdatePreferences> {
  if (!input || typeof input !== "object") {
    throw new Error("Update preferences input is required");
  }

  const payload = input as Partial<UpdatePreferences>;
  const result: Partial<UpdatePreferences> = {};

  if (payload.autoCheckEnabled !== undefined) {
    if (typeof payload.autoCheckEnabled !== "boolean") {
      throw new Error("autoCheckEnabled must be a boolean");
    }
    result.autoCheckEnabled = payload.autoCheckEnabled;
  }

  if (payload.releaseChannel !== undefined) {
    if (payload.releaseChannel !== "stable" && payload.releaseChannel !== "prerelease") {
      throw new Error("Invalid release channel");
    }
    result.releaseChannel = payload.releaseChannel;
  }

  return result;
}

function assertPort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${field} must be an integer between 1 and 65535`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string, maxItems = 32): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > maxItems) {
    throw new Error(`${field} exceeds maximum item count (${maxItems})`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${field}[${index}] must be a non-empty string`);
    }
    if (item.length > 2048) {
      throw new Error(`${field}[${index}] is too long`);
    }
    return item;
  });
}

function assertRuntimeProfileInput(value: unknown): RuntimeProfileInput {
  if (!value || typeof value !== "object") {
    throw new Error("Runtime profile payload is required");
  }
  const payload = value as Partial<RuntimeProfileInput>;
  return {
    id: typeof payload.id === "string" ? payload.id : undefined,
    name: assertString(payload.name, "name"),
    host: assertString(payload.host, "host"),
    port: assertPort(payload.port, "port"),
    https: assertBoolean(payload.https, "https"),
    username: typeof payload.username === "string" ? payload.username : undefined,
    password: typeof payload.password === "string" ? payload.password : undefined,
    startCommand: assertBoolean(payload.startCommand, "startCommand"),
    startHost: assertString(payload.startHost, "startHost"),
    startPort: assertPort(payload.startPort, "startPort"),
    cliPath: typeof payload.cliPath === "string" ? payload.cliPath : undefined,
    corsOrigins: assertStringArray(payload.corsOrigins, "corsOrigins", 64),
  };
}

function assertSafeJsonValue(value: unknown, field: string, depth = 0): unknown {
  if (depth > 24) {
    throw new Error(`${field} exceeds max nesting depth`);
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_500) {
      throw new Error(`${field} exceeds max array length`);
    }
    return value.map((item, index) => assertSafeJsonValue(item, `${field}[${index}]`, depth + 1));
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error(`${field} must be a plain object`);
    }
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error(`${field} contains restricted key ${key}`);
      }
      next[key] = assertSafeJsonValue(nested, `${field}.${key}`, depth + 1);
    }
    return next;
  }
  throw new Error(`${field} contains unsupported value type`);
}

function assertConfigPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Config patch must be an object");
  }
  return assertSafeJsonValue(value, "patch") as Parameters<typeof service.updateConfig>[1];
}

function assertPromptRequestInput(value: unknown): Parameters<typeof service.sendPrompt>[0] {
  if (!value || typeof value !== "object") {
    throw new Error("Prompt request is required");
  }

  const payload = value as {
    directory?: unknown;
    sessionID?: unknown;
    text?: unknown;
    attachments?: unknown;
    agent?: unknown;
    model?: unknown;
    variant?: unknown;
    system?: unknown;
  };

  const text = assertString(payload.text, "text");
  if (text.length > 64_000) {
    throw new Error("text exceeds maximum length");
  }

  const result: Parameters<typeof service.sendPrompt>[0] = {
    directory: assertString(payload.directory, "directory"),
    sessionID: assertString(payload.sessionID, "sessionID"),
    text,
  };

  if (payload.attachments !== undefined) {
    if (!Array.isArray(payload.attachments) || payload.attachments.length > 24) {
      throw new Error("attachments must be an array with at most 24 items");
    }
    result.attachments = payload.attachments.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`attachments[${index}] must be an object`);
      }
      const item = entry as { url?: unknown; mime?: unknown; filename?: unknown };
      const url = assertString(item.url, `attachments[${index}].url`);
      const mime = assertString(item.mime, `attachments[${index}].mime`);
      if (url.length > 4096) {
        throw new Error(`attachments[${index}].url is too long`);
      }
      if (mime.length > 256) {
        throw new Error(`attachments[${index}].mime is too long`);
      }
      const attachment: { url: string; mime: string; filename?: string } = { url, mime };
      if (item.filename !== undefined) {
        if (typeof item.filename !== "string" || item.filename.length > 256) {
          throw new Error(`attachments[${index}].filename must be a string (max 256 chars)`);
        }
        attachment.filename = item.filename;
      }
      return attachment;
    });
  }

  if (payload.agent !== undefined) {
    if (typeof payload.agent !== "string" || payload.agent.length > 128) {
      throw new Error("agent must be a string with max length 128");
    }
    result.agent = payload.agent;
  }

  if (payload.model !== undefined) {
    if (!payload.model || typeof payload.model !== "object") {
      throw new Error("model must be an object");
    }
    const model = payload.model as { providerID?: unknown; modelID?: unknown };
    result.model = {
      providerID: assertString(model.providerID, "model.providerID"),
      modelID: assertString(model.modelID, "model.modelID"),
    };
  }

  if (payload.variant !== undefined) {
    if (typeof payload.variant !== "string" || payload.variant.length > 128) {
      throw new Error("variant must be a string with max length 128");
    }
    result.variant = payload.variant;
  }

  if (payload.system !== undefined) {
    if (typeof payload.system !== "string" || payload.system.length > 32_000) {
      throw new Error("system must be a string with max length 32000");
    }
    result.system = payload.system;
  }

  return result;
}

function assertMemoryPolicyPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory policy patch must be an object");
  }
  const payload = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (payload.enabled !== undefined) {
    if (typeof payload.enabled !== "boolean") {
      throw new Error("memory policy enabled must be a boolean");
    }
    out.enabled = payload.enabled;
  }
  if (payload.mode !== undefined) {
    if (typeof payload.mode !== "string") {
      throw new Error("memory policy mode must be a string");
    }
    out.mode = payload.mode;
  }
  if (payload.guidance !== undefined) {
    if (typeof payload.guidance !== "string" || payload.guidance.length > 4_000) {
      throw new Error("memory policy guidance must be a string (max 4000 chars)");
    }
    out.guidance = payload.guidance;
  }
  if (payload.maxPromptMemories !== undefined) {
    if (typeof payload.maxPromptMemories !== "number" || !Number.isFinite(payload.maxPromptMemories)) {
      throw new Error("memory policy maxPromptMemories must be a number");
    }
    out.maxPromptMemories = payload.maxPromptMemories;
  }
  if (payload.maxCapturePerSession !== undefined) {
    if (typeof payload.maxCapturePerSession !== "number" || !Number.isFinite(payload.maxCapturePerSession)) {
      throw new Error("memory policy maxCapturePerSession must be a number");
    }
    out.maxCapturePerSession = payload.maxCapturePerSession;
  }
  return out;
}

function assertMemorySettingsUpdateInput(value: unknown): MemorySettingsUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory settings update payload is required");
  }
  const payload = value as Record<string, unknown>;
  const output: MemorySettingsUpdateInput = {};
  if (payload.directory !== undefined) {
    output.directory = assertString(payload.directory, "directory");
  }
  if (payload.global !== undefined) {
    output.global = assertMemoryPolicyPatch(payload.global) as MemorySettingsUpdateInput["global"];
  }
  if (payload.workspace !== undefined) {
    output.workspace = assertMemoryPolicyPatch(payload.workspace) as MemorySettingsUpdateInput["workspace"];
  }
  if (payload.clearWorkspaceOverride !== undefined) {
    output.clearWorkspaceOverride = assertBoolean(payload.clearWorkspaceOverride, "clearWorkspaceOverride");
  }
  return output;
}

function assertMemoryGraphQuery(value: unknown): MemoryGraphQuery {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Memory graph query must be an object");
  }
  const payload = value as Record<string, unknown>;
  const output: MemoryGraphQuery = {};
  if (payload.workspace !== undefined) {
    output.workspace = assertString(payload.workspace, "workspace");
  }
  if (payload.query !== undefined) {
    if (typeof payload.query !== "string" || payload.query.length > 512) {
      throw new Error("query must be a string with max length 512");
    }
    output.query = payload.query;
  }
  if (payload.relation !== undefined) {
    if (typeof payload.relation !== "string" || payload.relation.length > 64) {
      throw new Error("relation must be a string with max length 64");
    }
    output.relation = payload.relation;
  }
  if (payload.limit !== undefined) {
    if (typeof payload.limit !== "number" || !Number.isFinite(payload.limit)) {
      throw new Error("limit must be a number");
    }
    output.limit = payload.limit;
  }
  return output;
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
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
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

function resolveOrxaTemplateDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "orxa-template");
  }
  return path.join(process.cwd(), "assets", "orxa-template");
}

async function configureMacAppIdentity() {
  if (process.platform !== "darwin") {
    return;
  }

  app.setName("Opencode Orxa");

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
  ipcMain.handle(IPC.modeGet, async () => modeStore.getMode());
  ipcMain.handle(IPC.modeSet, async (_event, modeInput: unknown) => {
    const mode = assertAppMode(modeInput);
    const currentMode = modeStore.getMode();
    if (mode === currentMode) {
      return currentMode;
    }
    if (mode === "orxa") {
      await service.ensureOrxaWorkspace(resolveOrxaTemplateDir());
      await service.ensureOrxaPluginRegistration();
      return modeStore.setMode(mode);
    }
    startupBootstrap.clear();
    await service.removeOrxaPluginFromConfig();
    return modeStore.setMode(mode);
  });
  ipcMain.handle(IPC.updatesGetPreferences, async () =>
    autoUpdaterController?.getPreferences() ?? { autoCheckEnabled: true, releaseChannel: "stable" },
  );
  ipcMain.handle(IPC.updatesSetPreferences, async (_event, input: unknown) => {
    if (!autoUpdaterController) {
      throw new Error("Updater controller not available");
    }
    return autoUpdaterController.setPreferences(assertUpdatePreferencesInput(input));
  });
  ipcMain.handle(IPC.updatesCheckNow, async () => {
    if (!autoUpdaterController) {
      return {
        ok: true,
        status: "skipped",
        message: "Updater not initialized",
      };
    }
    return autoUpdaterController.checkNow();
  });

  ipcMain.handle(IPC.runtimeGetState, async () => service.runtimeState());
  ipcMain.handle(IPC.runtimeListProfiles, async () => service.listProfiles());
  ipcMain.handle(IPC.runtimeSaveProfile, async (_event, input: unknown) => service.saveProfile(assertRuntimeProfileInput(input)));
  ipcMain.handle(IPC.runtimeDeleteProfile, async (_event, profileID: unknown) =>
    service.deleteProfile(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeAttach, async (_event, profileID: unknown) => service.attach(assertString(profileID, "profileID")));
  ipcMain.handle(IPC.runtimeStartLocal, async (_event, profileID: unknown) =>
    service.startLocal(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeStopLocal, async () => service.stopLocal());

  ipcMain.handle(IPC.opencodeBootstrap, async () => {
    await startupBootstrap.wait();
    return service.bootstrap();
  });
  ipcMain.handle(IPC.opencodeCheckDependencies, async () => service.checkRuntimeDependencies());
  ipcMain.handle(IPC.opencodeAddProjectDirectory, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Add Project Folder",
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return service.addProjectDirectory(result.filePaths[0]!);
  });
  ipcMain.handle(IPC.opencodeRemoveProjectDirectory, async (_event, directory: unknown) =>
    service.removeProjectDirectory(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeSelectProject, async (_event, directory: unknown) =>
    service.selectProject(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeRefreshProject, async (_event, directory: unknown) =>
    service.refreshProject(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeCreateSession, async (_event, directory: unknown, title?: unknown, permissionMode?: unknown) =>
    service.createSession(
      assertString(directory, "directory"),
      typeof title === "string" ? title : undefined,
      permissionMode === "ask-write" || permissionMode === "yolo-write" ? permissionMode : undefined,
    ),
  );
  ipcMain.handle(IPC.opencodeDeleteSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.deleteSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeAbortSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.abortSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeRenameSession, async (_event, directory: unknown, sessionID: unknown, title: unknown) =>
    service.renameSession(assertString(directory, "directory"), assertString(sessionID, "sessionID"), assertString(title, "title")),
  );
  ipcMain.handle(IPC.opencodeArchiveSession, async (_event, directory: unknown, sessionID: unknown) =>
    service.archiveSession(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeCreateWorktreeSession, async (_event, directory: unknown, sessionID: unknown, name?: unknown) =>
    service.createWorktreeSession(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof name === "string" ? name : undefined,
    ),
  );
  ipcMain.handle(IPC.opencodeLoadMessages, async (_event, directory: unknown, sessionID: unknown) =>
    service.loadMessages(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeLoadExecutionLedger, async (_event, directory: unknown, sessionID: unknown, cursor?: unknown) =>
    service.loadExecutionLedger(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof cursor === "number" ? cursor : 0,
    ),
  );
  ipcMain.handle(IPC.opencodeClearExecutionLedger, async (_event, directory: unknown, sessionID: unknown) =>
    service.clearExecutionLedger(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
  );
  ipcMain.handle(IPC.opencodeLoadChangeProvenance, async (_event, directory: unknown, sessionID: unknown, cursor?: unknown) =>
    service.loadChangeProvenance(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      typeof cursor === "number" ? cursor : 0,
    ),
  );
  ipcMain.handle(IPC.opencodeGetFileProvenance, async (_event, directory: unknown, sessionID: unknown, relativePath: unknown) =>
    service.getFileProvenance(
      assertString(directory, "directory"),
      assertString(sessionID, "sessionID"),
      assertString(relativePath, "relativePath"),
    ),
  );
  ipcMain.handle(IPC.opencodeSendPrompt, async (_event, request: unknown) => service.sendPrompt(assertPromptRequestInput(request)));
  ipcMain.handle(
    IPC.opencodeReplyPermission,
    async (_event, directory: unknown, requestID: unknown, reply: unknown, message?: unknown) => {
      if (reply !== "once" && reply !== "always" && reply !== "reject") {
        throw new Error("Invalid permission reply");
      }
      return service.replyPermission(
        assertString(directory, "directory"),
        assertString(requestID, "requestID"),
        reply,
        typeof message === "string" ? message : undefined,
      );
    },
  );
  ipcMain.handle(IPC.opencodeReplyQuestion, async (_event, directory: unknown, requestID: unknown, answers: unknown) => {
    if (!Array.isArray(answers)) {
      throw new Error("answers must be an array");
    }
    return service.replyQuestion(assertString(directory, "directory"), assertString(requestID, "requestID"), answers as string[][]);
  });
  ipcMain.handle(IPC.opencodeRejectQuestion, async (_event, directory: unknown, requestID: unknown) =>
    service.rejectQuestion(assertString(directory, "directory"), assertString(requestID, "requestID")),
  );
  ipcMain.handle(IPC.opencodeGetConfig, async (_event, scope: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.getConfig(scope, typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeUpdateConfig, async (_event, scope: unknown, patch: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.updateConfig(scope, assertConfigPatch(patch), typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeReadRawConfig, async (_event, scope: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.readRawConfig(scope, typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeWriteRawConfig, async (_event, scope: unknown, content: unknown, directory?: unknown) => {
    if (scope !== "project" && scope !== "global") {
      throw new Error("Invalid config scope");
    }
    return service.writeRawConfig(scope, assertString(content, "content"), typeof directory === "string" ? directory : undefined);
  });
  ipcMain.handle(IPC.opencodeListProviders, async (_event, directory?: unknown) =>
    service.listProviders(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodePickImage, async () => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      buttonLabel: "Attach Image",
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"],
        },
      ],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    const filePath = result.filePaths[0]!;
    return {
      path: filePath,
      filename: path.basename(filePath),
      url: pathToFileURL(filePath).toString(),
      mime: inferMimeFromPath(filePath),
    };
  });
  ipcMain.handle(IPC.opencodeGitDiff, async (_event, directory: unknown) =>
    service.gitDiff(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitLog, async (_event, directory: unknown) =>
    service.gitLog(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitIssues, async (_event, directory: unknown) =>
    service.gitIssues(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitPrs, async (_event, directory: unknown) =>
    service.gitPrs(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeOpenDirectoryIn, async (_event, directory: unknown, target: unknown) =>
    service.openDirectoryIn(assertString(directory, "directory"), assertOpenDirectoryTarget(target)),
  );
  ipcMain.handle(IPC.opencodeGitCommitSummary, async (_event, directory: unknown, includeUnstaged: unknown) =>
    service.gitCommitSummary(assertString(directory, "directory"), assertBoolean(includeUnstaged, "includeUnstaged")),
  );
  ipcMain.handle(
    IPC.opencodeGitGenerateCommitMessage,
    async (_event, directory: unknown, includeUnstaged: unknown, guidancePrompt: unknown) =>
      service.gitGenerateCommitMessage(
        assertString(directory, "directory"),
        assertBoolean(includeUnstaged, "includeUnstaged"),
        assertString(guidancePrompt, "guidancePrompt"),
      ),
  );
  ipcMain.handle(IPC.opencodeGitCommit, async (_event, directory: unknown, request: unknown) => {
    if (!request || typeof request !== "object") {
      throw new Error("Commit request is required");
    }
    const input = request as Partial<GitCommitRequest>;
    if (input.nextStep !== "commit" && input.nextStep !== "commit_and_push" && input.nextStep !== "commit_and_create_pr") {
      throw new Error("Invalid commit next step");
    }
    return service.gitCommit(assertString(directory, "directory"), {
      includeUnstaged: assertBoolean(input.includeUnstaged, "includeUnstaged"),
      message: typeof input.message === "string" ? input.message : undefined,
      guidancePrompt: typeof input.guidancePrompt === "string" ? input.guidancePrompt : undefined,
      baseBranch: typeof input.baseBranch === "string" ? input.baseBranch : undefined,
      nextStep: input.nextStep,
    });
  });
  ipcMain.handle(IPC.opencodeGitBranches, async (_event, directory: unknown) =>
    service.gitBranches(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitCheckoutBranch, async (_event, directory: unknown, branch: unknown) =>
    service.gitCheckoutBranch(assertString(directory, "directory"), assertString(branch, "branch")),
  );
  ipcMain.handle(IPC.opencodeGitStageAll, async (_event, directory: unknown) =>
    service.gitStageAll(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitRestoreAllUnstaged, async (_event, directory: unknown) =>
    service.gitRestoreAllUnstaged(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeGitStagePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitStagePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeGitRestorePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitRestorePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeGitUnstagePath, async (_event, directory: unknown, filePath: unknown) =>
    service.gitUnstagePath(assertString(directory, "directory"), assertString(filePath, "filePath")),
  );
  ipcMain.handle(IPC.opencodeListSkills, async () => service.listSkills());
  ipcMain.handle(IPC.opencodeReadAgentsMd, async (_event, directory: unknown) =>
    service.readAgentsMd(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeWriteAgentsMd, async (_event, directory: unknown, content: unknown) =>
    service.writeAgentsMd(assertString(directory, "directory"), assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeReadGlobalAgentsMd, async () => service.readGlobalAgentsMd());
  ipcMain.handle(IPC.opencodeWriteGlobalAgentsMd, async (_event, content: unknown) =>
    service.writeGlobalAgentsMd(assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeListAgentFiles, async () => service.listOpenCodeAgentFiles());
  ipcMain.handle(IPC.opencodeReadAgentFile, async (_event, filename: unknown) =>
    service.readOpenCodeAgentFile(assertString(filename, "filename")),
  );
  ipcMain.handle(IPC.opencodeWriteAgentFile, async (_event, filename: unknown, content: unknown) =>
    service.writeOpenCodeAgentFile(assertString(filename, "filename"), assertString(content, "content")),
  );
  ipcMain.handle(IPC.opencodeDeleteAgentFile, async (_event, filename: unknown) =>
    service.deleteOpenCodeAgentFile(assertString(filename, "filename")),
  );
  ipcMain.handle(IPC.opencodeOpenFileIn, async (_event, filePath: unknown, target: unknown) =>
    service.openFileIn(assertString(filePath, "filePath"), assertOpenDirectoryTarget(target)),
  );
  ipcMain.handle(IPC.opencodeListFiles, async (_event, directory: unknown, relativePath?: unknown) =>
    service.listFiles(assertString(directory, "directory"), typeof relativePath === "string" ? relativePath : undefined),
  );
  ipcMain.handle(IPC.opencodeCountProjectFiles, async (_event, directory: unknown) =>
    service.countProjectFiles(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeReadProjectFile, async (_event, directory: unknown, relativePath: unknown) =>
    service.readProjectFile(assertString(directory, "directory"), assertString(relativePath, "relativePath")),
  );
  ipcMain.handle(IPC.opencodeMemoryGetSettings, async (_event, directory?: unknown) =>
    service.getMemorySettings(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryUpdateSettings, async (_event, input: unknown) =>
    service.updateMemorySettings(assertMemorySettingsUpdateInput(input)),
  );
  ipcMain.handle(IPC.opencodeMemoryListTemplates, async () => service.listMemoryTemplates());
  ipcMain.handle(IPC.opencodeMemoryApplyTemplate, async (_event, templateID: unknown, directory?: unknown, scope?: unknown) => {
    const parsedScope = scope === undefined
      ? undefined
      : scope === "global" || scope === "workspace"
        ? scope
        : (() => {
            throw new Error("Invalid memory template scope");
          })();
    return service.applyMemoryTemplate(
      assertString(templateID, "templateID"),
      typeof directory === "string" ? directory : undefined,
      parsedScope,
    );
  });
  ipcMain.handle(IPC.opencodeMemoryGetGraph, async (_event, query?: unknown) =>
    service.getMemoryGraph(assertMemoryGraphQuery(query)),
  );
  ipcMain.handle(IPC.opencodeMemoryBackfill, async (_event, directory?: unknown) =>
    service.backfillMemory(typeof directory === "string" ? directory : undefined),
  );
  ipcMain.handle(IPC.opencodeMemoryClearWorkspace, async (_event, directory: unknown) =>
    service.clearWorkspaceMemory(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.orxaReadConfig, async () => service.readOrxaConfig());
  ipcMain.handle(IPC.orxaWriteConfig, async (_event, content: unknown) => service.writeOrxaConfig(assertString(content, "content")));
  ipcMain.handle(IPC.orxaReadAgentPrompt, async (_event, agent: unknown) => {
    if (agent !== "orxa" && agent !== "plan") {
      throw new Error("Invalid Orxa agent");
    }
    return service.readOrxaAgentPrompt(agent);
  });
  ipcMain.handle(IPC.orxaListAgents, async () => service.listOrxaAgents());
  ipcMain.handle(IPC.orxaSaveAgent, async (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Agent input is required");
    }
    const payload = input as {
      name?: unknown;
      mode?: unknown;
      description?: unknown;
      model?: unknown;
      prompt?: unknown;
    };
    if (payload.mode !== "primary" && payload.mode !== "subagent" && payload.mode !== "all") {
      throw new Error("Invalid agent mode");
    }
    return service.saveOrxaAgent({
      name: assertString(payload.name, "name"),
      mode: payload.mode,
      description: typeof payload.description === "string" ? payload.description : undefined,
      model: typeof payload.model === "string" ? payload.model : undefined,
      prompt: typeof payload.prompt === "string" ? payload.prompt : undefined,
    });
  });
  ipcMain.handle(IPC.orxaGetAgentDetails, async (_event, name: unknown) => service.getOrxaAgentDetails(assertString(name, "name")));
  ipcMain.handle(IPC.orxaResetAgent, async (_event, name: unknown) => service.resetOrxaAgent(assertString(name, "name")));
  ipcMain.handle(IPC.orxaRestoreAgentHistory, async (_event, name: unknown, historyID: unknown) =>
    service.restoreOrxaAgentHistory(assertString(name, "name"), assertString(historyID, "historyID")),
  );
  ipcMain.handle(IPC.orxaGetServerDiagnostics, async () => service.getServerDiagnostics());
  ipcMain.handle(IPC.orxaRepairRuntime, async () => service.repairRuntime(resolveOrxaTemplateDir()));

  ipcMain.handle(IPC.terminalList, async (_event, directory: unknown) => service.listPtys(assertString(directory, "directory")));
  ipcMain.handle(IPC.terminalCreate, async (_event, directory: unknown, cwd?: unknown, title?: unknown) =>
    service.createPty(
      assertString(directory, "directory"),
      typeof cwd === "string" ? cwd : undefined,
      typeof title === "string" ? title : undefined,
    ),
  );
  ipcMain.handle(IPC.terminalConnect, async (_event, directory: unknown, ptyID: unknown) =>
    service.connectPty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );
  ipcMain.handle(IPC.terminalWrite, async (_event, directory: unknown, ptyID: unknown, data: unknown) =>
    service.writePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), typeof data === "string" ? data : ""),
  );
  ipcMain.handle(IPC.terminalResize, async (_event, directory: unknown, ptyID: unknown, cols: unknown, rows: unknown) => {
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("cols and rows must be numbers");
    }
    return service.resizePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), cols, rows);
  });
  ipcMain.handle(IPC.terminalClose, async (_event, directory: unknown, ptyID: unknown) =>
    service.closePty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );
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
  registerIpcHandlers();

  service.onEvent = (event) => publishEvent(event);

  if (process.argv.includes(SMOKE_TEST_FLAG) || process.env.ORXA_SMOKE_TEST === "1") {
    setTimeout(() => {
      app.quit();
    }, 300);
    return;
  }

  mainWindow = createWindow();
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

  const startupMode = modeStore.getMode();
  if (shouldRunOrxaBootstrap(startupMode)) {
    void startupBootstrap
      .start(async () => {
        await service.ensureOrxaWorkspace(resolveOrxaTemplateDir());
        await service.ensureOrxaPluginRegistration();
      })
      .catch((error) => {
        console.error("Failed to initialize Orxa workspace/plugin:", error);
      });
  }

  void service.initializeFromStoredProfile().then((runtime) => {
    if (runtime.status === "error" && runtime.lastError) {
      service.setErrorStatus(runtime.lastError);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    autoUpdaterController?.cleanup();
    flushAllPtyOutput();
    void service.stopLocal();
  });
}

void boot();
