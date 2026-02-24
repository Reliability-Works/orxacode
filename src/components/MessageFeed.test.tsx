import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageFeed } from "./MessageFeed";
import type { SessionMessageBundle } from "@shared/ipc";

describe("MessageFeed", () => {
  it("renders persistent timeline rows for completed tool actions", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-actions",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-read-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-actions",
            callID: "call-read-1",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "/repo/src/app.tsx" },
              output: "",
              title: "read_file",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    const exploredSummary = screen.getByText("Explored 1 file");
    expect(exploredSummary).toBeInTheDocument();
    expect(exploredSummary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Why this changed: Main agent via read")).not.toBeInTheDocument();
  });

  it("shows assistant text and hides internal metadata/tool payloads", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-1",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-1",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-1",
            text: "hi",
          },
        ] as SessionMessageBundle["parts"],
      },
      {
        info: ({
          id: "msg-assistant-1",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-start-1",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-1",
            text: '{"type":"step-start","id":"prt_1","sessionID":"session-1","messageID":"msg-assistant-1"}',
          },
          {
            id: "part-tool-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-1",
            callID: "call-1",
            tool: "todowrite",
            state: {
              status: "completed",
              input: {},
              output: "[]",
              title: "todo",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          },
          {
            id: "part-text-1",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-1",
            text: "Hey! How can I help today?",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText("Hey! How can I help today?")).toBeInTheDocument();
    expect(screen.queryByText(/step-start/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/todowrite/i)).not.toBeInTheDocument();
  });

  it("shows a single thinking bubble with collapsible live events when busy", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-2",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-step-2",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-2",
            reason: "tool-calls",
            snapshot: "snap-1",
            cost: 0,
            tokens: {
              input: 10,
              output: 2,
              reasoning: 0,
              cache: { read: 4, write: 0 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText(/Live events \(1\)/i)).toBeInTheDocument();
  });

  it("keeps full live event history instead of truncating to 5 entries", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-events",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "finish-1",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-1",
            cost: 0,
            tokens: {
              input: 1,
              output: 1,
              reasoning: 0,
              cache: { read: 1, write: 0 },
            },
          },
          {
            id: "finish-2",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-2",
            cost: 0,
            tokens: {
              input: 2,
              output: 1,
              reasoning: 0,
              cache: { read: 2, write: 0 },
            },
          },
          {
            id: "finish-3",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-3",
            cost: 0,
            tokens: {
              input: 3,
              output: 1,
              reasoning: 0,
              cache: { read: 3, write: 0 },
            },
          },
          {
            id: "finish-4",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-4",
            cost: 0,
            tokens: {
              input: 4,
              output: 1,
              reasoning: 0,
              cache: { read: 4, write: 0 },
            },
          },
          {
            id: "finish-5",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-5",
            cost: 0,
            tokens: {
              input: 5,
              output: 1,
              reasoning: 0,
              cache: { read: 5, write: 0 },
            },
          },
          {
            id: "finish-6",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-events",
            reason: "tool-calls",
            snapshot: "snap-6",
            cost: 0,
            tokens: {
              input: 6,
              output: 1,
              reasoning: 0,
              cache: { read: 6, write: 0 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getByText(/Live events \(6\)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Step finished/i).length).toBeGreaterThanOrEqual(6);
  });

  it("shows delegation bubble when task tool is running", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-task-running",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-running",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-task-running",
            callID: "call-task-running",
            tool: "task",
            state: {
              status: "running",
              input: {
                prompt: "Build the full Spencer Solutions website.",
                description: "Build Spencer Solutions site",
                subagent_type: "build",
                command: "/spencer",
              },
              title: "Build Spencer Solutions site",
              metadata: {
                model: {
                  providerID: "openai",
                  modelID: "gpt-5-codex",
                },
              },
              time: { start: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getByText(/Delegating .* to @build/i)).toBeInTheDocument();
    const bubble = screen.getByRole("button", { name: /build/i });
    expect(bubble).toBeInTheDocument();
    fireEvent.click(bubble);
    const dialog = screen.getByRole("dialog", { name: /delegation: build/i });
    expect(within(dialog).getByText(/Build Spencer Solutions site/i)).toBeInTheDocument();
  });

  it("renders completed task tool as delegation timeline entry", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-task-complete",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-complete",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-task-complete",
            callID: "call-task-complete",
            tool: "task",
            state: {
              status: "completed",
              input: {
                prompt: "Build the full Spencer Solutions website.",
                description: "Build Spencer Solutions site",
                subagent_type: "build",
              },
              output: "done",
              title: "Build Spencer Solutions site",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText(/Delegated Build Spencer Solutions site to @build/i)).toBeInTheDocument();
    expect(screen.queryByText(/Ran on - Description/i)).not.toBeInTheDocument();
  });

  it("shows delegated task result output in modal live output", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-task-result",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-result",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-task-result",
            callID: "call-task-result",
            tool: "task",
            state: {
              status: "completed",
              input: {
                prompt: "Build the full Spencer Solutions website.",
                description: "Build Spencer Solutions site",
                subagent_type: "build",
              },
              output: "task_id: abc123\n\n<task_result>\nImplemented homepage and contact page.\n</task_result>",
              title: "Build Spencer Solutions site",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);
    const buildButtons = screen.getAllByRole("button", { name: /build/i });
    fireEvent.click(buildButtons[buildButtons.length - 1]!);
    const dialogs = screen.getAllByRole("dialog", { name: /delegation: build/i });
    const dialog = dialogs[dialogs.length - 1]!;
    expect(within(dialog).getByText(/Implemented homepage and contact page\./i)).toBeInTheDocument();
  });

  it("loads delegated session output using task_id fallback when metadata is missing", async () => {
    const now = Date.now();
    const loadMessages = vi.fn(async () => []);
    const currentOrxa = (window as { orxa?: unknown }).orxa as { opencode?: Record<string, unknown> } | undefined;
    const nextOpencode = { ...(currentOrxa?.opencode ?? {}), loadMessages };
    Object.defineProperty(window, "orxa", {
      value: { ...(currentOrxa ?? {}), opencode: nextOpencode },
      configurable: true,
    });

    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-task-session-fallback",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-session-fallback",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-task-session-fallback",
            callID: "call-task-session-fallback",
            tool: "task",
            state: {
              status: "completed",
              input: {
                prompt: "Build the full Spencer Solutions website.",
                description: "Build Spencer Solutions site",
                subagent_type: "build",
              },
              output: "task_id: abc123\n\n<task_result>\nDone.\n</task_result>",
              title: "Build Spencer Solutions site",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/repo" />);

    const buildButtons = screen.getAllByRole("button", { name: /build/i });
    fireEvent.click(buildButtons[buildButtons.length - 1]!);

    await waitFor(() => {
      expect(loadMessages).toHaveBeenCalledWith("/repo", "abc123");
    });
  });

  it("shows delegation bubbles with modal details for sub-agent tasks", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-delegation",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "subtask-1",
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-assistant-delegation",
            prompt: "Inspect files and implement a fix.",
            description: "Fix the bug in renderer state handling",
            agent: "reviewer",
            model: { providerID: "openai", modelID: "gpt-5-codex" },
          },
          {
            id: "tool-subtask-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-delegation",
            callID: "call-subtask-1",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: {},
              output: "{}",
              title: "apply_patch",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    const bubble = screen.getByRole("button", { name: /reviewer/i });
    expect(bubble).toBeInTheDocument();

    fireEvent.click(bubble);

    const dialog = screen.getByRole("dialog", { name: /delegation: reviewer/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Model: openai\/gpt-5-codex/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Inspect files and implement a fix/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/apply_patch \(completed\)/i)).toBeInTheDocument();
  });

  it("shows in-place activity with current file target from tool calls", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-activity",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-read-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-activity",
            callID: "call-read-1",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa/src/App.tsx" },
              output: "",
              title: "read",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa" />);

    expect(screen.getAllByText(/Read src\/App.tsx/i).length).toBeGreaterThan(0);
  });

  it("does not leak todo content as tool activity target", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-todo-activity",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-todo-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-todo-activity",
            callID: "call-todo-1",
            tool: "todowrite",
            state: {
              status: "completed",
              input: { todos: [{ content: "Add performance optimizations", status: "pending" }] },
              output: "[]",
              title: "todo",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getAllByText(/Updated todo list/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Used tools Add performance/i)).not.toBeInTheDocument();
  });

  it("shows concrete file action for apply_patch run via exec command", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-patch-activity",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-exec-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-patch-activity",
            callID: "call-exec-1",
            tool: "exec_command",
            state: {
              status: "completed",
              input: {
                cmd: "apply_patch <<'PATCH'\n*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-foo\n+bar\n*** End Patch\nPATCH",
              },
              output: "",
              title: "exec",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/Volumes/ExtSSD/Repos/macapp/OpencodeOrxa" />);

    expect(screen.getByText(/Edited src\/App.tsx/i)).toBeInTheDocument();
    expect(screen.getByText(/Command: apply_patch <<'PATCH'/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Updated$/i)).not.toBeInTheDocument();
  });

  it("shows command text for generic run rows when tool title is present", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-run-title",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-run-title",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-run-title",
            callID: "call-run-title",
            tool: "bash",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "npm run typecheck",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText(/Ran npm run typecheck/i)).toBeInTheDocument();
    expect(screen.getByText(/Command: npm run typecheck/i)).toBeInTheDocument();
  });

  it("uses mode-aware assistant label", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-label",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-text-label",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-label",
            text: "Done.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} assistantLabel="Assistant" />);

    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });
});
