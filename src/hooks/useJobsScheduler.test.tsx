import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../components/JobsBoard";
import { useJobsScheduler } from "./useJobsScheduler";

describe("useJobsScheduler", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("runs jobs without forcing a hardcoded agent", async () => {
    const createSessionMock = vi.fn(async () => ({
      id: "job-session-1",
      slug: "job-session-1",
      title: "Job: scan",
      time: { created: Date.now(), updated: Date.now() },
    }));
    const sendPromptMock = vi.fn(async (request: { directory: string; sessionID: string; text: string; agent?: string }) => {
      void request;
      return true;
    });
    const refreshProjectMock = vi.fn(async () => ({
      sessionStatus: { "job-session-1": { type: "idle" } },
    }));

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        opencode: {
          createSession: createSessionMock,
          sendPrompt: sendPromptMock,
          refreshProject: refreshProjectMock,
          loadMessages: vi.fn(async () => []),
        },
      },
    });

    const { result } = renderHook(() => useJobsScheduler());
    const job: JobRecord = {
      id: "job-1",
      name: "scan",
      projectDir: "/tmp/project",
      prompt: "Scan this workspace.",
      schedule: { type: "interval", intervalMinutes: 60 },
      enabled: true,
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
    };

    await act(async () => {
      await result.current.runScheduledJob(job);
    });

    expect(createSessionMock).toHaveBeenCalledWith("/tmp/project", "Job: scan");
    expect(sendPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: "/tmp/project",
        sessionID: "job-session-1",
        text: "Scan this workspace.",
      }),
    );
    expect(sendPromptMock).toHaveBeenCalledTimes(1);
    const sentPrompt = sendPromptMock.mock.calls[0]?.[0] as { agent?: unknown } | undefined;
    expect(sentPrompt).toBeDefined();
    expect(sentPrompt?.agent).toBeUndefined();
  });
});
