import { useCallback, useEffect, useRef, useState } from "react";

export type AppShellToastTone = "info" | "warning" | "error";

export type AppShellToast = {
  id: string;
  message: string;
  tone: AppShellToastTone;
};

type UseAppShellToastsInput = {
  statusLine: string;
  toneForStatusLine: (status: string) => "error" | "warning" | null;
};

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_TOAST_DURATION_MS = 5_200;

function nextToastID() {
  return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function useAppShellToasts(input: UseAppShellToastsInput) {
  const { statusLine, toneForStatusLine } = input;
  const [toasts, setToasts] = useState<AppShellToast[]>([]);
  const toastTimersRef = useRef<Record<string, number>>({});

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete toastTimersRef.current[id];
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((message: string, tone: AppShellToastTone = "info", durationMs = DEFAULT_TOAST_DURATION_MS) => {
    const normalized = message.trim();
    if (!normalized) {
      return;
    }
    const id = nextToastID();
    setToasts((current) => {
      const duplicate = current.find((item) => item.message === normalized && item.tone === tone);
      if (duplicate) {
        return current;
      }
      return [...current, { id, message: normalized, tone }].slice(-MAX_VISIBLE_TOASTS);
    });
    toastTimersRef.current[id] = window.setTimeout(() => {
      dismissToast(id);
    }, durationMs);
  }, [dismissToast]);

  useEffect(() => {
    return () => {
      Object.values(toastTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      toastTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const message = statusLine.trim();
    if (!message) {
      return;
    }
    const tone = toneForStatusLine(message);
    if (tone) {
      pushToast(message, tone);
    }
  }, [pushToast, statusLine, toneForStatusLine]);

  return {
    toasts,
    dismissToast,
    pushToast,
  };
}
