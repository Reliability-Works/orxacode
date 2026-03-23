import { useCallback, useEffect, useRef, useState } from "react";
import type { OrxaEvent } from "@shared/ipc";

export type AppShellUpdateProgressState = {
  phase: "downloading" | "installing" | "error";
  message: string;
  percent?: number;
  version?: string;
};

export type AppShellUpdateStatusMessage = {
  text: string;
  tone: "neutral" | "success";
};

type UpdaterTelemetryPayload = Extract<OrxaEvent, { type: "updater.telemetry" }>["payload"];

type UseAppShellUpdateFlowInput = {
  setStatusLine: (status: string) => void;
};

export function useAppShellUpdateFlow(input: UseAppShellUpdateFlowInput) {
  const { setStatusLine } = input;
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);
  const [updateProgressState, setUpdateProgressState] = useState<AppShellUpdateProgressState | null>(null);
  const [updateStatusMessage, setUpdateStatusMessage] = useState<AppShellUpdateStatusMessage | null>(null);
  const statusMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusMessageTimerRef.current) {
        clearTimeout(statusMessageTimerRef.current);
      }
    };
  }, []);

  const clearStatusMessageTimer = useCallback(() => {
    if (statusMessageTimerRef.current) {
      clearTimeout(statusMessageTimerRef.current);
      statusMessageTimerRef.current = null;
    }
  }, []);

  const showTemporaryStatusMessage = useCallback((message: AppShellUpdateStatusMessage, timeoutMs = 2800) => {
    clearStatusMessageTimer();
    setUpdateStatusMessage(message);
    statusMessageTimerRef.current = setTimeout(() => {
      setUpdateStatusMessage((current) => (current?.text === message.text ? null : current));
      statusMessageTimerRef.current = null;
    }, timeoutMs);
  }, [clearStatusMessageTimer]);

  const handleUpdaterTelemetry = useCallback((payload: UpdaterTelemetryPayload) => {
    if (payload.phase === "check.start") {
      clearStatusMessageTimer();
      setIsCheckingForUpdates(true);
      setUpdateStatusMessage(null);
      setStatusLine("Checking for updates...");
      return;
    }
    if (payload.phase === "update.available") {
      clearStatusMessageTimer();
      setIsCheckingForUpdates(false);
      if (payload.version) {
        setAvailableUpdateVersion(payload.version);
        setUpdateStatusMessage({ text: "Update found", tone: "success" });
        setStatusLine(`Update available: ${payload.version}`);
      }
      return;
    }
    if (payload.phase === "check.success") {
      setIsCheckingForUpdates(false);
      const timing = typeof payload.durationMs === "number" ? ` (${Math.round(payload.durationMs)}ms)` : "";
      if (payload.version) {
        clearStatusMessageTimer();
        setAvailableUpdateVersion(payload.version);
        setUpdateStatusMessage({ text: "Update found", tone: "success" });
        setStatusLine(`Update available: ${payload.version}${timing}`);
      } else if (payload.manual) {
        setAvailableUpdateVersion(null);
        showTemporaryStatusMessage({ text: "Up to date", tone: "neutral" });
        setStatusLine(`Up to date${timing}`);
      }
      return;
    }
    if (payload.phase === "check.error") {
      setIsCheckingForUpdates(false);
      setStatusLine(payload.message ? `Update check failed: ${payload.message}` : "Update check failed");
      showTemporaryStatusMessage({ text: "Check failed", tone: "neutral" });
      if (updateInstallPending) {
        setUpdateInstallPending(false);
        setUpdateProgressState({
          phase: "error",
          message: payload.message ?? "Unable to update right now.",
        });
      }
      return;
    }
    if (payload.phase === "download.start") {
      clearStatusMessageTimer();
      setUpdateStatusMessage(null);
      setUpdateProgressState({
        phase: "downloading",
        message: "Downloading update...",
        percent: 0,
        version: payload.version,
      });
      return;
    }
    if (payload.phase === "download.progress") {
      setUpdateProgressState({
        phase: "downloading",
        message: "Downloading update...",
        percent: payload.percent,
        version: payload.version,
      });
      return;
    }
    if (payload.phase === "download.complete") {
      clearStatusMessageTimer();
      setUpdateStatusMessage(null);
      setStatusLine("Update downloaded.");
      return;
    }
    if (payload.phase === "install.start") {
      setUpdateInstallPending(false);
      setAvailableUpdateVersion(null);
      setUpdateStatusMessage(null);
      setUpdateProgressState({
        phase: "installing",
        message: "Installing update...",
        percent: 100,
        version: payload.version,
      });
      setStatusLine("Installing update...");
    }
  }, [clearStatusMessageTimer, setStatusLine, showTemporaryStatusMessage, updateInstallPending]);

  const checkForUpdates = useCallback(async () => {
    if (isCheckingForUpdates || updateInstallPending) {
      return;
    }
    clearStatusMessageTimer();
    setIsCheckingForUpdates(true);
    setUpdateStatusMessage(null);
    try {
      const result = await window.orxa.updates.checkNow();
      if (result.status === "started") {
        return;
      }
      setIsCheckingForUpdates(false);
      if (result.status === "skipped") {
        if (/already in progress/i.test(result.message ?? "")) {
          showTemporaryStatusMessage({ text: "Already checking", tone: "neutral" });
        } else if (/only in packaged builds/i.test(result.message ?? "")) {
          showTemporaryStatusMessage({ text: "Packaged builds only", tone: "neutral" });
        } else if (result.message) {
          showTemporaryStatusMessage({ text: result.message, tone: "neutral" });
        }
      } else {
        showTemporaryStatusMessage({ text: "Check failed", tone: "neutral" });
      }
      if (result.message) {
        setStatusLine(result.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setIsCheckingForUpdates(false);
      showTemporaryStatusMessage({ text: "Check failed", tone: "neutral" });
      setStatusLine(detail);
    }
  }, [clearStatusMessageTimer, isCheckingForUpdates, setStatusLine, showTemporaryStatusMessage, updateInstallPending]);

  const downloadAndInstallUpdate = useCallback(async () => {
    if (updateInstallPending) {
      return;
    }
    setUpdateInstallPending(true);
    setUpdateProgressState((current) => current ?? { phase: "downloading", message: "Preparing update download...", percent: 0 });
    try {
      const result = await window.orxa.updates.downloadAndInstall();
      if (result.status === "error") {
        setUpdateInstallPending(false);
        setUpdateProgressState({
          phase: "error",
          message: result.message ?? "Unable to start update.",
        });
      } else if (result.status === "skipped") {
        const detail = result.message ?? "Unable to start update.";
        if (/already in progress/i.test(detail)) {
          setUpdateProgressState({
            phase: "downloading",
            message: "Downloading update...",
            percent: undefined,
            version: availableUpdateVersion ?? undefined,
          });
        } else {
          setUpdateInstallPending(false);
          setUpdateProgressState({
            phase: "error",
            message: detail,
          });
        }
      } else {
        setUpdateProgressState({
          phase: "downloading",
          message: "Downloading update...",
          percent: 0,
          version: availableUpdateVersion ?? undefined,
        });
      }
      if (result.message) {
        setStatusLine(result.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setUpdateInstallPending(false);
      setUpdateProgressState({
        phase: "error",
        message: detail,
      });
      setStatusLine(detail);
    }
  }, [availableUpdateVersion, setStatusLine, updateInstallPending]);

  const dismissUpdateProgressError = useCallback(() => {
    setUpdateProgressState((current) => {
      if (!current || current.phase !== "error") {
        return current;
      }
      return null;
    });
  }, []);

  return {
    availableUpdateVersion,
    isCheckingForUpdates,
    updateInstallPending,
    updateProgressState,
    updateStatusMessage,
    setUpdateProgressState,
    handleUpdaterTelemetry,
    checkForUpdates,
    downloadAndInstallUpdate,
    dismissUpdateProgressError,
  };
}
