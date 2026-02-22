import { useCallback, useEffect, useRef, useState } from "react";

type PersistedStateOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  options?: PersistedStateOptions<T>,
): [T, (value: T | ((prev: T) => T)) => void] {
  const defaultSerializer = (value: T) => JSON.stringify(value);
  const defaultDeserializer = (value: string) => JSON.parse(value) as T;

  const serializerRef = useRef<(value: T) => string>(
    options?.serialize ?? defaultSerializer,
  );

  const [state, setState] = useState<T>(() => {
    const deserialize = options?.deserialize ?? defaultDeserializer;

    if (typeof window === "undefined") {
      return defaultValue;
    }

    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return defaultValue;
      }
      return deserialize(raw);
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(key, serializerRef.current(state));
    } catch {
      // no-op
    }
  }, [key, state]);

  const updateState = useCallback((value: T | ((prev: T) => T)) => {
    setState((previous) => (typeof value === "function" ? (value as (prev: T) => T)(previous) : value));
  }, []);

  return [state, updateState];
}
