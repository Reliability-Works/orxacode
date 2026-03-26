import { describe, expect, it } from "vitest";
import { projectClaudeChatSessionPresentation } from "./claude-chat-session-presentation";
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from "../hooks/useClaudeChatSession";

describe("projectClaudeChatSessionPresentation", () => {
  it("keeps adjacent main-thread Claude explore rows separate instead of collapsing them into one row", () => {
    const messages: ClaudeChatMessageItem[] = [
      {
        id: "explore-1",
        kind: "explore",
        source: "main",
        status: "exploring",
        entries: [{ id: "entry-1", kind: "search", label: "Search workspace", status: "running" }],
        timestamp: 1,
      },
      {
        id: "explore-2",
        kind: "explore",
        source: "main",
        status: "explored",
        entries: [{ id: "entry-2", kind: "read", label: "Read failing.test.ts", status: "completed" }],
        timestamp: 2,
      },
    ];

    const presentation = projectClaudeChatSessionPresentation(messages, true, []);
    expect(presentation.rows).toHaveLength(2);
    expect(presentation.rows[0]).toMatchObject({
      kind: "explore",
      item: {
        status: "exploring",
        entries: [expect.objectContaining({ id: "entry-1" })],
      },
    });
    expect(presentation.rows[1]).toMatchObject({
      kind: "explore",
      item: {
        status: "explored",
        entries: [expect.objectContaining({ id: "entry-2" })],
      },
    });
  });

  it("renders Claude delegating after the active assistant message and hides delegated explore rows", () => {
    const messages: ClaudeChatMessageItem[] = [
      {
        id: "thinking-1",
        kind: "thinking",
        timestamp: 1,
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        content: "Let me investigate this.",
        timestamp: 2,
      },
      {
        id: "explore-1",
        kind: "explore",
        source: "delegated",
        status: "exploring",
        entries: [{ id: "entry-1", kind: "search", label: "Find desk files", status: "running" }],
        timestamp: 3,
      },
    ];
    const subagents: ClaudeChatSubagentState[] = [
      {
        id: "task-1",
        name: "researcher",
        status: "thinking",
        statusText: "running",
        taskText: "runtime asset cache invalidation",
      },
    ];

    const presentation = projectClaudeChatSessionPresentation(messages, true, subagents);
    expect(presentation.rows.map((row) => row.kind)).toEqual(["message", "thinking"]);
    expect(presentation.rows[1]).toMatchObject({
      kind: "thinking",
      summary: "Delegating: Waiting on runtime asset cache invalidation",
    });
  });

  it("uses a count-based delegating summary when multiple subagents are active", () => {
    const messages: ClaudeChatMessageItem[] = [
      {
        id: "thinking-1",
        kind: "thinking",
        timestamp: 1,
      },
    ];
    const subagents: ClaudeChatSubagentState[] = [
      {
        id: "task-1",
        name: "researcher",
        status: "thinking",
        statusText: "running",
        taskText: "first task",
      },
      {
        id: "task-2",
        name: "researcher",
        status: "awaiting_instruction",
        statusText: "awaiting input",
        taskText: "second task",
      },
    ];

    const presentation = projectClaudeChatSessionPresentation(messages, true, subagents);
    expect(presentation.rows).toMatchObject([
      {
        kind: "thinking",
        summary: "Delegating: Waiting on 2 background agents",
      },
    ]);
  });
});
