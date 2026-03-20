import { useCallback, useMemo, useRef, useState } from "react";

export type AppShellSessionFeedNotice = {
  id: string;
  time: number;
  label: string;
  detail?: string;
  tone?: "info" | "error";
};

type ManualSessionStopState = {
  requestedAt: number;
  noticeEmitted: boolean;
};

type UseAppShellSessionFeedNoticesInput = {
  activeProjectDir?: string;
  activeSessionID?: string;
};

const DUPLICATE_NOTICE_WINDOW_MS = 2_500;
const MAX_NOTICES_PER_SESSION = 8;
const MANUAL_STOP_RETENTION_MS = 120_000;

function buildSessionKey(directory: string, sessionID: string) {
  return `${directory}::${sessionID}`;
}

function nextNoticeID() {
  return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function useAppShellSessionFeedNotices(input: UseAppShellSessionFeedNoticesInput) {
  const [sessionFeedNotices, setSessionFeedNotices] = useState<Record<string, AppShellSessionFeedNotice[]>>({});
  const manualSessionStopsRef = useRef<Record<string, ManualSessionStopState>>({});

  const addSessionFeedNotice = useCallback(
    (directory: string, sessionID: string, notice: Omit<AppShellSessionFeedNotice, "id" | "time">) => {
      const key = buildSessionKey(directory, sessionID);
      setSessionFeedNotices((current) => {
        const nextNotice: AppShellSessionFeedNotice = {
          id: nextNoticeID(),
          time: Date.now(),
          ...notice,
        };
        const existing = current[key] ?? [];
        const duplicate = existing.some(
          (item) =>
            item.label === nextNotice.label &&
            item.detail === nextNotice.detail &&
            Math.abs(item.time - nextNotice.time) < DUPLICATE_NOTICE_WINDOW_MS,
        );
        if (duplicate) {
          return current;
        }
        const trimmed = [...existing, nextNotice].slice(-MAX_NOTICES_PER_SESSION);
        return {
          ...current,
          [key]: trimmed,
        };
      });
    },
    [],
  );

  const activeSessionNoticeKey = useMemo(() => {
    if (!input.activeProjectDir || !input.activeSessionID) {
      return null;
    }
    return buildSessionKey(input.activeProjectDir, input.activeSessionID);
  }, [input.activeProjectDir, input.activeSessionID]);

  const activeSessionNotices = useMemo(
    () => (activeSessionNoticeKey ? (sessionFeedNotices[activeSessionNoticeKey] ?? []) : []),
    [activeSessionNoticeKey, sessionFeedNotices],
  );

  const markManualSessionStopRequested = useCallback((directory: string, sessionID: string, requestedAt = Date.now()) => {
    manualSessionStopsRef.current[buildSessionKey(directory, sessionID)] = {
      requestedAt,
      noticeEmitted: false,
    };
  }, []);

  const pruneManualSessionStops = useCallback((now = Date.now()) => {
    for (const [key, state] of Object.entries(manualSessionStopsRef.current)) {
      if (now - state.requestedAt > MANUAL_STOP_RETENTION_MS) {
        delete manualSessionStopsRef.current[key];
      }
    }
  }, []);

  const getManualSessionStopState = useCallback((sessionKey: string | null) => {
    if (!sessionKey) {
      return undefined;
    }
    return manualSessionStopsRef.current[sessionKey];
  }, []);

  const markManualSessionStopNoticeEmitted = useCallback((sessionKey: string, requestedAt = Date.now()) => {
    manualSessionStopsRef.current[sessionKey] = {
      requestedAt,
      noticeEmitted: true,
    };
  }, []);

  return {
    addSessionFeedNotice,
    activeSessionNotices,
    activeSessionNoticeKey,
    buildSessionKey,
    getManualSessionStopState,
    markManualSessionStopNoticeEmitted,
    markManualSessionStopRequested,
    pruneManualSessionStops,
    sessionFeedNotices,
  };
}
