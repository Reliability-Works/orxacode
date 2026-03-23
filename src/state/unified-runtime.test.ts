import type { SessionMessageBundle, SessionRuntimeSnapshot } from "@shared/ipc";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveUnreadState, deriveUnifiedSessionStatus } from "./unified-runtime";
import {
  buildCodexSessionStatus,
  buildOpencodeSessionStatus,
  selectActiveBackgroundAgentsPresentation,
  selectActiveComposerPresentation,
  selectSessionPresentation,
  selectSidebarSessionPresentation,
  useUnifiedRuntimeStore,
} from "./unified-runtime-store";

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

  it("suppresses sidebar indicators for Claude sessions", () => {
    useUnifiedRuntimeStore.setState({
      claudeSessions: {
        "claude::/tmp/workspace::thread-1": {
          key: "claude::/tmp/workspace::thread-1",
          directory: "/tmp/workspace",
          busy: true,
          awaiting: false,
          activityAt: 100,
        },
      },
    });

    expect(
      selectSidebarSessionPresentation({
        provider: "claude",
        directory: "/tmp/workspace",
        sessionID: "thread-1",
        updatedAt: 100,
        isActive: false,
        sessionKey: "claude::/tmp/workspace::thread-1",
      }),
    ).toMatchObject({
      indicator: "none",
      statusType: "busy",
    });
  });

  it("falls back to Codex child threads for background agents when subagent state is empty", () => {
    useUnifiedRuntimeStore.setState({
      codexSessions: {
        "codex::/tmp/workspace::thread-1": {
          key: "codex::/tmp/workspace::thread-1",
          directory: "/tmp/workspace",
          connectionStatus: "connected",
          thread: { id: "thread-1", preview: "Main thread", modelProvider: "openai", createdAt: 1 },
          runtimeSnapshot: {
            thread: { id: "thread-1", preview: "Main thread", modelProvider: "openai", createdAt: 1 },
            childThreads: [{
              id: "child-1",
              preview: "Explore repo structure",
              modelProvider: "openai",
              createdAt: 2,
              status: { type: "busy" },
            }],
          },
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: true,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [],
          activeSubagentThreadId: null,
        },
      },
    });

    expect(
      selectActiveBackgroundAgentsPresentation({
        provider: "codex",
        sessionKey: "codex::/tmp/workspace::thread-1",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "child-1",
        sessionID: "child-1",
        name: "Explore repo structure",
        status: "thinking",
      }),
    ]);
  });

  it("filters out the current Codex thread from background agents even before thread hydration completes", () => {
    useUnifiedRuntimeStore.setState({
      codexSessions: {
        "codex::/tmp/workspace::thread-1": {
          key: "codex::/tmp/workspace::thread-1",
          directory: "/tmp/workspace",
          connectionStatus: "connected",
          thread: null,
          runtimeSnapshot: {
            thread: { id: "thread-1", preview: "Main thread", modelProvider: "openai", createdAt: 1 },
            childThreads: [
              {
                id: "thread-1",
                preview: "Main thread",
                modelProvider: "openai",
                createdAt: 1,
                status: { type: "busy" },
              },
              {
                id: "child-1",
                preview: "Explore repo structure",
                modelProvider: "openai",
                createdAt: 2,
                status: { type: "busy" },
              },
            ],
          },
          messages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: true,
          planItems: [],
          dismissedPlanIds: [],
          subagents: [],
          activeSubagentThreadId: null,
        },
      },
    });

    expect(
      selectActiveBackgroundAgentsPresentation({
        provider: "codex",
        sessionKey: "codex::/tmp/workspace::thread-1",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "child-1",
        sessionID: "child-1",
      }),
    ]);
  });

  it("backfills opencode changed files and reasoning content from runtime artifacts", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "turn-1",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "turn-1",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "mkdir -p glowbook" },
              output: "",
              title: "mkdir -p glowbook",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];
    const runtimeSnapshot: SessionRuntimeSnapshot = {
      directory: "/tmp/workspace",
      sessionID: "session-1",
      session: null,
      sessionStatus: ({ type: "idle" } as unknown) as SessionRuntimeSnapshot["sessionStatus"],
      permissions: [],
      questions: [],
      commands: [],
      messages,
      sessionDiff: [
        {
          file: "glowbook/package.json",
          before: "",
          after: '{"name":"glowbook"}\n{"private":true}',
          additions: 2,
          deletions: 0,
          status: "added",
        },
      ],
      executionLedger: {
        cursor: 1,
        records: [
          {
            id: "reasoning-1",
            directory: "/tmp/workspace",
            sessionID: "session-1",
            timestamp: now + 5,
            kind: "reasoning",
            summary: "Reasoning update",
            detail: "I have created the folder and I am wiring glowbook/package.json next.",
            actor: { type: "main", name: "Builder" },
            turnID: "turn-1",
            eventID: "reasoning-1",
          },
        ],
      },
      changeProvenance: {
        cursor: 1,
        records: [
          {
            filePath: "glowbook/package.json",
            operation: "edit",
            actorType: "main",
            actorName: "Builder",
            turnID: "turn-1",
            eventID: "prov-1",
            timestamp: now + 6,
            reason: "Edited glowbook/package.json",
          },
        ],
      },
    };
    useUnifiedRuntimeStore.setState({
      opencodeSessions: {
        "opencode::/tmp/workspace::session-1": {
          key: "opencode::/tmp/workspace::session-1",
          directory: "/tmp/workspace",
          sessionID: "session-1",
          messages,
          todoItems: [],
          runtimeSnapshot,
        },
      },
    });

    const presentation = selectSessionPresentation({
      provider: "opencode",
      directory: "/tmp/workspace",
      sessionID: "session-1",
      assistantLabel: "Builder",
    });

    expect(presentation?.latestActivityContent).toContain("glowbook/package.json");
    expect(presentation?.latestActivity?.label).not.toBe("Reasoning update");
    expect(
      presentation?.rows.some(
        (row) =>
          row.kind === "diff-group" && row.files.some((file) => file.path === "glowbook/package.json"),
      ),
    ).toBe(true);
    const changedGroup = presentation?.rows.find((row) => row.kind === "diff-group");
    expect(changedGroup && "files" in changedGroup ? changedGroup.files[0]?.diff : undefined).toContain(
      '+{"private":true}',
    );
  });

  it("does not render orphan provenance-only changed files without a matching session turn", () => {
    const now = Date.now();
    const runtimeSnapshot: SessionRuntimeSnapshot = {
      directory: "/tmp/workspace",
      sessionID: "session-2",
      session: null,
      sessionStatus: undefined,
      permissions: [],
      questions: [],
      commands: [],
      messages: [],
      sessionDiff: [],
      executionLedger: { cursor: 0, records: [] },
      changeProvenance: {
        cursor: 1,
        records: [
          {
            filePath: "luxe-salon/convex/schema.ts",
            operation: "edit",
            actorType: "main",
            actorName: "Builder",
            turnID: "missing-turn",
            eventID: "prov-orphan-1",
            timestamp: now,
            reason: "Patch update",
          },
        ],
      },
    };

    useUnifiedRuntimeStore.setState({
      opencodeSessions: {
        "opencode::/tmp/workspace::session-2": {
          key: "opencode::/tmp/workspace::session-2",
          directory: "/tmp/workspace",
          sessionID: "session-2",
          messages: [],
          todoItems: [],
          runtimeSnapshot,
        },
      },
    });

    const presentation = selectSessionPresentation({
      provider: "opencode",
      directory: "/tmp/workspace",
      sessionID: "session-2",
      assistantLabel: "Builder",
    });

    expect(presentation?.rows.some((row) => row.kind === "diff-group")).toBe(false);
  });

  it("treats opencode sessions with running tool parts as busy even without session.status", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "turn-3",
          role: "assistant",
          sessionID: "session-3",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-running-1",
            type: "tool",
            sessionID: "session-3",
            messageID: "turn-3",
            callID: "call-running-1",
            tool: "write",
            state: {
              status: "running",
              input: { filePath: "/tmp/workspace/convex/schema.ts", content: "export default {}" },
              time: { start: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    useUnifiedRuntimeStore.setState({
      opencodeSessions: {
        "opencode::/tmp/workspace::session-3": {
          key: "opencode::/tmp/workspace::session-3",
          directory: "/tmp/workspace",
          sessionID: "session-3",
          messages,
          todoItems: [],
          runtimeSnapshot: {
            directory: "/tmp/workspace",
            sessionID: "session-3",
            session: null,
            sessionStatus: undefined,
            permissions: [],
            questions: [],
            commands: [],
            messages,
            sessionDiff: [],
            executionLedger: { cursor: 0, records: [] },
            changeProvenance: { cursor: 0, records: [] },
          },
        },
      },
    });

    expect(buildOpencodeSessionStatus("/tmp/workspace", "session-3", true)).toMatchObject({
      busy: true,
    });
    expect(
      selectActiveComposerPresentation({
        provider: "opencode",
        directory: "/tmp/workspace",
        sessionID: "session-3",
        sending: false,
      }),
    ).toMatchObject({
      busy: true,
    });
  });

  it("keeps the active opencode composer busy during a recent assistant turn even before session.status arrives", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "user-turn",
          role: "user",
          sessionID: "session-4",
          time: { created: now - 5_000, updated: now - 5_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [],
      },
      {
        info: ({
          id: "assistant-turn",
          role: "assistant",
          sessionID: "session-4",
          time: { created: now - 1_000, updated: now - 1_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "assistant-text-1",
            type: "text",
            sessionID: "session-4",
            messageID: "assistant-turn",
            text: "Now let me write all the files.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    useUnifiedRuntimeStore.setState({
      opencodeSessions: {
        "opencode::/tmp/workspace::session-4": {
          key: "opencode::/tmp/workspace::session-4",
          directory: "/tmp/workspace",
          sessionID: "session-4",
          messages,
          todoItems: [],
          runtimeSnapshot: {
            directory: "/tmp/workspace",
            sessionID: "session-4",
            session: null,
            sessionStatus: undefined,
            permissions: [],
            questions: [],
            commands: [],
            messages,
            sessionDiff: [],
            executionLedger: { cursor: 0, records: [] },
            changeProvenance: { cursor: 0, records: [] },
          },
        },
      },
    });

    expect(
      selectActiveComposerPresentation({
        provider: "opencode",
        directory: "/tmp/workspace",
        sessionID: "session-4",
        sending: false,
      }),
    ).toMatchObject({
      busy: true,
    });
  });

  it("keeps opencode changed files inline while busy even before session.status arrives", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "assistant-turn-inline",
          role: "assistant",
          sessionID: "session-5",
          time: { created: now - 1_000, updated: now - 1_000 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "assistant-text-inline",
            type: "text",
            sessionID: "session-5",
            messageID: "assistant-turn-inline",
            text: "Now let me create all the files.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    useUnifiedRuntimeStore.setState({
      activeWorkspaceDirectory: "/tmp/workspace",
      activeSessionID: "session-5",
      opencodeSessions: {
        "opencode::/tmp/workspace::session-5": {
          key: "opencode::/tmp/workspace::session-5",
          directory: "/tmp/workspace",
          sessionID: "session-5",
          messages,
          todoItems: [],
          runtimeSnapshot: {
            directory: "/tmp/workspace",
            sessionID: "session-5",
            session: null,
            sessionStatus: undefined,
            permissions: [],
            questions: [],
            commands: [],
            messages,
            sessionDiff: [
              {
                file: "luxe-studio/convex/schema.ts",
                before: "",
                after: "export default {};",
                additions: 1,
                deletions: 0,
                status: "added",
              },
            ],
            executionLedger: { cursor: 0, records: [] },
            changeProvenance: {
              cursor: 1,
              records: [
                {
                  filePath: "luxe-studio/convex/schema.ts",
                  operation: "create",
                  actorType: "main",
                  actorName: "Builder",
                  turnID: "assistant-turn-inline",
                  eventID: "prov-inline-1",
                  timestamp: now,
                  reason: "Created luxe-studio/convex/schema.ts",
                },
              ],
            },
          },
        },
      },
    });

    const presentation = selectSessionPresentation({
      provider: "opencode",
      directory: "/tmp/workspace",
      sessionID: "session-5",
      sessionKey: "/tmp/workspace::session-5",
      assistantLabel: "Builder",
    });

    expect(presentation?.rows.some((row) => row.kind === "diff-group")).toBe(false);
    expect(
      presentation?.rows.some(
        (row) =>
          (row.kind === "diff" && row.path === "luxe-studio/convex/schema.ts") ||
          (row.kind === "tool-group" && row.files.some((file) => file.path === "luxe-studio/convex/schema.ts")),
      ),
    ).toBe(true);
  });
});
