import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OrxaBridge, type OrxaEvent } from "../shared/ipc";

const bridge: OrxaBridge = {
  mode: {
    get: () => ipcRenderer.invoke(IPC.modeGet),
    set: (mode) => ipcRenderer.invoke(IPC.modeSet, mode),
  },
  runtime: {
    getState: () => ipcRenderer.invoke(IPC.runtimeGetState),
    listProfiles: () => ipcRenderer.invoke(IPC.runtimeListProfiles),
    saveProfile: (profile) => ipcRenderer.invoke(IPC.runtimeSaveProfile, profile),
    deleteProfile: (id) => ipcRenderer.invoke(IPC.runtimeDeleteProfile, id),
    attach: (profileID) => ipcRenderer.invoke(IPC.runtimeAttach, profileID),
    startLocal: (profileID) => ipcRenderer.invoke(IPC.runtimeStartLocal, profileID),
    stopLocal: () => ipcRenderer.invoke(IPC.runtimeStopLocal),
  },
  opencode: {
    bootstrap: () => ipcRenderer.invoke(IPC.opencodeBootstrap),
    addProjectDirectory: () => ipcRenderer.invoke(IPC.opencodeAddProjectDirectory),
    removeProjectDirectory: (directory) => ipcRenderer.invoke(IPC.opencodeRemoveProjectDirectory, directory),
    selectProject: (directory) => ipcRenderer.invoke(IPC.opencodeSelectProject, directory),
    refreshProject: (directory) => ipcRenderer.invoke(IPC.opencodeRefreshProject, directory),
    createSession: (directory, title) => ipcRenderer.invoke(IPC.opencodeCreateSession, directory, title),
    deleteSession: (directory, sessionID) => ipcRenderer.invoke(IPC.opencodeDeleteSession, directory, sessionID),
    abortSession: (directory, sessionID) => ipcRenderer.invoke(IPC.opencodeAbortSession, directory, sessionID),
    renameSession: (directory, sessionID, title) => ipcRenderer.invoke(IPC.opencodeRenameSession, directory, sessionID, title),
    archiveSession: (directory, sessionID) => ipcRenderer.invoke(IPC.opencodeArchiveSession, directory, sessionID),
    createWorktreeSession: (directory, sessionID, name) =>
      ipcRenderer.invoke(IPC.opencodeCreateWorktreeSession, directory, sessionID, name),
    loadMessages: (directory, sessionID) => ipcRenderer.invoke(IPC.opencodeLoadMessages, directory, sessionID),
    sendPrompt: (input) => ipcRenderer.invoke(IPC.opencodeSendPrompt, input),
    replyPermission: (directory, requestID, reply, message) =>
      ipcRenderer.invoke(IPC.opencodeReplyPermission, directory, requestID, reply, message),
    replyQuestion: (directory, requestID, answers) =>
      ipcRenderer.invoke(IPC.opencodeReplyQuestion, directory, requestID, answers),
    rejectQuestion: (directory, requestID) => ipcRenderer.invoke(IPC.opencodeRejectQuestion, directory, requestID),
    getConfig: (scope, directory) => ipcRenderer.invoke(IPC.opencodeGetConfig, scope, directory),
    updateConfig: (scope, patch, directory) => ipcRenderer.invoke(IPC.opencodeUpdateConfig, scope, patch, directory),
    readRawConfig: (scope, directory) => ipcRenderer.invoke(IPC.opencodeReadRawConfig, scope, directory),
    writeRawConfig: (scope, content, directory) => ipcRenderer.invoke(IPC.opencodeWriteRawConfig, scope, content, directory),
    pickImage: () => ipcRenderer.invoke(IPC.opencodePickImage),
    gitDiff: (directory) => ipcRenderer.invoke(IPC.opencodeGitDiff, directory),
    gitLog: (directory) => ipcRenderer.invoke(IPC.opencodeGitLog, directory),
    gitIssues: (directory) => ipcRenderer.invoke(IPC.opencodeGitIssues, directory),
    gitPrs: (directory) => ipcRenderer.invoke(IPC.opencodeGitPrs, directory),
    openDirectoryIn: (directory, target) => ipcRenderer.invoke(IPC.opencodeOpenDirectoryIn, directory, target),
    gitCommitSummary: (directory, includeUnstaged) => ipcRenderer.invoke(IPC.opencodeGitCommitSummary, directory, includeUnstaged),
    gitGenerateCommitMessage: (directory, includeUnstaged, guidancePrompt) =>
      ipcRenderer.invoke(IPC.opencodeGitGenerateCommitMessage, directory, includeUnstaged, guidancePrompt),
    gitCommit: (directory, request) => ipcRenderer.invoke(IPC.opencodeGitCommit, directory, request),
    gitBranches: (directory) => ipcRenderer.invoke(IPC.opencodeGitBranches, directory),
    gitCheckoutBranch: (directory, branch) => ipcRenderer.invoke(IPC.opencodeGitCheckoutBranch, directory, branch),
    gitStageAll: (directory) => ipcRenderer.invoke(IPC.opencodeGitStageAll, directory),
    gitRestoreAllUnstaged: (directory) => ipcRenderer.invoke(IPC.opencodeGitRestoreAllUnstaged, directory),
    gitStagePath: (directory, filePath) => ipcRenderer.invoke(IPC.opencodeGitStagePath, directory, filePath),
    gitRestorePath: (directory, filePath) => ipcRenderer.invoke(IPC.opencodeGitRestorePath, directory, filePath),
    gitUnstagePath: (directory, filePath) => ipcRenderer.invoke(IPC.opencodeGitUnstagePath, directory, filePath),
    listSkills: () => ipcRenderer.invoke(IPC.opencodeListSkills),
    readAgentsMd: (directory) => ipcRenderer.invoke(IPC.opencodeReadAgentsMd, directory),
    writeAgentsMd: (directory, content) => ipcRenderer.invoke(IPC.opencodeWriteAgentsMd, directory, content),
    listAgentFiles: () => ipcRenderer.invoke(IPC.opencodeListAgentFiles),
    readAgentFile: (filename) => ipcRenderer.invoke(IPC.opencodeReadAgentFile, filename),
    writeAgentFile: (filename, content) => ipcRenderer.invoke(IPC.opencodeWriteAgentFile, filename, content),
    deleteAgentFile: (filename) => ipcRenderer.invoke(IPC.opencodeDeleteAgentFile, filename),
    openFileIn: (filePath, target) => ipcRenderer.invoke(IPC.opencodeOpenFileIn, filePath, target),
    listFiles: (directory, relativePath) => ipcRenderer.invoke(IPC.opencodeListFiles, directory, relativePath),
    countProjectFiles: (directory) => ipcRenderer.invoke(IPC.opencodeCountProjectFiles, directory),
    readProjectFile: (directory, relativePath) => ipcRenderer.invoke(IPC.opencodeReadProjectFile, directory, relativePath),
    readOrxaConfig: () => ipcRenderer.invoke(IPC.orxaReadConfig),
    writeOrxaConfig: (content) => ipcRenderer.invoke(IPC.orxaWriteConfig, content),
    readOrxaAgentPrompt: (agent) => ipcRenderer.invoke(IPC.orxaReadAgentPrompt, agent),
    listOrxaAgents: () => ipcRenderer.invoke(IPC.orxaListAgents),
    saveOrxaAgent: (input) => ipcRenderer.invoke(IPC.orxaSaveAgent, input),
    getOrxaAgentDetails: (name) => ipcRenderer.invoke(IPC.orxaGetAgentDetails, name),
    resetOrxaAgent: (name) => ipcRenderer.invoke(IPC.orxaResetAgent, name),
    restoreOrxaAgentHistory: (name, historyID) => ipcRenderer.invoke(IPC.orxaRestoreAgentHistory, name, historyID),
    getServerDiagnostics: () => ipcRenderer.invoke(IPC.orxaGetServerDiagnostics),
    repairRuntime: () => ipcRenderer.invoke(IPC.orxaRepairRuntime),
  },
  terminal: {
    list: (directory) => ipcRenderer.invoke(IPC.terminalList, directory),
    create: (directory, cwd, title) => ipcRenderer.invoke(IPC.terminalCreate, directory, cwd, title),
    connect: (directory, ptyID) => ipcRenderer.invoke(IPC.terminalConnect, directory, ptyID),
    write: (directory, ptyID, data) => ipcRenderer.invoke(IPC.terminalWrite, directory, ptyID, data),
    resize: (directory, ptyID, cols, rows) => ipcRenderer.invoke(IPC.terminalResize, directory, ptyID, cols, rows),
    close: (directory, ptyID) => ipcRenderer.invoke(IPC.terminalClose, directory, ptyID),
  },
  events: {
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: OrxaEvent) => listener(payload);
      ipcRenderer.on(IPC.events, handler);
      return () => {
        ipcRenderer.removeListener(IPC.events, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("orxa", bridge);
