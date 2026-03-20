import { describe, expect, it } from "vitest";
import {
  buildComposerPresentation,
  buildOpencodeBackgroundAgents,
  buildSidebarSessionPresentation,
  extractOpencodeTodoItems,
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

  it("projects Codex non-message row kinds through the shared timeline model", () => {
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
        expect.objectContaining({ kind: "thinking", summary: "Inspecting the current implementation" }),
        expect.objectContaining({ kind: "tool", title: "Run validation", defaultExpanded: true }),
        expect.objectContaining({ kind: "context" }),
        expect.objectContaining({ kind: "explore" }),
        expect.objectContaining({ kind: "compaction" }),
      ]),
    );
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

  it("derives shared opencode background agents from the latest assistant turn", () => {
    const now = Date.now();
    const messages = [
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
        "child-session-1": { type: "busy" },
      }),
    ).toEqual([
      expect.objectContaining({
        id: "child-session-1",
        provider: "opencode",
        name: "Explorer",
        modelLabel: "openai/gpt-5.4",
        status: "thinking",
      }),
    ]);
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
