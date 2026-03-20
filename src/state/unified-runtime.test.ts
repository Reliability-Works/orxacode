import { beforeEach, describe, expect, it } from "vitest";
import { deriveUnreadState, deriveUnifiedSessionStatus } from "./unified-runtime";
import { buildCodexSessionStatus, useUnifiedRuntimeStore } from "./unified-runtime-store";

describe("unified runtime derivation", () => {
  beforeEach(() => {
    useUnifiedRuntimeStore.setState({
      activeWorkspaceDirectory: undefined,
      activeSessionID: undefined,
      pendingSessionId: undefined,
      activeProvider: undefined,
      projectDataByDirectory: {},
      workspaceMetaByDirectory: {},
      opencodeSessions: {},
      codexSessions: {},
      claudeSessions: {},
      sessionReadTimestamps: {},
      collapsedProjects: {},
    });
  });

  it("treats newer activity than last read as unread for inactive sessions", () => {
    expect(deriveUnreadState(200, 100, false)).toBe(true);
    expect(deriveUnreadState(200, 250, false)).toBe(false);
    expect(deriveUnreadState(200, undefined, true)).toBe(false);
  });

  it("prioritizes awaiting over busy and unread", () => {
    expect(
      deriveUnifiedSessionStatus({
        busy: true,
        awaiting: true,
        planReady: true,
        activityAt: 300,
        lastReadAt: 100,
        isActive: false,
      }),
    ).toMatchObject({
      type: "awaiting",
      busy: true,
      awaiting: true,
      unread: true,
      planReady: true,
    });
  });

  it("marks plan ready when the session is settled and unseen", () => {
    expect(
      deriveUnifiedSessionStatus({
        busy: false,
        awaiting: false,
        planReady: true,
        activityAt: 300,
        lastReadAt: 200,
        isActive: false,
      }),
    ).toMatchObject({
      type: "plan_ready",
      unread: true,
      planReady: true,
    });
  });

  it("does not crash when a codex session exists in metadata before runtime hydration", () => {
    expect(() => buildCodexSessionStatus("codex::/tmp/workspace::thread-1", false)).not.toThrow();
    expect(buildCodexSessionStatus("codex::/tmp/workspace::thread-1", false)).toMatchObject({
      type: "none",
      busy: false,
      awaiting: false,
      unread: false,
      planReady: false,
      activityAt: 0,
    });
  });
});
