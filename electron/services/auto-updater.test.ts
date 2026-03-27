/** @vitest-environment node */

import type { BrowserWindow, MessageBoxOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdatePreferences } from "../../shared/ipc";
import { createAutoUpdaterController } from "./auto-updater";

class TinyEmitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void) {
    const entries = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
    entries.add(listener);
    this.listeners.set(event, entries);
  }

  removeListener(event: string, listener: (...args: unknown[]) => void) {
    const entries = this.listeners.get(event);
    if (!entries) {
      return;
    }
    entries.delete(listener);
    if (entries.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit(event: string, ...args: unknown[]) {
    const entries = this.listeners.get(event);
    if (!entries) {
      return;
    }
    for (const listener of entries) {
      listener(...args);
    }
  }
}

function createMemoryStore(initial?: Partial<UpdatePreferences>) {
  let state: UpdatePreferences = {
    autoCheckEnabled: initial?.autoCheckEnabled ?? true,
    releaseChannel: initial?.releaseChannel ?? "stable",
  };
  let lastInstalledVersion: string | null = null;

  return {
    get: () => state,
    set: (input: Partial<UpdatePreferences>) => {
      state = {
        ...state,
        ...input,
      };
      return state;
    },
    syncInstalledVersion: (appVersion: string) => {
      const normalizedVersion = appVersion.trim();
      const shouldAutoSelectPrerelease =
        /-[0-9A-Za-z]/.test(normalizedVersion)
        && lastInstalledVersion !== normalizedVersion
        && state.releaseChannel !== "prerelease";
      lastInstalledVersion = normalizedVersion;
      if (shouldAutoSelectPrerelease) {
        state = {
          ...state,
          releaseChannel: "prerelease",
        };
      }
      return state;
    },
  };
}

type HarnessOptions = {
  isPackaged?: boolean;
  appVersion?: string;
  initial?: Partial<UpdatePreferences>;
  checkForUpdates?: () => Promise<unknown>;
  downloadUpdate?: () => Promise<unknown>;
  showMessageBox?: (window: BrowserWindow | null, options: MessageBoxOptions) => Promise<{ response: number }>;
  now?: () => number;
  getWindow?: () => BrowserWindow | null;
  publishTelemetry?: (payload: unknown) => void;
};

function createHarness(options: HarnessOptions = {}) {
  const emitter = new TinyEmitter();
  const checkForUpdates = options.checkForUpdates ?? vi.fn<() => Promise<unknown>>(async () => ({}));
  const downloadUpdate = options.downloadUpdate ?? vi.fn<() => Promise<unknown>>(async () => ({}));
  const showMessageBox =
    options.showMessageBox ??
    vi.fn<(window: BrowserWindow | null, options: MessageBoxOptions) => Promise<{ response: number }>>(async () => ({
      response: 0,
    }));
  const quitAndInstall = vi.fn();
  const publishTelemetry = options.publishTelemetry ?? vi.fn<(payload: unknown) => void>();

  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      emitter.removeListener(event, listener);
    },
  };

  const controller = createAutoUpdaterController({
    deps: {
      isPackaged: options.isPackaged ?? true,
      appVersion: options.appVersion ?? "1.0.0",
      updater,
      showMessageBox,
      now: options.now ?? (() => Date.now()),
      setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
      setIntervalFn: (fn, ms) => setInterval(fn, ms),
      clearTimeoutFn: (timer) => clearTimeout(timer),
      clearIntervalFn: (timer) => clearInterval(timer),
    },
    getWindow: options.getWindow ?? (() => null),
    store: createMemoryStore(options.initial),
    publishTelemetry,
  });

  return { emitter, checkForUpdates, downloadUpdate, showMessageBox, quitAndInstall, publishTelemetry, updater, controller };
}

describe("createAutoUpdaterController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs scheduled checks on startup and interval when auto-check is enabled", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: true },
      checkForUpdates: vi.fn(async () => {
        harness.emitter.emit("update-not-available", {});
        return {};
      }),
    });

    await vi.advanceTimersByTimeAsync(12_100);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 50);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(2);

    harness.controller.setPreferences({ autoCheckEnabled: false });

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 50);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(2);

    harness.controller.cleanup();
  });

  it("starts periodic background checks after auto-check is enabled in preferences", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: false },
      checkForUpdates: vi.fn(async () => {
        harness.emitter.emit("update-not-available", {});
        return {};
      }),
    });

    await vi.advanceTimersByTimeAsync(12_100);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(0);

    harness.controller.setPreferences({ autoCheckEnabled: true });

    await vi.advanceTimersByTimeAsync(12_100);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 50);
    expect(harness.checkForUpdates).toHaveBeenCalledTimes(2);

    harness.controller.cleanup();
  });

  it("supports manual check-now and shows no-update dialog", async () => {
    const harness = createHarness({
      checkForUpdates: vi.fn(async () => {
        harness.emitter.emit("update-not-available", { version: "1.0.0" });
        return {};
      }),
    });
    const result = await harness.controller.checkNow();
    await Promise.resolve();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("started");
    expect(harness.showMessageBox).toHaveBeenCalled();
    expect(harness.controller.getPreferences().releaseChannel).toBe("stable");

    harness.controller.cleanup();
  });

  it("updates release channel and updater prerelease flag", () => {
    const harness = createHarness();
    const next = harness.controller.setPreferences({ releaseChannel: "prerelease" });

    expect(next.releaseChannel).toBe("prerelease");
    expect(harness.updater.allowPrerelease).toBe(true);

    harness.controller.cleanup();
  });

  it("auto-selects prerelease channel for a newly installed prerelease build", () => {
    const harness = createHarness({
      appVersion: "0.1.0-beta.50",
      initial: { autoCheckEnabled: true, releaseChannel: "stable" },
    });

    expect(harness.controller.getPreferences().releaseChannel).toBe("prerelease");
    expect(harness.updater.allowPrerelease).toBe(true);

    harness.controller.cleanup();
  });

  it("returns skipped in unpackaged mode", async () => {
    const harness = createHarness({ isPackaged: false });
    const result = await harness.controller.checkNow();

    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/packaged builds/i);
    harness.controller.cleanup();
  });

  it("downloads and installs when update is available and user triggers update", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: false },
      checkForUpdates: vi.fn(async () => {
        harness.emitter.emit("update-available", { version: "2.0.0" });
        return {};
      }),
    });

    const result = await harness.controller.checkNow();
    const startUpdate = await harness.controller.downloadAndInstall();

    expect(result.status).toBe("started");
    expect(startUpdate.status).toBe("started");
    expect(harness.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "update.available", version: "2.0.0" }));
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "download.start", version: "2.0.0" }));
    harness.controller.cleanup();
  });

  it("emits completion telemetry and starts install when update download completes", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: false },
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    });
    harness.emitter.emit("update-available", { version: "2.0.0" });
    const startUpdate = await harness.controller.downloadAndInstall();
    expect(startUpdate.status).toBe("started");
    harness.emitter.emit("update-downloaded", { version: "2.0.0" });
    vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();

    expect(console.error).not.toHaveBeenCalled();
    expect(harness.showMessageBox).not.toHaveBeenCalled();
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "download.complete", version: "2.0.0" }));
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "install.start", version: "2.0.0" }));
    expect(harness.quitAndInstall).toHaveBeenCalledTimes(1);
    harness.controller.cleanup();
  });

  it("returns skipped when no update is currently available for download/install", async () => {
    const harness = createHarness({ initial: { autoCheckEnabled: false } });
    const result = await harness.controller.downloadAndInstall();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/no update is currently available/i);
    expect(harness.downloadUpdate).not.toHaveBeenCalled();
    harness.controller.cleanup();
  });

  it("reports progress and handles non-finite progress values", async () => {
    const setProgressBar = vi.fn();
    const harness = createHarness({
      getWindow: () => ({
        isDestroyed: () => false,
        setProgressBar,
      } as unknown as BrowserWindow),
    });

    harness.emitter.emit("download-progress", { percent: 135 });
    harness.emitter.emit("download-progress", { percent: Number.NaN });

    expect(setProgressBar).toHaveBeenCalledWith(1);
    expect(setProgressBar).toHaveBeenCalledWith(0);
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "download.progress" }));
    harness.controller.cleanup();
  });

  it("returns skipped when a check is already in progress", async () => {
    let resolveCheck = () => undefined;
    let hasResolveCheck = false;
    const harness = createHarness({
      checkForUpdates: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveCheck = () => {
              harness.emitter.emit("update-not-available", {});
              resolve({});
            };
            hasResolveCheck = true;
          }),
      ),
    });

    const first = harness.controller.checkNow();
    const second = await harness.controller.checkNow();
    expect(second.status).toBe("skipped");
    if (hasResolveCheck) {
      resolveCheck();
    }
    await first;
    harness.controller.cleanup();
  });

  it("surfaces manual check errors with dialog and error result", async () => {
    const harness = createHarness({
      checkForUpdates: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const result = await harness.controller.checkNow();

    expect(result.ok).toBe(false);
    expect(result.status).toBe("error");
    expect(result.message).toContain("network down");
    expect(harness.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Update check failed",
      }),
    );
    expect(console.error).toHaveBeenCalled();
    harness.controller.cleanup();
  });

  it("treats missing stable release as non-fatal on manual checks", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: false, releaseChannel: "stable" },
      checkForUpdates: vi.fn(async () => {
        throw new Error("Unable to find latest version on GitHub (/releases/latest) HttpError: 406");
      }),
    });
    const result = await harness.controller.checkNow();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("skipped");
    expect(result.message).toContain("Already up to date");
    expect(harness.showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        title: "Already up to date",
      }),
    );
    expect(harness.publishTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "check.success",
        message: "No update available — release not found or not yet published.",
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
    harness.controller.cleanup();
  });

  it("suppresses noisy errors for scheduled checks when no stable release exists", async () => {
    const harness = createHarness({
      initial: { autoCheckEnabled: true, releaseChannel: "stable" },
      checkForUpdates: vi.fn(async () => {
        throw new Error("Unable to find latest version on GitHub (/releases/latest) HttpError: 406");
      }),
    });

    await vi.advanceTimersByTimeAsync(12_100);

    expect(harness.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(harness.showMessageBox).not.toHaveBeenCalled();
    expect(harness.publishTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "check.success",
        message: "No update available — release not found or not yet published.",
      }),
    );
    expect(console.error).not.toHaveBeenCalled();
    harness.controller.cleanup();
  });

  it("handles non-manual updater errors without dialog", async () => {
    const harness = createHarness();
    harness.emitter.emit("error", "raw failure");
    await Promise.resolve();

    expect(harness.showMessageBox).not.toHaveBeenCalled();
    expect(harness.publishTelemetry).toHaveBeenCalledWith(expect.objectContaining({ phase: "check.error", message: "Unknown updater error" }));
    harness.controller.cleanup();
  });
});
