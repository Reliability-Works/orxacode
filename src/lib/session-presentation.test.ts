import { describe, expect, it } from "vitest";
import {
  buildComposerPresentation,
  buildCodexBackgroundAgentsFromChildThreads,
  buildCodexBackgroundAgentsFromMessages,
  buildOpencodeBackgroundAgents,
  buildSidebarSessionPresentation,
  extractReviewChangesFiles,
  extractCodexTodoItemsFromMessages,
  extractOpencodeTodoItems,
  filterOutCurrentCodexThreadAgent,
  groupAdjacentExploreRows,
  groupAdjacentTimelineExplorationRows,
  groupAdjacentToolCallRows,
  groupChangedFileRows,
  projectCodexSessionPresentation,
} from "./session-presentation";
import type { UnifiedTimelineRenderRow } from "../components/chat/unified-timeline-model";
import { createSessionMessageBundle } from "../test/session-message-bundle-factory";

describe("session-presentation", () => {
  it("groups changed file rows under the preceding assistant message", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        label: "Codex",
        sections: [{ id: "assistant-1:text", type: "text", content: "Updated files." }],
      },
      {
        id: "diff-1",
        kind: "diff",
        path: "src/a.ts",
        type: "modified",
        insertions: 1,
        deletions: 1,
      },
      {
        id: "diff-2",
        kind: "diff",
        path: "src/b.ts",
        type: "added",
        insertions: 2,
        deletions: 0,
      },
    ];

    const grouped = groupChangedFileRows(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[1]).toMatchObject({
      kind: "diff-group",
      title: "Changed files",
      files: [
        expect.objectContaining({ path: "src/a.ts" }),
        expect.objectContaining({ path: "src/b.ts" }),
      ],
    });
  });

  it("keeps assistant command rows ahead of grouped changed files", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        label: "Builder",
        sections: [{ id: "assistant-1:text", type: "text", content: "Installing dependencies." }],
      },
      {
        id: "tool-1",
        kind: "tool",
        title: "$ npm install",
        status: "completed",
        command: "npm install",
        defaultExpanded: false,
      },
      {
        id: "diff-1",
        kind: "diff",
        path: "package.json",
        type: "modified",
        insertions: 4,
        deletions: 1,
      },
    ];

    const grouped = groupChangedFileRows(rows);
    expect(grouped).toHaveLength(3);
    expect(grouped[1]).toMatchObject({ kind: "tool", title: "$ npm install" });
    expect(grouped[2]).toMatchObject({
      kind: "diff-group",
      files: [expect.objectContaining({ path: "package.json" })],
    });
  });

  it("can leave changed files inline when grouping is disabled", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        label: "Builder",
        sections: [{ id: "assistant-1:text", type: "text", content: "Updating files." }],
      },
      {
        id: "diff-1",
        kind: "diff",
        path: "package.json",
        type: "modified",
        insertions: 4,
        deletions: 1,
      },
    ];

    const grouped = groupChangedFileRows(rows, { enabled: false });
    expect(grouped).toEqual(rows);
  });

  it("projects Codex diffs through the shared changed-files grouping", () => {
    const presentation = projectCodexSessionPresentation([
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        content: "I updated the files.",
        timestamp: Date.now(),
      },
      {
        id: "diff-1",
        kind: "diff",
        path: "src/a.ts",
        type: "modified",
        status: "completed",
        insertions: 3,
        deletions: 1,
        timestamp: Date.now(),
      },
    ], false);

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "message" }),
        expect.objectContaining({
          kind: "diff-group",
          files: [expect.objectContaining({ path: "src/a.ts" })],
        }),
      ]),
    );
  });

  it("ignores unnamed Codex runtime child threads without metadata", () => {
    expect(buildCodexBackgroundAgentsFromChildThreads([
      {
        id: "child-1",
        preview: "",
        modelProvider: "openai",
        createdAt: Date.now(),
      } as never,
    ])).toEqual([]);
  });

  it("projects Codex non-message row kinds through the shared timeline model without historical reasoning rows", () => {
    const presentation = projectCodexSessionPresentation([
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        content: "Working through the task.",
        timestamp: 1,
      },
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "Inspecting the current implementation",
        content: "Checking renderer and store ownership.",
        timestamp: 2,
      },
      {
        id: "tool-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Run validation",
        output: "failed",
        status: "error",
        timestamp: 3,
      },
      {
        id: "context-1",
        kind: "context",
        toolType: "read_file",
        title: "src/App.tsx",
        detail: "Loaded app shell state",
        status: "completed",
        timestamp: 4,
      },
      {
        id: "explore-1",
        kind: "explore",
        status: "explored",
        entries: [{ id: "entry-1", kind: "read", label: "src/App.tsx", status: "completed" }],
        timestamp: 5,
      },
      {
        id: "compaction-1",
        kind: "compaction",
        timestamp: 6,
      },
    ], false);

    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool", title: "Run validation", defaultExpanded: false }),
        expect.objectContaining({ kind: "context" }),
        expect.objectContaining({ kind: "explore" }),
        expect.objectContaining({ kind: "compaction" }),
      ]),
    );
    expect(presentation.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "thinking" }),
      ]),
    );
  });

  it("groups adjacent explore rows until a non-explore row appears", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "explore-1",
        kind: "explore",
        item: {
          id: "explore-1",
          status: "explored",
          entries: [{ id: "read-1", kind: "read", label: "Read a.ts", status: "completed" }],
        },
      },
      {
        id: "explore-2",
        kind: "explore",
        item: {
          id: "explore-2",
          status: "explored",
          entries: [{ id: "read-2", kind: "read", label: "Read b.ts", status: "completed" }],
        },
      },
      {
        id: "message-1",
        kind: "message",
        role: "assistant",
        label: "Codex",
        sections: [{ id: "message-1:text", type: "text", content: "Now writing files." }],
      },
      {
        id: "explore-3",
        kind: "explore",
        item: {
          id: "explore-3",
          status: "explored",
          entries: [{ id: "read-3", kind: "read", label: "Read c.ts", status: "completed" }],
        },
      },
    ];

    const grouped = groupAdjacentExploreRows(rows);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({
      kind: "explore",
      item: {
        entries: [
          expect.objectContaining({ label: "Read a.ts" }),
          expect.objectContaining({ label: "Read b.ts" }),
        ],
      },
    });
    expect(grouped[1]).toMatchObject({ kind: "message" });
    expect(grouped[2]).toMatchObject({
      kind: "explore",
      item: {
        entries: [expect.objectContaining({ label: "Read c.ts" })],
      },
    });
  });

  it("groups adjacent exploration-only timeline rows until a non-timeline row appears", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "timeline-1",
        kind: "timeline",
        blocks: [
          {
            id: "explore-block-1",
            type: "exploration",
            summary: "Explored 1 search",
            entries: [{ id: "list-1", kind: "list", label: "Listed files" }],
          },
        ],
      },
      {
        id: "timeline-2",
        kind: "timeline",
        blocks: [
          {
            id: "explore-block-2",
            type: "exploration",
            summary: "Explored 1 file",
            entries: [{ id: "read-1", kind: "read", label: "Read package.json" }],
          },
        ],
      },
      {
        id: "tool-1",
        kind: "tool",
        title: "Ran npm install",
        status: "completed",
      },
      {
        id: "timeline-3",
        kind: "timeline",
        blocks: [
          {
            id: "explore-block-3",
            type: "exploration",
            summary: "Explored 1 file",
            entries: [{ id: "read-2", kind: "read", label: "Read tsconfig.json" }],
          },
        ],
      },
    ];

    const grouped = groupAdjacentTimelineExplorationRows(rows);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ kind: "timeline" });
    expect(grouped[0] && grouped[0].kind === "timeline" ? grouped[0].blocks : []).toHaveLength(2);
    expect(grouped[1]).toMatchObject({ kind: "tool", title: "Ran npm install" });
    expect(grouped[2]).toMatchObject({ kind: "timeline" });
  });

  it("groups adjacent diff rows into a tool-calls section", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "diff-1",
        kind: "diff",
        path: "src/a.ts",
        type: "added",
        insertions: 2,
        deletions: 0,
      },
      {
        id: "diff-2",
        kind: "diff",
        path: "src/b.ts",
        type: "modified",
        insertions: 4,
        deletions: 1,
      },
      {
        id: "message-1",
        kind: "message",
        role: "assistant",
        label: "Builder",
        sections: [{ id: "m1", type: "text", content: "Now summarizing." }],
      },
    ];

    const grouped = groupAdjacentToolCallRows(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      kind: "tool-group",
      title: "Tool calls",
      files: [
        expect.objectContaining({ path: "src/a.ts" }),
        expect.objectContaining({ path: "src/b.ts" }),
      ],
    });
  });

  it("extracts review changes from grouped diff rows", () => {
    const rows: UnifiedTimelineRenderRow[] = [
      {
        id: "group-1",
        kind: "diff-group",
        title: "Changed files",
        files: [
          { id: "file-1", path: "src/a.ts", type: "modified", insertions: 1, deletions: 0 },
        ],
      },
      {
        id: "group-2",
        kind: "tool-group",
        title: "Tool calls",
        files: [
          { id: "file-2", path: "src/b.ts", type: "added", insertions: 2, deletions: 0 },
        ],
      },
    ];

    expect(extractReviewChangesFiles(rows)).toEqual([
      expect.objectContaining({ path: "src/a.ts" }),
      expect.objectContaining({ path: "src/b.ts" }),
    ]);
  });

  it("derives shared sidebar and composer presentation state", () => {
    const sidebar = buildSidebarSessionPresentation({
      sessionKey: "codex::/repo::thr-1",
      status: {
        type: "busy",
        busy: true,
        awaiting: false,
        unread: true,
        planReady: false,
        activityAt: 10,
      },
      updatedAt: 12,
      isActive: false,
    });
    const composer = buildComposerPresentation({
      status: {
        type: "awaiting",
        busy: false,
        awaiting: true,
        unread: false,
        planReady: false,
        activityAt: 12,
      },
      sending: false,
      pending: {
        kind: "permission",
        provider: "codex",
        awaiting: true,
        label: "Agent needs permission",
      },
    });

    expect(sidebar.indicator).toBe("busy");
    expect(composer).toMatchObject({
      busy: false,
      awaiting: true,
      blockedBy: "permission",
    });
  });

  it("suppresses active-session sidebar indicators", () => {
    const sidebar = buildSidebarSessionPresentation({
      sessionKey: "codex::/repo::thr-1",
      status: {
        type: "plan_ready",
        busy: false,
        awaiting: false,
        unread: true,
        planReady: true,
        activityAt: 10,
      },
      updatedAt: 12,
      isActive: true,
    });

    expect(sidebar).toMatchObject({
      indicator: "none",
      unread: false,
    });
  });

  it("derives shared opencode background agents across assistant turns", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "assistant-0",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now - 10,
        parts: [
          {
            id: "subtask-0",
            type: "subtask",
            sessionID: "child-session-0",
            messageID: "assistant-0",
            prompt: "Inspect the routing layer.",
            description: "Inspect routing layer",
            agent: "Librarian",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        ],
      }),
      createSessionMessageBundle({
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "subtask-1",
            type: "subtask",
            sessionID: "child-session-1",
            messageID: "assistant-1",
            prompt: "Inspect the booking routes.",
            description: "Inspect booking routes",
            agent: "Explorer",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        ],
      }),
    ];

    expect(
      buildOpencodeBackgroundAgents(messages, {
        "child-session-0": { type: "idle" },
        "child-session-1": { type: "busy" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "child-session-0",
          provider: "opencode",
          name: "Librarian",
          status: "idle",
        }),
        expect.objectContaining({
          id: "child-session-1",
          provider: "opencode",
          name: "Explorer",
          modelLabel: "openai/gpt-5.4",
          status: "thinking",
        }),
      ]),
    );
  });

  it("derives Codex background agents from task tool collab metadata when runtime state is empty", () => {
    expect(
      buildCodexBackgroundAgentsFromMessages([
        {
          id: "task-1",
          kind: "tool",
          toolType: "task",
          title: "Spawn worker",
          status: "running",
          timestamp: Date.now(),
          collabReceivers: [{ threadId: "child-1", nickname: "Euclid", role: "worker" }],
          collabStatuses: [{ threadId: "child-1", nickname: "Euclid", role: "worker", status: "done" }],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "child-1",
        provider: "codex",
        name: "Euclid",
        status: "completed",
      }),
    ]);
  });

  it("derives Codex background agents from generic collab tool metadata too", () => {
    expect(
      buildCodexBackgroundAgentsFromMessages([
        {
          id: "collab-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Spawn explorer",
          status: "completed",
          timestamp: Date.now(),
          collabReceivers: [{ threadId: "child-2", nickname: "Scout", role: "explorer" }],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "child-2",
        provider: "codex",
        name: "Scout",
        role: "explorer",
      }),
    ]);
  });

  it("filters the active codex thread out of background agents", () => {
    expect(
      filterOutCurrentCodexThreadAgent([
        {
          id: "thr-main",
          sessionID: "thr-main",
          provider: "codex",
          name: "main",
          status: "thinking",
          statusText: "is thinking",
        },
        {
          id: "child-2",
          sessionID: "child-2",
          provider: "codex",
          name: "Scout",
          status: "thinking",
          statusText: "is thinking",
        },
      ], "thr-main"),
    ).toEqual([
      expect.objectContaining({
        id: "child-2",
        name: "Scout",
      }),
    ]);
  });

  it("keeps multiple opencode child agents when they share the same name", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "assistant-shared-name",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "subtask-1",
            type: "subtask",
            messageID: "assistant-shared-name",
            prompt: "Inspect athena-pumping",
            description: "Inspect athena-pumping",
            agent: "explore",
            sessionID: "child-1",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
          {
            id: "subtask-2",
            type: "subtask",
            messageID: "assistant-shared-name",
            prompt: "Inspect sii-beauty-boutique",
            description: "Inspect sii-beauty-boutique",
            agent: "explore",
            sessionID: "child-2",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        ],
      }),
    ];

    expect(
      buildOpencodeBackgroundAgents(messages, {
        "child-1": { type: "idle" },
        "child-2": { type: "idle" },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "child-1", sessionID: "child-1", name: "explore" }),
        expect.objectContaining({ id: "child-2", sessionID: "child-2", name: "explore" }),
      ]),
    );
  });

  it("derives Codex task-list items from assistant plan text when structured plan state is empty", () => {
    expect(
      extractCodexTodoItemsFromMessages([
        {
          id: "assistant-plan",
          kind: "message",
          role: "assistant",
          timestamp: Date.now(),
          content: [
            "I created a task list and started maintaining it with these phases:",
            "1. Inspect repo and choose the new standalone site folder",
            "2. Scaffold the app and core dependencies",
            "3. Implement the booking product and UX",
          ].join("\n"),
        },
      ]),
    ).toEqual([
      expect.objectContaining({ content: "Inspect repo and choose the new standalone site folder" }),
      expect.objectContaining({ content: "Scaffold the app and core dependencies" }),
      expect.objectContaining({ content: "Implement the booking product and UX" }),
    ]);
  });

  it("surfaces provisional opencode background agents before child session ids arrive", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "assistant-placeholder-subtask",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "subtask-no-session",
            type: "subtask",
            messageID: "assistant-placeholder-subtask",
            prompt: "Inspect the frontend.",
            description: "Inspect frontend",
            agent: "Frontend",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
          {
            id: "tool-task-no-session",
            type: "tool",
            sessionID: "session-1",
            messageID: "assistant-placeholder-subtask",
            callID: "call-task-no-session",
            tool: "task",
            state: {
              status: "running",
              input: {
                agent: "build",
                prompt: "Implement the feature.",
                description: "Implement feature",
              },
              output: "",
              metadata: {},
              time: { start: now },
            },
          },
        ],
      }),
    ];

    expect(buildOpencodeBackgroundAgents(messages)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "opencode",
          name: "Frontend",
          status: "thinking",
          sessionID: undefined,
        }),
        expect.objectContaining({
          provider: "opencode",
          name: "build",
          status: "thinking",
          sessionID: undefined,
        }),
      ]),
    );
  });

  it("extracts opencode todo items from the latest todo tool state", () => {
    const now = Date.now();
    const messages = [
      createSessionMessageBundle({
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "todo-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "assistant-1",
            callID: "call-1",
            tool: "todowrite",
            state: {
              status: "completed",
              input: {},
              output: [
                { id: "task-1", content: "Audit providers", status: "completed" },
                { id: "task-2", content: "Wire shared dock", status: "in_progress" },
              ],
              title: "todo",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ],
      }),
    ];

    expect(extractOpencodeTodoItems(messages)).toEqual([
      { id: "task-1", content: "Audit providers", status: "completed" },
      { id: "task-2", content: "Wire shared dock", status: "in_progress" },
    ]);
  });
});
