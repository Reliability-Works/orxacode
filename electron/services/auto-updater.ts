import { app, BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";
import type { UpdateCheckResult, UpdatePreferences, UpdateReleaseChannel } from "../../shared/ipc";

const INITIAL_UPDATE_CHECK_DELAY_MS = 12_000;
const PERIODIC_UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;

const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  autoCheckEnabled: true,
  releaseChannel: "stable",
};

type PersistedUpdaterPreferences = UpdatePreferences & {
  version: 1;
};

type AutoUpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};

type AutoUpdaterDeps = {
  isPackaged: boolean;
  updater: AutoUpdaterLike;
  showMessageBox: (window: BrowserWindow | null, options: MessageBoxOptions) => Promise<{ response: number }>;
  now: () => number;
  setTimeoutFn: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  setIntervalFn: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;
  clearIntervalFn: (timer: ReturnType<typeof setInterval>) => void;
};

type TelemetryPayload = {
  phase: "check.start" | "check.success" | "check.error" | "download.progress" | "download.complete";
  manual: boolean;
  releaseChannel: UpdateReleaseChannel;
  durationMs?: number;
  percent?: number;
  message?: string;
  version?: string;
};

type UpdatePreferencesStore = {
  get: () => UpdatePreferences;
  set: (input: Partial<UpdatePreferences>) => UpdatePreferences;
};

export type AutoUpdaterController = {
  cleanup: () => void;
  getPreferences: () => UpdatePreferences;
  setPreferences: (input: Partial<UpdatePreferences>) => UpdatePreferences;
  checkNow: () => Promise<UpdateCheckResult>;
};

class ElectronUpdatePreferencesStore implements UpdatePreferencesStore {
  private readonly store = new Store<PersistedUpdaterPreferences>({
    name: "update-preferences",
    defaults: {
      ...DEFAULT_UPDATE_PREFERENCES,
      version: 1,
    },
  });

  get(): UpdatePreferences {
    return {
      autoCheckEnabled: this.store.get("autoCheckEnabled"),
      releaseChannel: sanitizeReleaseChannel(this.store.get("releaseChannel")),
    };
  }

  set(input: Partial<UpdatePreferences>): UpdatePreferences {
    const nextAutoCheckEnabled =
      typeof input.autoCheckEnabled === "boolean"
        ? input.autoCheckEnabled
        : this.store.get("autoCheckEnabled", DEFAULT_UPDATE_PREFERENCES.autoCheckEnabled);
    const nextReleaseChannel =
      input.releaseChannel !== undefined
        ? sanitizeReleaseChannel(input.releaseChannel)
        : sanitizeReleaseChannel(this.store.get("releaseChannel", DEFAULT_UPDATE_PREFERENCES.releaseChannel));

    this.store.set("autoCheckEnabled", nextAutoCheckEnabled);
    this.store.set("releaseChannel", nextReleaseChannel);

    return {
      autoCheckEnabled: nextAutoCheckEnabled,
      releaseChannel: nextReleaseChannel,
    };
  }
}

function sanitizeReleaseChannel(value: unknown): UpdateReleaseChannel {
  return value === "prerelease" ? "prerelease" : "stable";
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown updater error";
}

async function showMessage(
  deps: AutoUpdaterDeps,
  getWindow: () => BrowserWindow | null,
  options: MessageBoxOptions,
): Promise<{ response: number }> {
  return deps.showMessageBox(getWindow(), options);
}

function createDefaultDeps(): AutoUpdaterDeps {
  return {
    isPackaged: app.isPackaged,
    updater: autoUpdater as unknown as AutoUpdaterLike,
    showMessageBox: async (window, options) => {
      return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
    },
    now: () => Date.now(),
    setTimeoutFn: (callback, delayMs) => setTimeout(callback, delayMs),
    setIntervalFn: (callback, delayMs) => setInterval(callback, delayMs),
    clearTimeoutFn: (timer) => clearTimeout(timer),
    clearIntervalFn: (timer) => clearInterval(timer),
  };
}

export function createAutoUpdaterController(options: {
  deps: AutoUpdaterDeps;
  getWindow: () => BrowserWindow | null;
  store: UpdatePreferencesStore;
  publishTelemetry?: (payload: TelemetryPayload) => void;
}): AutoUpdaterController {
  const { deps, getWindow, store } = options;
  const publishTelemetry = options.publishTelemetry ?? (() => undefined);
  const updater = deps.updater;

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;

  let preferences = store.get();
  updater.allowPrerelease = preferences.releaseChannel === "prerelease";

  let initialTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let pendingManualResult = false;
  let activeCheckManual = false;
  let isCheckingForUpdates = false;
  let activeCheckStartedAt = 0;

  let isPromptingForDownload = false;
  let isPromptingForRestart = false;

  const resetProgressBar = () => {
    const targetWindow = getWindow();
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.setProgressBar(-1);
    }
  };

  const emitTelemetry = (payload: Omit<TelemetryPayload, "releaseChannel">) => {
    publishTelemetry({
      ...payload,
      releaseChannel: preferences.releaseChannel,
    });
  };

  const clearTimers = () => {
    if (initialTimer) {
      deps.clearTimeoutFn(initialTimer);
      initialTimer = undefined;
    }
    if (intervalTimer) {
      deps.clearIntervalFn(intervalTimer);
      intervalTimer = undefined;
    }
  };

  const onUpdateAvailable = async (info?: unknown) => {
    const manual = activeCheckManual;
    pendingManualResult = false;
    if (isPromptingForDownload) {
      return;
    }

    const version =
      info && typeof info === "object" && "version" in info && typeof (info as { version?: unknown }).version === "string"
        ? (info as { version: string }).version
        : undefined;

    isPromptingForDownload = true;
    try {
      const result = await showMessage(deps, getWindow, {
        type: "info",
        title: "Update available",
        message: "A newer version of Opencode Orxa is available.",
        detail: "Download and install it now?",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) {
        await updater.downloadUpdate();
      }
      emitTelemetry({
        phase: "check.success",
        manual,
        durationMs: deps.now() - activeCheckStartedAt,
        version,
      });
    } catch (error) {
      emitTelemetry({
        phase: "check.error",
        manual,
        durationMs: deps.now() - activeCheckStartedAt,
        message: formatErrorMessage(error),
      });
      console.error("Failed while handling update-available:", error);
    } finally {
      isPromptingForDownload = false;
      isCheckingForUpdates = false;
      activeCheckManual = false;
    }
  };

  const onUpdateNotAvailable = async () => {
    const manual = activeCheckManual || pendingManualResult;
    pendingManualResult = false;
    emitTelemetry({
      phase: "check.success",
      manual,
      durationMs: deps.now() - activeCheckStartedAt,
    });
    isCheckingForUpdates = false;
    activeCheckManual = false;

    if (!manual) {
      return;
    }

    await showMessage(deps, getWindow, {
      type: "info",
      title: "No updates found",
      message: "You are already on the latest version.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
  };

  const onDownloadProgress = (progress: { percent: number }) => {
    const ratio = Number.isFinite(progress.percent) ? Math.max(0, Math.min(1, progress.percent / 100)) : 0;
    const targetWindow = getWindow();
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.setProgressBar(ratio);
    }
    emitTelemetry({
      phase: "download.progress",
      manual: activeCheckManual,
      percent: Number.isFinite(progress.percent) ? progress.percent : undefined,
    });
  };

  const onUpdateDownloaded = async (info?: unknown) => {
    resetProgressBar();
    const version =
      info && typeof info === "object" && "version" in info && typeof (info as { version?: unknown }).version === "string"
        ? (info as { version: string }).version
        : undefined;
    emitTelemetry({
      phase: "download.complete",
      manual: activeCheckManual,
      version,
    });

    if (isPromptingForRestart) {
      return;
    }
    isPromptingForRestart = true;
    try {
      const result = await showMessage(deps, getWindow, {
        type: "info",
        title: "Update ready",
        message: "The update is downloaded and ready to install.",
        detail: "Restart Opencode Orxa now to finish installing?",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) {
        updater.quitAndInstall();
      }
    } catch (error) {
      console.error("Failed while handling update-downloaded:", error);
    } finally {
      isPromptingForRestart = false;
    }
  };

  const onError = async (error: unknown) => {
    resetProgressBar();
    const manual = activeCheckManual || pendingManualResult;
    const message = formatErrorMessage(error);
    emitTelemetry({
      phase: "check.error",
      manual,
      durationMs: activeCheckStartedAt > 0 ? deps.now() - activeCheckStartedAt : undefined,
      message,
    });

    pendingManualResult = false;
    isCheckingForUpdates = false;
    activeCheckManual = false;

    if (manual) {
      await showMessage(deps, getWindow, {
        type: "error",
        title: "Update check failed",
        message: "Unable to check for updates right now.",
        detail: message,
        buttons: ["OK"],
        defaultId: 0,
        cancelId: 0,
      });
    }

    console.error("Auto update error:", error);
  };

  const checkForUpdates = async (manual: boolean): Promise<UpdateCheckResult> => {
    if (!deps.isPackaged) {
      return {
        ok: true,
        status: "skipped",
        message: "Update checks run only in packaged builds.",
      };
    }

    if (isCheckingForUpdates) {
      return {
        ok: true,
        status: "skipped",
        message: "An update check is already in progress.",
      };
    }

    isCheckingForUpdates = true;
    pendingManualResult = manual;
    activeCheckManual = manual;
    activeCheckStartedAt = deps.now();
    emitTelemetry({ phase: "check.start", manual });

    try {
      await updater.checkForUpdates();
      return {
        ok: true,
        status: "started",
      };
    } catch (error) {
      await onError(error);
      return {
        ok: false,
        status: "error",
        message: formatErrorMessage(error),
      };
    }
  };

  const scheduleChecks = () => {
    clearTimers();
    if (!deps.isPackaged || !preferences.autoCheckEnabled) {
      return;
    }

    initialTimer = deps.setTimeoutFn(() => {
      void checkForUpdates(false);
    }, INITIAL_UPDATE_CHECK_DELAY_MS);

    intervalTimer = deps.setIntervalFn(() => {
      void checkForUpdates(false);
    }, PERIODIC_UPDATE_CHECK_MS);
  };

  updater.on("update-available", onUpdateAvailable as (...args: unknown[]) => void);
  updater.on("update-not-available", onUpdateNotAvailable as (...args: unknown[]) => void);
  updater.on("download-progress", onDownloadProgress as (...args: unknown[]) => void);
  updater.on("update-downloaded", onUpdateDownloaded as (...args: unknown[]) => void);
  updater.on("error", onError as (...args: unknown[]) => void);

  scheduleChecks();

  return {
    cleanup: () => {
      clearTimers();
      updater.removeListener("update-available", onUpdateAvailable as (...args: unknown[]) => void);
      updater.removeListener("update-not-available", onUpdateNotAvailable as (...args: unknown[]) => void);
      updater.removeListener("download-progress", onDownloadProgress as (...args: unknown[]) => void);
      updater.removeListener("update-downloaded", onUpdateDownloaded as (...args: unknown[]) => void);
      updater.removeListener("error", onError as (...args: unknown[]) => void);
    },
    getPreferences: () => preferences,
    setPreferences: (input) => {
      preferences = store.set(input);
      updater.allowPrerelease = preferences.releaseChannel === "prerelease";
      scheduleChecks();
      return preferences;
    },
    checkNow: () => checkForUpdates(true),
  };
}

export function setupAutoUpdates(
  getWindow: () => BrowserWindow | null,
  publishTelemetry?: (payload: TelemetryPayload) => void,
): AutoUpdaterController {
  return createAutoUpdaterController({
    deps: createDefaultDeps(),
    getWindow,
    store: new ElectronUpdatePreferencesStore(),
    publishTelemetry,
  });
}
