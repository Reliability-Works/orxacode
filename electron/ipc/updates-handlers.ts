import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc";
import type { AutoUpdaterController } from "../services/auto-updater";
import { assertUpdatePreferencesInput } from "./validators";

type UpdatesHandlersDeps = {
  getAutoUpdaterController: () => AutoUpdaterController | undefined;
};

export function registerUpdatesHandlers({ getAutoUpdaterController }: UpdatesHandlersDeps) {
  ipcMain.handle(IPC.updatesGetPreferences, async () =>
    getAutoUpdaterController()?.getPreferences() ?? { autoCheckEnabled: true, releaseChannel: "stable" },
  );

  ipcMain.handle(IPC.updatesSetPreferences, async (_event, input: unknown) => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) {
      throw new Error("Updater controller not available");
    }
    return autoUpdaterController.setPreferences(assertUpdatePreferencesInput(input));
  });

  ipcMain.handle(IPC.updatesCheckNow, async () => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) {
      return {
        ok: true,
        status: "skipped",
        message: "Updater not initialized",
      };
    }
    return autoUpdaterController.checkNow();
  });

  ipcMain.handle(IPC.updatesDownloadAndInstall, async () => {
    const autoUpdaterController = getAutoUpdaterController();
    if (!autoUpdaterController) {
      return {
        ok: true,
        status: "skipped",
        message: "Updater not initialized",
      };
    }
    return autoUpdaterController.downloadAndInstall();
  });
}
