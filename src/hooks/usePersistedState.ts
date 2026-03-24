import { useCallback, useEffect, useState } from "react";
import { readPersistedValue as readStoredValue, writePersistedValue } from "../lib/persistence";

type PersistedStateOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

function defaultSerialize<T>(value: T) {
  return JSON.stringify(value);
}

function defaultDeserialize<T>(value: string) {
  return JSON.parse(value) as T;
}

function readPersistedState<T>(key: string, defaultValue: T, deserialize: (value: string) => T) {
  if (typeof window === "undefined") {
    return defaultValue;
  }

  try {
    const raw = readStoredValue(key);
    if (raw === null) {
      return defaultValue;
    }
    return deserialize(raw);
  } catch {
    return defaultValue;
  }
}

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: PersistedStateOptions<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const serialize = options?.serialize ?? defaultSerialize<T>;
  const deserialize = options?.deserialize ?? defaultDeserialize<T>;
  const [hydratedKey, setHydratedKey] = useState(key);

  const [state, setState] = useState<T>(() => {
    return readPersistedState(key, defaultValue, deserialize);
  });

  useEffect(() => {
    if (hydratedKey === key) {
      return;
    }

    setState(readPersistedState(key, defaultValue, deserialize));
    setHydratedKey(key);
  }, [defaultValue, deserialize, hydratedKey, key]);

  useEffect(() => {
    if (hydratedKey !== key) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    try {
      writePersistedValue(key, serialize(state));
    } catch {
      // no-op
    }
  }, [hydratedKey, key, serialize, state]);

  const updateState = useCallback((value: T | ((prev: T) => T)) => {
    setState((previous) => (typeof value === "function" ? (value as (prev: T) => T)(previous) : value));
  }, []);

  return [state, updateState];
}
