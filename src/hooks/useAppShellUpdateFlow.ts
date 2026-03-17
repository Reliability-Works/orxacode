import { useCallback, useState } from "react";
import type { OrxaEvent } from "@shared/ipc";

export type AppShellUpdateProgressState = {
  phase: "downloading" | "installing" | "error";
  message: string;
  percent?: number;
  version?: string;
};

type UpdaterTelemetryPayload = Extract<OrxaEvent, { type: "updater.telemetry" }>["payload"];

type UseAppShellUpdateFlowInput = {
  setStatusLine: (status: string) => void;
};

export function useAppShellUpdateFlow(input: UseAppShellUpdateFlowInput) {
  const { setStatusLine } = input;
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);
  const [updateProgressState, setUpdateProgressState] = useState<AppShellUpdateProgressState | null>(null);

  const handleUpdaterTelemetry = useCallback((payload: UpdaterTelemetryPayload) => {
    if (payload.phase === "check.start") {
      setStatusLine("Checking for updates...");
      return;
    }
    if (payload.phase === "update.available") {
      if (payload.version) {
        setAvailableUpdateVersion(payload.version);
        setStatusLine(`Update available: ${payload.version}`);
      }
      return;
    }
    if (payload.phase === "check.success") {
      const timing = typeof payload.durationMs === "number" ? ` (${Math.round(payload.durationMs)}ms)` : "";
      if (payload.version) {
        setAvailableUpdateVersion(payload.version);
        setStatusLine(`Update available: ${payload.version}${timing}`);
      } else if (payload.manual) {
        setStatusLine(`Update check complete${timing}`);
      }
      return;
    }
    if (payload.phase === "check.error") {
      setStatusLine(payload.message ? `Update check failed: ${payload.message}` : "Update check failed");
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
      setStatusLine("Update downloaded.");
      return;
    }
    if (payload.phase === "install.start") {
      setUpdateInstallPending(false);
      setAvailableUpdateVersion(null);
      setUpdateProgressState({
        phase: "installing",
        message: "Installing update...",
        percent: 100,
        version: payload.version,
      });
      setStatusLine("Installing update...");
    }
  }, [setStatusLine, updateInstallPending]);

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
    updateInstallPending,
    updateProgressState,
    setUpdateProgressState,
    handleUpdaterTelemetry,
    downloadAndInstallUpdate,
    dismissUpdateProgressError,
  };
}
