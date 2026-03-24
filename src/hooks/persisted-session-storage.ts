import { readPersistedValue, removePersistedValue, writePersistedValue } from "../lib/persistence";

export function createPersistedSessionStore<T>(options: {
  storagePrefix: string;
  createDefault: () => T;
  hydrate?: (value: T) => T;
}) {
  const cache = new Map<string, T>();

  function storageKey(sessionKey: string) {
    return `${options.storagePrefix}:${sessionKey}`;
  }

  function readFromDisk(sessionKey: string): T | null {
    try {
      const raw = readPersistedValue(storageKey(sessionKey));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as T;
      return options.hydrate ? options.hydrate(parsed) : parsed;
    } catch {
      return null;
    }
  }

  function writeToDisk(sessionKey: string, next: T) {
    try {
      writePersistedValue(storageKey(sessionKey), JSON.stringify(next));
    } catch {
      // Best-effort persistence only.
    }
  }

  function removeFromDisk(sessionKey: string) {
    try {
      removePersistedValue(storageKey(sessionKey));
    } catch {
      // Best-effort persistence only.
    }
  }

  return {
    get(sessionKey: string): T {
      const cached = cache.get(sessionKey);
      if (cached) {
        return cached;
      }
      const hydrated = readFromDisk(sessionKey);
      const next = hydrated ?? options.createDefault();
      cache.set(sessionKey, next);
      return next;
    },
    set(sessionKey: string, next: T) {
      cache.set(sessionKey, next);
      writeToDisk(sessionKey, next);
    },
    clear(sessionKey: string) {
      cache.delete(sessionKey);
      removeFromDisk(sessionKey);
    },
    resetForTests() {
      cache.clear();
    },
  };
}
