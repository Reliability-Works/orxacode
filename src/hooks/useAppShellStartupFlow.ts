import { useEffect, useMemo, useRef, useState } from "react";

export type AppShellStartupState = {
  phase: "running" | "done";
  message: string;
  completed: number;
  total: number;
};

type StartupStep = {
  message: string;
  action: () => Promise<unknown>;
};

type UseAppShellStartupFlowInput = {
  initialMessage: string;
  totalSteps: number;
  stepTimeoutMs: number;
  steps: StartupStep[];
  onStepError: (error: unknown) => void;
};

export function useAppShellStartupFlow(input: UseAppShellStartupFlowInput) {
  const {
    initialMessage,
    onStepError,
    stepTimeoutMs,
    steps,
    totalSteps,
  } = input;
  const [startupState, setStartupState] = useState<AppShellStartupState>({
    phase: "running",
    message: initialMessage,
    completed: 0,
    total: totalSteps,
  });
  const startupRanRef = useRef(false);
  const startupCompletedRef = useRef(false);

  useEffect(() => {
    if (startupRanRef.current) {
      return;
    }
    startupRanRef.current = true;
    startupCompletedRef.current = false;
    let cancelled = false;
    let completed = 0;
    const total = totalSteps;

    const updateStartup = (message: string, phase: AppShellStartupState["phase"] = "running") => {
      if (cancelled) {
        return;
      }
      setStartupState({
        phase,
        message,
        completed,
        total,
      });
    };

    const markStepDone = (message: string) => {
      completed += 1;
      updateStartup(message);
    };

    const runStep = async (step: StartupStep): Promise<void> => {
      updateStartup(step.message);
      let timeoutID: number | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          timeoutID = window.setTimeout(() => {
            reject(new Error(`${step.message} timed out after ${stepTimeoutMs}ms`));
          }, stepTimeoutMs);
          void step.action()
            .then(() => resolve())
            .catch((error) => reject(error));
        });
      } catch (error) {
        onStepError(error);
      } finally {
        if (timeoutID !== undefined) {
          window.clearTimeout(timeoutID);
        }
        markStepDone(step.message);
      }
    };

    void (async () => {
      try {
        for (const step of steps) {
          await runStep(step);
        }
      } finally {
        startupCompletedRef.current = true;
        updateStartup("Initialization complete", "done");
      }
    })();

    return () => {
      cancelled = true;
      if (!startupCompletedRef.current) {
        startupRanRef.current = false;
      }
    };
  }, [onStepError, stepTimeoutMs, steps, totalSteps]);

  const startupProgressPercent = useMemo(() => {
    if (startupState.total <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((startupState.completed / startupState.total) * 100)));
  }, [startupState.completed, startupState.total]);

  return {
    startupState,
    startupProgressPercent,
  };
}
