import { app, BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import { autoUpdater } from "electron-updater";

const INITIAL_UPDATE_CHECK_DELAY_MS = 12_000;
const PERIODIC_UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

export function setupAutoUpdates(getWindow: () => BrowserWindow | null) {
  if (!app.isPackaged) {
    return () => undefined;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  let isPromptingForDownload = false;
  let isPromptingForRestart = false;

  const onUpdateAvailable = async () => {
    if (isPromptingForDownload) {
      return;
    }
    isPromptingForDownload = true;
    try {
      const targetWindow = getWindow();
      const options: MessageBoxOptions = {
        type: "info",
        title: "Update available",
        message: "A newer version of OrxaCode is available.",
        detail: "Download and install it now?",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      };
      const result = targetWindow ? await dialog.showMessageBox(targetWindow, options) : await dialog.showMessageBox(options);
      if (result.response === 0) {
        await autoUpdater.downloadUpdate();
      }
    } catch (error) {
      console.error("Failed while handling update-available:", error);
    } finally {
      isPromptingForDownload = false;
    }
  };

  const onDownloadProgress = (progress: { percent: number }) => {
    const targetWindow = getWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }
    const ratio = Number.isFinite(progress.percent) ? Math.max(0, Math.min(1, progress.percent / 100)) : 0;
    targetWindow.setProgressBar(ratio);
  };

  const onUpdateDownloaded = async () => {
    const targetWindow = getWindow();
    targetWindow?.setProgressBar(-1);
    if (isPromptingForRestart) {
      return;
    }
    isPromptingForRestart = true;
    try {
      const options: MessageBoxOptions = {
        type: "info",
        title: "Update ready",
        message: "The update is downloaded and ready to install.",
        detail: "Restart OrxaCode now to finish installing?",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      };
      const result = targetWindow ? await dialog.showMessageBox(targetWindow, options) : await dialog.showMessageBox(options);
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    } catch (error) {
      console.error("Failed while handling update-downloaded:", error);
    } finally {
      isPromptingForRestart = false;
    }
  };

  const onError = (error: Error) => {
    const targetWindow = getWindow();
    targetWindow?.setProgressBar(-1);
    console.error("Auto update error:", error);
  };

  autoUpdater.on("update-available", onUpdateAvailable);
  autoUpdater.on("download-progress", onDownloadProgress);
  autoUpdater.on("update-downloaded", onUpdateDownloaded);
  autoUpdater.on("error", onError);

  const checkForUpdates = async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      onError(error as Error);
    }
  };

  const initialTimer = setTimeout(() => {
    void checkForUpdates();
  }, INITIAL_UPDATE_CHECK_DELAY_MS);
  const intervalTimer = setInterval(() => {
    void checkForUpdates();
  }, PERIODIC_UPDATE_CHECK_MS);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
    autoUpdater.removeListener("update-available", onUpdateAvailable);
    autoUpdater.removeListener("download-progress", onDownloadProgress);
    autoUpdater.removeListener("update-downloaded", onUpdateDownloaded);
    autoUpdater.removeListener("error", onError);
  };
}
