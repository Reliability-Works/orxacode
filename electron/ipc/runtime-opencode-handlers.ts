import path from "node:path";
import { pathToFileURL } from "node:url";
import { dialog, ipcMain, type BrowserWindow } from "electron";
import { IPC, type GitCommitRequest } from "../../shared/ipc";
import type { OpencodeService } from "../services/opencode-service";
import {
  assertBoolean,
  assertConfigPatch,
  assertOpenDirectoryTarget,
  assertPromptRequestInput,
  assertRuntimeProfileInput,
  assertString,
} from "./validators";

type RuntimeOpencodeHandlersDeps = {
  service: OpencodeService;
  startupBootstrap: { wait: () => Promise<void> };
  getMainWindow: () => BrowserWindow | null;
  inferMimeFromPath: (filePath: string) => string;
};

export function registerRuntimeOpencodeHandlers({
  service,
  startupBootstrap,
  getMainWindow,
  inferMimeFromPath,
}: RuntimeOpencodeHandlersDeps) {
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
    const mainWindow = getMainWindow();
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
  ipcMain.handle(IPC.opencodeGetSessionRuntime, async (_event, directory: unknown, sessionID: unknown) =>
    service.getSessionRuntime(assertString(directory, "directory"), assertString(sessionID, "sessionID")),
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
  ipcMain.handle(IPC.opencodeListAgents, async (_event, directory?: unknown) =>
    service.listAgents(typeof directory === "string" ? directory : undefined),
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

    const mainWindow = getMainWindow();
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
  ipcMain.handle(IPC.opencodeGitStatus, async (_event, directory: unknown) =>
    service.gitStatus(assertString(directory, "directory")),
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
  ipcMain.handle(IPC.opencodeGetServerDiagnostics, async () => service.getServerDiagnostics());
  ipcMain.handle(IPC.opencodeRepairRuntime, async () => service.repairRuntime());
}
