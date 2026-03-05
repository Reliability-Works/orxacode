import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../components/JobsBoard";
import { useJobsScheduler } from "./useJobsScheduler";

describe("useJobsScheduler", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults browser and context mode to false for stored jobs that omit those fields", () => {
    const stored = [
      {
        id: "legacy-job-1",
        name: "Legacy job",
        projectDir: "/tmp/project",
        prompt: "Scan this workspace.",
        schedule: { type: "interval", intervalMinutes: 60 },
        enabled: true,
        createdAt: Date.now() - 1_000,
        updatedAt: Date.now() - 1_000,
      },
    ];
    window.localStorage.setItem("orxa:jobs:v1", JSON.stringify(stored));

    const { result } = renderHook(() => useJobsScheduler());
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0]?.browserModeEnabled).toBe(false);
    expect(result.current.jobs[0]?.contextModeEnabled).toBe(false);
  });

  it("runs jobs with prompt source, context mode, and browser addendum handling", async () => {
    const createSessionMock = vi.fn(async () => ({
      id: "job-session-1",
      slug: "job-session-1",
      title: "Job: scan",
      time: { created: Date.now(), updated: Date.now() },
    }));
    const sendPromptMock = vi.fn(async (request: {
      directory: string;
      sessionID: string;
      text: string;
      agent?: string;
      promptSource?: "job" | "user" | "machine";
      contextModeEnabled?: boolean;
    }) => {
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
      browserModeEnabled: true,
      contextModeEnabled: true,
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
        promptSource: "job",
        contextModeEnabled: true,
      }),
    );
    expect(sendPromptMock).toHaveBeenCalledTimes(1);
    const sentPrompt = sendPromptMock.mock.calls[0]?.[0] as
      | { agent?: unknown; system?: string; promptSource?: string; contextModeEnabled?: boolean }
      | undefined;
    expect(sentPrompt).toBeDefined();
    expect(sentPrompt?.agent).toBeUndefined();
    expect(sentPrompt?.promptSource).toBe("job");
    expect(sentPrompt?.contextModeEnabled).toBe(true);
    expect(sentPrompt?.system).toContain("<orxa_browser_action>");
    expect(sentPrompt?.system).toContain("[ORXA_BROWSER_RESULT]");
  });

  it("runs browser-disabled jobs without a browser system addendum", async () => {
    const createSessionMock = vi.fn(async () => ({
      id: "job-session-1",
      slug: "job-session-1",
      title: "Job: scan",
      time: { created: Date.now(), updated: Date.now() },
    }));
    const sendPromptMock = vi.fn(async (request: {
      directory: string;
      sessionID: string;
      text: string;
      system?: string;
      promptSource?: "job" | "user" | "machine";
      contextModeEnabled?: boolean;
    }) => {
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
      browserModeEnabled: false,
      contextModeEnabled: false,
      schedule: { type: "interval", intervalMinutes: 60 },
      enabled: true,
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 1_000,
    };

    await act(async () => {
      await result.current.runScheduledJob(job);
    });

    expect(sendPromptMock).toHaveBeenCalledTimes(1);
    const sentPrompt = sendPromptMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(sentPrompt).toBeDefined();
    expect(sentPrompt?.promptSource).toBe("job");
    expect(sentPrompt?.contextModeEnabled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sentPrompt ?? {}, "system")).toBe(false);
  });
});
