function readLegacyLocalStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearLegacyLocalStorageValue(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort legacy cleanup only.
  }
}

export function readPersistedValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.orxa?.persistence;
  if (bridge) {
    const current = bridge.get(key);
    if (current !== null) {
      return current;
    }
    const legacy = readLegacyLocalStorageValue(key);
    if (legacy !== null) {
      bridge.set(key, legacy);
      clearLegacyLocalStorageValue(key);
      return legacy;
    }
    return null;
  }

  return readLegacyLocalStorageValue(key);
}

export function writePersistedValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  const bridge = window.orxa?.persistence;
  if (bridge) {
    bridge.set(key, value);
    clearLegacyLocalStorageValue(key);
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

export function removePersistedValue(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  const bridge = window.orxa?.persistence;
  if (bridge) {
    bridge.remove(key);
  }
  clearLegacyLocalStorageValue(key);
}
