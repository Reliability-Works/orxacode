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
  phase:
    | "check.start"
    | "check.success"
    | "check.error"
    | "update.available"
    | "download.start"
    | "download.progress"
    | "download.complete"
    | "install.start";
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
  downloadAndInstall: () => Promise<UpdateCheckResult>;
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

function isMissingStableReleaseError(error: unknown, releaseChannel: UpdateReleaseChannel): boolean {
  if (releaseChannel !== "stable") {
    return false;
  }
  const message = formatErrorMessage(error).toLowerCase();
  if (message.includes("unable to find latest version on github")) {
    return true;
  }
  return message.includes("/releases/latest") && message.includes("httperror: 406");
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
  let availableVersion: string | undefined;
  let isDownloadingUpdate = false;
  let activeDownloadManual = false;
  let installAfterDownload = false;

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

    const version =
      info && typeof info === "object" && "version" in info && typeof (info as { version?: unknown }).version === "string"
        ? (info as { version: string }).version
        : undefined;
    if (version) {
      availableVersion = version;
    }
    emitTelemetry({
      phase: "update.available",
      manual,
      version,
    });
    emitTelemetry({
      phase: "check.success",
      manual,
      durationMs: deps.now() - activeCheckStartedAt,
      version,
    });
    isCheckingForUpdates = false;
    activeCheckManual = false;
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
      manual: activeDownloadManual,
      percent: Number.isFinite(progress.percent) ? progress.percent : undefined,
      version: availableVersion,
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
      manual: activeDownloadManual,
      version,
    });
    isDownloadingUpdate = false;

    if (installAfterDownload) {
      emitTelemetry({
        phase: "install.start",
        manual: activeDownloadManual,
        version,
      });
      installAfterDownload = false;
      activeDownloadManual = false;
      availableVersion = undefined;
      updater.quitAndInstall();
      return;
    }

    activeDownloadManual = false;
  };

  const onError = async (error: unknown): Promise<"fatal" | "nonfatal"> => {
    resetProgressBar();
    const manual = activeCheckManual || pendingManualResult || activeDownloadManual;
    const wasDownloading = isDownloadingUpdate;
    const message = formatErrorMessage(error);
    const durationMs = activeCheckStartedAt > 0 ? deps.now() - activeCheckStartedAt : undefined;
    isDownloadingUpdate = false;
    activeDownloadManual = false;
    installAfterDownload = false;
    if (isMissingStableReleaseError(error, preferences.releaseChannel)) {
      emitTelemetry({
        phase: "check.success",
        manual,
        durationMs,
        message: "No stable release has been published yet.",
      });

      pendingManualResult = false;
      isCheckingForUpdates = false;
      activeCheckManual = false;

      if (manual) {
        await showMessage(deps, getWindow, {
          type: "info",
          title: "No stable updates available",
          message: "You're on the stable channel and no stable release is published yet.",
          detail: "Switch release channel to Prerelease to receive beta updates.",
          buttons: ["OK"],
          defaultId: 0,
          cancelId: 0,
        });
      }

      console.info("Auto update check skipped: no stable release published yet for the stable channel.");
      return "nonfatal";
    }

    emitTelemetry({
      phase: "check.error",
      manual,
      durationMs,
      message,
    });

    pendingManualResult = false;
    isCheckingForUpdates = false;
    activeCheckManual = false;

    if (manual) {
      await showMessage(deps, getWindow, {
        type: "error",
        title: wasDownloading ? "Update download failed" : "Update check failed",
        message: wasDownloading ? "Unable to download updates right now." : "Unable to check for updates right now.",
        detail: message,
        buttons: ["OK"],
        defaultId: 0,
        cancelId: 0,
      });
    }

    console.error("Auto update error:", error);
    return "fatal";
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
      const outcome = await onError(error);
      if (outcome === "nonfatal") {
        return {
          ok: true,
          status: "skipped",
          message: "No stable release has been published yet.",
        };
      }
      return {
        ok: false,
        status: "error",
        message: formatErrorMessage(error),
      };
    }
  };

  const downloadAndInstall = async (): Promise<UpdateCheckResult> => {
    if (!deps.isPackaged) {
      return {
        ok: true,
        status: "skipped",
        message: "Update installs run only in packaged builds.",
      };
    }
    if (isDownloadingUpdate) {
      return {
        ok: true,
        status: "skipped",
        message: "An update download is already in progress.",
      };
    }
    if (!availableVersion) {
      return {
        ok: true,
        status: "skipped",
        message: "No update is currently available. Check for updates first.",
      };
    }

    isDownloadingUpdate = true;
    activeDownloadManual = true;
    installAfterDownload = true;
    emitTelemetry({
      phase: "download.start",
      manual: true,
      version: availableVersion,
    });
    void updater.downloadUpdate().catch(async (error) => {
      await onError(error);
    });

    return {
      ok: true,
      status: "started",
    };
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
    downloadAndInstall,
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
