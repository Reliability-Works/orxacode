import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useBackgroundSessionDescriptors } from "./useBackgroundSessionDescriptors";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

describe("useBackgroundSessionDescriptors", () => {
  const sessionKey = "/repo/project::session-1";

  beforeEach(() => {
    useUnifiedRuntimeStore.setState({
      opencodeSessions: {},
      codexSessions: {},
      claudeSessions: {},
      claudeChatSessions: {},
      projectDataByDirectory: {},
      workspaceMetaByDirectory: {},
      activeWorkspaceDirectory: undefined,
      activeSessionID: undefined,
      activeProvider: undefined,
      pendingSessionId: undefined,
    });
  });

  it("recomputes active background agents when codex runtime state changes without changing session identity", async () => {
    useUnifiedRuntimeStore.setState({
      codexSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/project",
          connectionStatus: "connected",
          thread: { id: "thread-1", preview: "Main thread", modelProvider: "openai", createdAt: 1 },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [],
          activeSubagentThreadId: null,
        },
      },
    });

    const { result } = renderHook(() =>
      useBackgroundSessionDescriptors({
        activeProjectDir: "/repo/project",
        activeSessionID: "session-1",
        activeSessionKey: sessionKey,
        activeSessionType: "codex",
        cachedProjects: {},
        archivedBackgroundAgentIds: {},
        getSessionType: () => "codex",
        normalizePresentationProvider: (sessionType) =>
          sessionType === "codex" || sessionType === "claude" || sessionType === "claude-chat"
            ? sessionType
            : sessionType
              ? "opencode"
              : undefined,
      }),
    );

    expect(result.current.activeBackgroundAgents).toEqual([]);

    useUnifiedRuntimeStore.setState({
      codexSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/project",
          connectionStatus: "connected",
          thread: { id: "thread-1", preview: "Main thread", modelProvider: "openai", createdAt: 1 },
          runtimeSnapshot: null,
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: true,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [
            {
              threadId: "child-1",
              nickname: "Scout",
              role: "explorer",
              status: "thinking",
              statusText: "is thinking",
              spawnedAt: 2,
            },
          ],
          activeSubagentThreadId: null,
        },
      },
    });

    await waitFor(() => {
      expect(result.current.activeBackgroundAgents).toEqual([
        expect.objectContaining({
          id: "child-1",
          name: "Scout",
          status: "thinking",
        }),
      ]);
    });
  });
});
