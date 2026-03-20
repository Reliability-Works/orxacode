import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppShellStartupFlow } from "./useAppShellStartupFlow";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAppShellStartupFlow", () => {
  it("does not restart when step callbacks change during startup and uses the latest later step", async () => {
    const firstStep = deferred();
    const stepOne = vi.fn(async () => {
      await firstStep.promise;
    });
    const initialStepTwo = vi.fn(async () => undefined);
    const updatedStepTwo = vi.fn(async () => undefined);
    const onStepError = vi.fn();

    const { result, rerender } = renderHook(
      ({ revision }) => useAppShellStartupFlow({
        initialMessage: "Initializing Orxa Code…",
        totalSteps: 2,
        stepTimeoutMs: 1_000,
        steps: [
          { message: "Step one", action: stepOne },
          { message: "Step two", action: revision === 1 ? initialStepTwo : updatedStepTwo },
        ],
        onStepError,
      }),
      { initialProps: { revision: 1 } },
    );

    expect(result.current.startupState.phase).toBe("running");
    expect(result.current.startupState.message).toBe("Step one");

    rerender({ revision: 2 });
    firstStep.resolve();

    await waitFor(() => {
      expect(result.current.startupState.phase).toBe("done");
    });

    expect(stepOne).toHaveBeenCalledTimes(1);
    expect(initialStepTwo).not.toHaveBeenCalled();
    expect(updatedStepTwo).toHaveBeenCalledTimes(1);
    expect(result.current.startupProgressPercent).toBe(100);
    expect(onStepError).not.toHaveBeenCalled();
  });
});
