import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageFeed } from "./MessageFeed";
import type { SessionMessageBundle } from "@shared/ipc";
import { createSessionMessageBundle, createTextPart } from "../test/session-message-bundle-factory";

describe("MessageFeed", () => {
  it("renders persistent timeline rows for completed tool actions", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-assistant-actions",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
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
        ],
      }),
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    const exploredSummary = screen.getByText("Explored 1 file");
    expect(exploredSummary).toBeInTheDocument();
    expect(exploredSummary.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Why this changed: Main agent via read")).not.toBeInTheDocument();
  });

  it("does not classify completed read tools with file metadata as changed files", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-assistant-read-metadata",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "tool-read-metadata",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-read-metadata",
            callID: "call-read-metadata",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "/repo/website/app/page.tsx" },
              output: "",
              title: "read_file",
              metadata: {
                filepath: "/repo/website/app/page.tsx",
                additions: 120,
                deletions: 14,
              },
              time: { start: now, end: now },
            },
          },
        ],
      }),
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);

    expect(screen.getByText("Explored 1 file")).toBeInTheDocument();
    expect(screen.queryByText("Changed files")).not.toBeInTheDocument();
    expect(screen.queryByText("Edited website/app/page.tsx")).not.toBeInTheDocument();
  });

  it("shows live tool cards for active edit tools while a session is streaming", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-assistant-active-edit",
        role: "assistant",
        sessionID: "session-1",
        createdAt: now,
        parts: [
          {
            id: "tool-edit-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-active-edit",
            callID: "call-edit-1",
            tool: "apply_patch",
            state: {
              status: "running",
              input: "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-old\n+new\n*** End Patch\n",
              output: "",
              title: "apply_patch",
              metadata: {},
              time: { start: now, end: now },
            },
          },
        ],
      }),
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);

    expect(screen.getByText("Editing src/App.tsx...")).toBeInTheDocument();
  });

  it("shows assistant text and hides internal metadata/tool payloads", () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-user-1",
        role: "user",
        sessionID: "session-1",
        parts: [createTextPart({ id: "part-user-1", sessionID: "session-1", messageID: "msg-user-1", text: "hi" })],
      }),
      createSessionMessageBundle({
        id: "msg-assistant-1",
        role: "assistant",
        sessionID: "session-1",
        parts: [
          createTextPart({
            id: "part-start-1",
            sessionID: "session-1",
            messageID: "msg-assistant-1",
            text: '{"type":"step-start","id":"prt_1","sessionID":"session-1","messageID":"msg-assistant-1"}',
          }),
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
          createTextPart({
            id: "part-text-1",
            sessionID: "session-1",
            messageID: "msg-assistant-1",
            text: "Hey! How can I help today?",
          }),
        ],
      }),
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText("Hey! How can I help today?")).toBeInTheDocument();
    expect(screen.queryByText(/step-start/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/todowrite/i)).not.toBeInTheDocument();
  });

  it("hides internal ORXA browser machine-result user prompts", () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-user-machine-result",
        role: "user",
        sessionID: "session-1",
        parts: [
          createTextPart({
            id: "part-user-machine-result",
            sessionID: "session-1",
            messageID: "msg-user-machine-result",
            text: '[ORXA_BROWSER_RESULT]{"id":"action-1","action":"navigate","ok":true}',
          }),
        ],
      }),
      createSessionMessageBundle({
        id: "msg-assistant-visible",
        role: "assistant",
        sessionID: "session-1",
        parts: [
          createTextPart({
            id: "part-assistant-visible",
            sessionID: "session-1",
            messageID: "msg-assistant-visible",
            text: "Captured first source. Continuing evidence collection.",
          }),
        ],
      }),
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.queryByText(/\[ORXA_BROWSER_RESULT\]/)).not.toBeInTheDocument();
    expect(screen.getByText("Captured first source. Continuing evidence collection.")).toBeInTheDocument();
  });

  it("keeps visible user text when a bundle also contains internal machine-result lines", () => {
    const messages: SessionMessageBundle[] = [
      createSessionMessageBundle({
        id: "msg-user-mixed",
        role: "user",
        sessionID: "session-1",
        parts: [
          createTextPart({
            id: "part-user-visible",
            sessionID: "session-1",
            messageID: "msg-user-mixed",
            text: "Research and summarize top DeFi news from 2026.",
          }),
          createTextPart({
            id: "part-user-internal",
            sessionID: "session-1",
            messageID: "msg-user-mixed",
            text: '[ORXA_BROWSER_RESULT]{"id":"action-1","action":"navigate","ok":true}',
          }),
        ],
      }),
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText("Research and summarize top DeFi news from 2026.")).toBeInTheDocument();
    expect(screen.queryByText(/\[ORXA_BROWSER_RESULT\]/)).not.toBeInTheDocument();
  });

  it("renders all visible user text parts instead of truncating to the first one", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-multipart",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-line-1",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-multipart",
            text: "Line one.",
          },
          {
            id: "part-user-line-2",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-multipart",
            text: "Line two.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText("Line one.")).toBeInTheDocument();
    expect(screen.getByText("Line two.")).toBeInTheDocument();
  });

  it("hides ORXA browser action tags from chat text", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-browser-action",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-assistant-browser-action",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-browser-action",
            text: '<orxa_browser_action>{"id":"action-1","action":"navigate","args":{"url":"https://defillama.com"}}</orxa_browser_action>',
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.queryByText(/<orxa_browser_action>/i)).not.toBeInTheDocument();
  });

  it("keeps ORXA screenshot machine-result attachments out of user chat messages", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-machine-screenshot",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-machine-screenshot-text",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-machine-screenshot",
            text: '[ORXA_BROWSER_RESULT]{"id":"shot-1","action":"screenshot","ok":true}',
          },
          {
            id: "part-user-machine-screenshot-file",
            type: "file",
            sessionID: "session-1",
            messageID: "msg-user-machine-screenshot",
            mime: "image/png",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.queryByText(/Attached file:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ORXA_BROWSER_RESULT/i)).not.toBeInTheDocument();
  });

  it("hides internal SUPERMEMORY user context lines from chat", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-supermemory",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-supermemory",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-supermemory",
            text: "[SUPERMEMORY] injected 4 items",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.queryByText(/\[SUPERMEMORY\]/)).not.toBeInTheDocument();
  });

  it("ignores non-status SUPERMEMORY payload text", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-supermemory-noise",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-user-supermemory-noise",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-supermemory-noise",
            text: "[SUPERMEMORY] Recent Context: fixed startup config and UI cleanup notes",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.queryByText("Applied in-app memory context")).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent Context:/)).not.toBeInTheDocument();
  });

  it("hides assistant ORXA memory lines from chat", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-orxa-memory",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-assistant-orxa-memory",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-orxa-memory",
            text:
              '[ORXA_MEMORY] workspace="/repo-a" type="decision" tags="memory" content="Keep local memory only."\n'
              + '[ORXA_MEMORY] workspace="/repo-a" type="fact" tags="guardrail" content="External memory tools disabled."',
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.queryByText(/\[ORXA_MEMORY\]/)).not.toBeInTheDocument();
  });

  it("shows thinking shimmer when busy with no visible parts", () => {
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

    expect(document.querySelector(".message-thinking")).toBeInTheDocument();
  });

  it("cleans up thinking timer when placeholder is turned off", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-thinking-cleanup",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-text-thinking-cleanup",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-thinking-cleanup",
            text: "Working...",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    try {
      const view = render(<MessageFeed messages={messages} showAssistantPlaceholder />);
      expect(view.container.querySelector(".message-thinking")).not.toBeNull();
      vi.advanceTimersByTime(500);
      view.rerender(<MessageFeed messages={messages} showAssistantPlaceholder={false} />);
      expect(view.container.querySelector(".message-thinking")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Live events display removed — internal events are now represented by tool cards and shimmer

  it("shows delegation summary when task tool is running", () => {
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
    expect(screen.queryByRole("button", { name: /build/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /delegation:/i })).not.toBeInTheDocument();
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

  it("shows delegated task result output inline in the timeline disclosure", () => {
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
    const summary = screen.getByText(/Delegated Build Spencer Solutions site to @build/i);
    fireEvent.click(summary.closest("summary")!);
    expect(screen.getByText(/Implemented homepage and contact page\./i)).toBeInTheDocument();
  });

  it("does not load delegated session output inside the transcript surface", async () => {
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

    await waitFor(() => {
      expect(loadMessages).not.toHaveBeenCalled();
    });
  });

  it("keeps delegated patch transcript loading out of MessageFeed", async () => {
    const now = Date.now();
    const loadMessages = vi.fn(async () => [
      {
        info: ({
          id: "child-msg-1",
          role: "assistant",
          sessionID: "child-1",
          time: { created: now + 10, updated: now + 10 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "child-tool-patch-1",
            type: "tool",
            sessionID: "child-1",
            messageID: "child-msg-1",
            callID: "child-call-patch-1",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: {
                patch: "*** Begin Patch\n*** Update File: /repo/package.json\n@@\n-  \"name\": \"old\"\n+  \"name\": \"new\"\n+  \"version\": \"1.2.3\"\n*** End Patch",
              },
              output: "",
              title: "apply_patch",
              metadata: {},
              time: { start: now + 10, end: now + 11 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ]);
    const currentOrxa = (window as { orxa?: unknown }).orxa as { opencode?: Record<string, unknown> } | undefined;
    const nextOpencode = { ...(currentOrxa?.opencode ?? {}), loadMessages };
    Object.defineProperty(window, "orxa", {
      value: { ...(currentOrxa ?? {}), opencode: nextOpencode },
      configurable: true,
    });

    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-task-patch-summary",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-patch-summary",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-task-patch-summary",
            callID: "call-task-patch-summary",
            tool: "task",
            state: {
              status: "completed",
              input: {
                prompt: "Build the full Spencer Solutions website.",
                description: "Build Spencer Solutions site",
                subagent_type: "build",
              },
              output: "task_id: child-1",
              title: "Build Spencer Solutions site",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/repo" />);
    await waitFor(() => {
      expect(loadMessages).not.toHaveBeenCalled();
    });
  });

  it("renders sub-agent delegation as timeline context instead of a transcript bubble", () => {
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

    expect(screen.getByText(/Delegated to reviewer: Fix the bug in renderer state handling/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reviewer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /delegation:/i })).not.toBeInTheDocument();
  });

  it("leaves delegated subagent transcript loading to the shared background-agent surface", async () => {
    const now = Date.now();
    const loadMessages = vi.fn(async () => [
      {
        info: ({
          id: "child-msg-grouped-output",
          role: "assistant",
          sessionID: "child-grouped-output",
          time: { created: now + 10, updated: now + 10 },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "child-tool-list",
            type: "tool",
            sessionID: "child-grouped-output",
            messageID: "child-msg-grouped-output",
            callID: "child-call-list",
            tool: "list_directory",
            state: {
              status: "completed",
              input: { path: "/repo/_template/src/app" },
              output: "",
              title: "list",
              metadata: {},
              time: { start: now + 10, end: now + 11 },
            },
          },
          {
            id: "child-tool-read-layout",
            type: "tool",
            sessionID: "child-grouped-output",
            messageID: "child-msg-grouped-output",
            callID: "child-call-read-layout",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "/repo/_template/src/app/layout.tsx" },
              output: "",
              title: "read",
              metadata: {},
              time: { start: now + 12, end: now + 13 },
            },
          },
          {
            id: "child-tool-read-page",
            type: "tool",
            sessionID: "child-grouped-output",
            messageID: "child-msg-grouped-output",
            callID: "child-call-read-page",
            tool: "read_file",
            state: {
              status: "completed",
              input: { path: "/repo/_template/src/app/page.tsx" },
              output: "",
              title: "read",
              metadata: {},
              time: { start: now + 14, end: now + 15 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ]);
    const currentOrxa = (window as { orxa?: unknown }).orxa as { opencode?: Record<string, unknown> } | undefined;
    Object.defineProperty(window, "orxa", {
      value: { ...(currentOrxa ?? {}), opencode: { ...(currentOrxa?.opencode ?? {}), loadMessages } },
      configurable: true,
    });

    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-grouped-output",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-task-grouped-output",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-grouped-output",
            callID: "call-task-grouped-output",
            tool: "task",
            state: {
              status: "completed",
              input: {
                prompt: "Inspect the project structure.",
                description: "Inspect project structure",
                subagent_type: "build",
              },
              output: "task_id: child-grouped-output",
              title: "Inspect project structure",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder workspaceDirectory="/repo" />);
    await waitFor(() => {
      expect(loadMessages).not.toHaveBeenCalled();
    });
    expect(screen.getByText(/Delegated Inspect project structure to @build/i)).toBeInTheDocument();
  });

  it("keeps delegation details out of the transcript placeholder", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-delegation-close-behavior",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "subtask-close-behavior",
            type: "subtask",
            sessionID: "session-1",
            messageID: "msg-assistant-delegation-close-behavior",
            prompt: "Do work.",
            description: "Close behavior test",
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-5-codex" },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    expect(screen.queryByText("Close behavior test")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /delegation:/i })).not.toBeInTheDocument();
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

    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
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

    expect(screen.getByText("Edited")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
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

  it("shows created file summary for write tool without fake command rows", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-write-created",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-write-created",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-write-created",
            callID: "call-write-created",
            tool: "write",
            state: {
              status: "completed",
              input: {
                filePath: "/repo/src/components/ui/sheet.tsx",
                content: "line one\nline two",
              },
              output: "Wrote file successfully.",
              title: "src/components/ui/sheet.tsx",
              metadata: {
                filepath: "/repo/src/components/ui/sheet.tsx",
                exists: false,
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    expect(screen.getByText("Changed files")).toBeInTheDocument();
    expect(screen.getByText("src/components/ui/sheet.tsx")).toBeInTheDocument();
    expect(screen.getByText("+2")).toHaveClass("diff-block-stat--add");
    expect(screen.getByText("-0")).toHaveClass("diff-block-stat--del");
    expect(screen.queryByText(/Command: src\/components\/ui\/sheet\.tsx/i)).not.toBeInTheDocument();
  });

  it("shows useful error details for failed tool entries", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-write-failed",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-write-failed",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-write-failed",
            callID: "call-write-failed",
            tool: "write",
            state: {
              status: "error",
              input: {
                filePath: "/repo/package.json",
                content: "{}",
              },
              error: "File not found: /repo/package.json",
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    expect(screen.getByText(/^Failed package\.json$/i)).toBeInTheDocument();
    expect(screen.getByText(/File not found: \/repo\/package\.json/i)).toBeInTheDocument();
  });

  it("does not render a generic ran-command row for non-command read-like titles", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-no-generic-run",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-read-title",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-no-generic-run",
            callID: "call-read-title",
            tool: "run",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Read .",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);
    expect(screen.getByText("Read .")).toBeInTheDocument();
    expect(screen.queryByText(/^Ran command$/i)).not.toBeInTheDocument();
  });

  it("renders timeline file labels with the relative path instead of basename-only pills", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-created-path",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-run-created-path",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-created-path",
            callID: "call-run-created-path",
            tool: "run",
            state: {
              status: "completed",
              input: {
                command: "touch /repo/website/app/private-ai-agents.tsx",
              },
              output: "",
              title: "touch /repo/website/app/private-ai-agents.tsx",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    expect(screen.getByText("website/app/private-ai-agents.tsx")).toBeInTheDocument();
  });

  it("does not render low-signal completed action rows without command context", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-no-completed-action-noise",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-run-generic",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-no-completed-action-noise",
            callID: "call-run-generic",
            tool: "run",
            state: {
              status: "completed",
              input: {},
              output: "",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];
    const view = render(<MessageFeed messages={messages} />);
    expect(within(view.container).queryByText(/^Completed action$/i)).not.toBeInTheDocument();
  });

  it("renders loaded skill label without synthetic command line", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-loaded-skill",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-loaded-skill",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-loaded-skill",
            callID: "call-loaded-skill",
            tool: "run",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Loaded skill: frontend-design",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);
    expect(screen.getAllByText("Loaded skill: frontend-design").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Command: Loaded skill: frontend-design/i)).not.toBeInTheDocument();
  });

  it("treats non-shell command titles as narrative labels", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-loaded-skill-command",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-loaded-skill-command",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-loaded-skill-command",
            callID: "call-loaded-skill-command",
            tool: "run",
            state: {
              status: "completed",
              input: { command: "Loaded skill: frontend-design" },
              output: "",
              title: "Loaded skill: frontend-design",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);
    expect(screen.getAllByText("Loaded skill: frontend-design").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Ran Loaded skill:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Command: Loaded skill: frontend-design/i)).not.toBeInTheDocument();
  });

  it("renders additions/deletions with diff color classes in timeline labels", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-diff-color",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-write-diff-color",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-diff-color",
            callID: "call-write-diff-color",
            tool: "write",
            state: {
              status: "completed",
              input: {
                filePath: "/repo/src/app.tsx",
                content: "line 1\nline 2",
              },
              output: "",
              title: "write",
              metadata: {
                filepath: "/repo/src/app.tsx",
                exists: false,
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);
    expect(screen.getByText("+2")).toHaveClass("diff-block-stat--add");
    expect(screen.getByText("-0")).toHaveClass("diff-block-stat--del");
  });

  it("renders opencode edit tools inside the shared changed files cluster", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-changed-files",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-apply-patch-1",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-changed-files",
            callID: "call-apply-patch-1",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: {
                patch: [
                  "*** Begin Patch",
                  "*** Update File: /repo/src/app.tsx",
                  "@@",
                  "-old",
                  "+new",
                  "*** Add File: /repo/src/new.ts",
                  "+export const created = true;",
                  "*** End Patch",
                ].join("\n"),
              },
              output: "",
              title: "apply_patch",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);

    expect(screen.getByText("Changed files")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/new.ts")).toBeInTheDocument();
  });

  it("hydrates expandable opencode changed-file diffs from metadata patch payloads", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-metadata-patch",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-edit-metadata-patch",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-metadata-patch",
            callID: "call-edit-metadata-patch",
            tool: "edit_file",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "edit_file",
              metadata: {
                diff: [
                  "*** Begin Patch",
                  "*** Update File: /repo/website/components/SiteNav.tsx",
                  "@@",
                  "-old value",
                  "+new value",
                  "*** End Patch",
                ].join("\n"),
              },
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} workspaceDirectory="/repo" />);

    fireEvent.click(screen.getByRole("button", { name: /Editedwebsite\/components\/SiteNav\.tsx\+1-1/i }));
    expect(screen.getByText("+new value")).toBeInTheDocument();
  });

  it("renders session stop notices with reason text", () => {
    const now = Date.now();
    render(
      <MessageFeed
        messages={[]}
        sessionNotices={[
          {
            id: "notice-1",
            time: now,
            label: "Session stopped due to an error",
            detail: "Permission request rejected by user",
            tone: "error",
          },
        ]}
      />,
    );

    expect(screen.getByText("Session stopped due to an error")).toBeInTheDocument();
    expect(screen.getByText(/Reason: Permission request rejected by user/i)).toBeInTheDocument();
  });

  it("shows copy button on user messages and copies visible text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-user-copy",
          role: "user",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-text-copy-1",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-copy",
            text: "Here is the answer.",
          },
          {
            id: "part-text-copy-2",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-user-copy",
            text: "And a follow-up.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    const copyBtn = screen.getByRole("button", { name: /copy message/i });
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveClass("message-copy-btn");

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Here is the answer.\n\nAnd a follow-up.");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument();
    });
  });

  it("does not show copy button for assistant messages", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-copy-disabled",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-assistant-copy-disabled",
            type: "text",
            sessionID: "session-1",
            messageID: "msg-assistant-copy-disabled",
            text: "Assistant text should not render a copy affordance.",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("shows command output in expandable timeline details", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-run-output",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-run-output",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-run-output",
            callID: "call-run-output",
            tool: "bash",
            state: {
              status: "completed",
              input: { cmd: "pwd" },
              output: "/Users/callumspencer/Repos/macapp/orxacode",
              title: "pwd",
              metadata: {},
              time: { start: now, end: now + 1 },
            },
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} />);

    expect(screen.getByText(/^pwd$/i)).toBeInTheDocument();
    expect(screen.getByText("/Users/callumspencer/Repos/macapp/orxacode")).toBeInTheDocument();
  });

  it("does not show copy button for timeline-only messages", () => {
    const now = Date.now();
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-timeline-only",
          role: "assistant",
          sessionID: "session-1",
          time: { created: now, updated: now },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "tool-read-timeline-only",
            type: "tool",
            sessionID: "session-1",
            messageID: "msg-assistant-timeline-only",
            callID: "call-read-timeline-only",
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
    expect(screen.queryByRole("button", { name: /copy message/i })).not.toBeInTheDocument();
  });

  it("does not show copy button on thinking placeholder", () => {
    const messages: SessionMessageBundle[] = [
      {
        info: ({
          id: "msg-assistant-thinking-copy",
          role: "assistant",
          sessionID: "session-1",
          time: { created: Date.now(), updated: Date.now() },
        } as unknown) as SessionMessageBundle["info"],
        parts: [
          {
            id: "part-step-thinking-copy",
            type: "step-finish",
            sessionID: "session-1",
            messageID: "msg-assistant-thinking-copy",
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
    expect(screen.queryByRole("button", { name: /copy message/i })).not.toBeInTheDocument();
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

  it("auto-scrolls to bottom when user is at bottom and new messages arrive", async () => {
    const now = Date.now();
    const makeMessage = (id: string, text: string): SessionMessageBundle => ({
      info: ({
        id,
        role: "assistant",
        sessionID: "session-scroll",
        time: { created: now, updated: now },
      } as unknown) as SessionMessageBundle["info"],
      parts: [
        {
          id: `${id}-part`,
          type: "text",
          sessionID: "session-scroll",
          messageID: id,
          text,
        },
      ] as SessionMessageBundle["parts"],
    });

    const initialMessages = [makeMessage("msg-1", "Hello")];
    const { rerender } = render(<MessageFeed messages={initialMessages} />);

    const scrollEl = document.querySelector(".messages-scroll") as HTMLElement;
    expect(scrollEl).toBeTruthy();

    // Simulate user being at the bottom (jsdom starts at scrollTop=0, scrollHeight=0)
    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 500 });
    Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollEl, "scrollTop", { configurable: true, writable: true, value: 100 });

    const updatedMessages = [...initialMessages, makeMessage("msg-2", "New message")];
    rerender(<MessageFeed messages={updatedMessages} />);

    await waitFor(() => {
      // scrollTop should have been set to scrollHeight (500)
      expect(scrollEl.scrollTop).toBe(500);
    });
  });

  it("does not auto-scroll when user has scrolled up", async () => {
    const now = Date.now();
    const makeMessage = (id: string, text: string): SessionMessageBundle => ({
      info: ({
        id,
        role: "assistant",
        sessionID: "session-scroll-up",
        time: { created: now, updated: now },
      } as unknown) as SessionMessageBundle["info"],
      parts: [
        {
          id: `${id}-part`,
          type: "text",
          sessionID: "session-scroll-up",
          messageID: id,
          text,
        },
      ] as SessionMessageBundle["parts"],
    });

    const initialMessages = [makeMessage("msg-a", "First message")];
    const { rerender } = render(<MessageFeed messages={initialMessages} />);

    const scrollEl = document.querySelector(".messages-scroll") as HTMLElement;
    expect(scrollEl).toBeTruthy();

    Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollEl, "scrollTop", { configurable: true, writable: true, value: 0 });

    // Simulate user scrolling up — fire a scroll event so the handler marks isAtBottom as false
    fireEvent.scroll(scrollEl);

    // Record the scrollTop before the rerender
    const scrollTopBefore = scrollEl.scrollTop;

    const updatedMessages = [...initialMessages, makeMessage("msg-b", "Another message")];
    rerender(<MessageFeed messages={updatedMessages} />);

    await waitFor(() => {
      // scrollTop should NOT have changed because user scrolled up
      expect(scrollEl.scrollTop).toBe(scrollTopBefore);
    });
  });
});
