import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { IPC, type AppMode, type GitCommitRequest, type OpenDirectoryTarget, type RuntimeProfileInput } from "../shared/ipc";
import { OpencodeService } from "./services/opencode-service";
import { shouldRunOrxaBootstrap } from "./services/app-mode";
import { ModeStore } from "./services/mode-store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const service = new OpencodeService();
const modeStore = new ModeStore();
let mainWindow: BrowserWindow | null = null;

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

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.mjs");

  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    backgroundColor: "#071018",
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
    const htmlPath = path.join(__dirname, "../../dist/index.html");
    void window.loadFile(htmlPath);
  }

  return window;
}

function resolveOrxaTemplateDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "orxa-template");
  }
  return path.join(process.cwd(), "assets", "orxa-template");
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
    if (mode === "orxa") {
      await service.ensureOrxaWorkspace(resolveOrxaTemplateDir());
      await service.ensureOrxaPluginRegistration();
      return modeStore.setMode(mode);
    }
    await service.removeOrxaPluginFromConfig();
    return modeStore.setMode(mode);
  });

  ipcMain.handle(IPC.runtimeGetState, async () => service.runtimeState());
  ipcMain.handle(IPC.runtimeListProfiles, async () => service.listProfiles());
  ipcMain.handle(IPC.runtimeSaveProfile, async (_event, input: RuntimeProfileInput) => service.saveProfile(input));
  ipcMain.handle(IPC.runtimeDeleteProfile, async (_event, profileID: unknown) =>
    service.deleteProfile(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeAttach, async (_event, profileID: unknown) => service.attach(assertString(profileID, "profileID")));
  ipcMain.handle(IPC.runtimeStartLocal, async (_event, profileID: unknown) =>
    service.startLocal(assertString(profileID, "profileID")),
  );
  ipcMain.handle(IPC.runtimeStopLocal, async () => service.stopLocal());

  ipcMain.handle(IPC.opencodeBootstrap, async () => service.bootstrap());
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
  ipcMain.handle(IPC.opencodeCreateSession, async (_event, directory: unknown, title?: unknown) =>
    service.createSession(assertString(directory, "directory"), typeof title === "string" ? title : undefined),
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
  ipcMain.handle(IPC.opencodeSendPrompt, async (_event, request: unknown) => {
    if (!request || typeof request !== "object") {
      throw new Error("Prompt request is required");
    }
    return service.sendPrompt(request as Parameters<typeof service.sendPrompt>[0]);
  });
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
    if (!patch || typeof patch !== "object") {
      throw new Error("Config patch is required");
    }
    return service.updateConfig(scope, patch as Parameters<typeof service.updateConfig>[1], typeof directory === "string" ? directory : undefined);
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
  ipcMain.handle(IPC.opencodeListFiles, async (_event, directory: unknown, relativePath?: unknown) =>
    service.listFiles(assertString(directory, "directory"), typeof relativePath === "string" ? relativePath : undefined),
  );
  ipcMain.handle(IPC.opencodeCountProjectFiles, async (_event, directory: unknown) =>
    service.countProjectFiles(assertString(directory, "directory")),
  );
  ipcMain.handle(IPC.opencodeReadProjectFile, async (_event, directory: unknown, relativePath: unknown) =>
    service.readProjectFile(assertString(directory, "directory"), assertString(relativePath, "relativePath")),
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

async function boot() {
  await app.whenReady();
  const startupMode = modeStore.getMode();
  if (shouldRunOrxaBootstrap(startupMode)) {
    await service.ensureOrxaWorkspace(resolveOrxaTemplateDir()).catch((error) => {
      console.error("Failed to initialize Orxa workspace:", error);
    });
    await service.ensureOrxaPluginRegistration().catch((error) => {
      console.error("Failed to register/install Orxa plugin:", error);
    });
  }
  registerIpcHandlers();

  service.onEvent = (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(IPC.events, event);
  };

  mainWindow = createWindow();

  const runtime = await service.initializeFromStoredProfile();
  if (runtime.status === "error" && runtime.lastError) {
    service.setErrorStatus(runtime.lastError);
  }

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
    void service.stopLocal();
  });
}

void boot();
