/** @vitest-environment node */

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

  return {
    get: () => state,
    set: (input: Partial<UpdatePreferences>) => {
      state = {
        ...state,
        ...input,
      };
      return state;
    },
  };
}

describe("createAutoUpdaterController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs scheduled checks only when auto-check is enabled", async () => {
    const emitter = new TinyEmitter();
    const checkForUpdates = vi.fn(async () => {
      emitter.emit("update-not-available", {});
      return {};
    });

    const controller = createAutoUpdaterController({
      deps: {
        isPackaged: true,
        updater: {
          autoDownload: false,
          autoInstallOnAppQuit: false,
          allowPrerelease: false,
          checkForUpdates,
          downloadUpdate: vi.fn(async () => ({})),
          quitAndInstall: vi.fn(),
          on: (event, listener) => {
            emitter.on(event, listener as (...args: unknown[]) => void);
          },
          removeListener: (event, listener) => {
            emitter.removeListener(event, listener as (...args: unknown[]) => void);
          },
        },
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        now: () => Date.now(),
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        setIntervalFn: (fn, ms) => setInterval(fn, ms),
        clearTimeoutFn: (timer) => clearTimeout(timer),
        clearIntervalFn: (timer) => clearInterval(timer),
      },
      getWindow: () => null,
      store: createMemoryStore({ autoCheckEnabled: true }),
    });

    await vi.advanceTimersByTimeAsync(12_100);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    controller.setPreferences({ autoCheckEnabled: false });

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 50);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    controller.cleanup();
  });

  it("supports manual check-now and shows no-update dialog", async () => {
    const emitter = new TinyEmitter();
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    const controller = createAutoUpdaterController({
      deps: {
        isPackaged: true,
        updater: {
          autoDownload: false,
          autoInstallOnAppQuit: false,
          allowPrerelease: false,
          checkForUpdates: vi.fn(async () => {
            emitter.emit("update-not-available", { version: "1.0.0" });
            return {};
          }),
          downloadUpdate: vi.fn(async () => ({})),
          quitAndInstall: vi.fn(),
          on: (event, listener) => {
            emitter.on(event, listener as (...args: unknown[]) => void);
          },
          removeListener: (event, listener) => {
            emitter.removeListener(event, listener as (...args: unknown[]) => void);
          },
        },
        showMessageBox,
        now: () => Date.now(),
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        setIntervalFn: (fn, ms) => setInterval(fn, ms),
        clearTimeoutFn: (timer) => clearTimeout(timer),
        clearIntervalFn: (timer) => clearInterval(timer),
      },
      getWindow: () => null,
      store: createMemoryStore(),
    });

    const result = await controller.checkNow();
    await Promise.resolve();

    expect(result.ok).toBe(true);
    expect(result.status).toBe("started");
    expect(showMessageBox).toHaveBeenCalled();

    controller.cleanup();
  });

  it("updates release channel and updater prerelease flag", () => {
    const emitter = new TinyEmitter();
    const updater = {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: false,
      checkForUpdates: vi.fn(async () => ({})),
      downloadUpdate: vi.fn(async () => ({})),
      quitAndInstall: vi.fn(),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        emitter.on(event, listener);
      },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => {
        emitter.removeListener(event, listener);
      },
    };

    const controller = createAutoUpdaterController({
      deps: {
        isPackaged: true,
        updater,
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        now: () => Date.now(),
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        setIntervalFn: (fn, ms) => setInterval(fn, ms),
        clearTimeoutFn: (timer) => clearTimeout(timer),
        clearIntervalFn: (timer) => clearInterval(timer),
      },
      getWindow: () => null,
      store: createMemoryStore(),
    });

    const next = controller.setPreferences({ releaseChannel: "prerelease" });

    expect(next.releaseChannel).toBe("prerelease");
    expect(updater.allowPrerelease).toBe(true);

    controller.cleanup();
  });

  it("returns skipped in unpackaged mode", async () => {
    const emitter = new TinyEmitter();
    const controller = createAutoUpdaterController({
      deps: {
        isPackaged: false,
        updater: {
          autoDownload: false,
          autoInstallOnAppQuit: false,
          allowPrerelease: false,
          checkForUpdates: vi.fn(async () => ({})),
          downloadUpdate: vi.fn(async () => ({})),
          quitAndInstall: vi.fn(),
          on: (event, listener) => {
            emitter.on(event, listener as (...args: unknown[]) => void);
          },
          removeListener: (event, listener) => {
            emitter.removeListener(event, listener as (...args: unknown[]) => void);
          },
        },
        showMessageBox: vi.fn(async () => ({ response: 0 })),
        now: () => Date.now(),
        setTimeoutFn: (fn, ms) => setTimeout(fn, ms),
        setIntervalFn: (fn, ms) => setInterval(fn, ms),
        clearTimeoutFn: (timer) => clearTimeout(timer),
        clearIntervalFn: (timer) => clearInterval(timer),
      },
      getWindow: () => null,
      store: createMemoryStore(),
    });

    const result = await controller.checkNow();

    expect(result.status).toBe("skipped");

    controller.cleanup();
  });
});
