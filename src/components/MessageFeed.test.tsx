import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageFeed } from "./MessageFeed";
import type { SessionMessageBundle } from "@shared/ipc";

describe("MessageFeed", () => {
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
            type: "step-start",
            sessionID: "session-1",
            messageID: "msg-assistant-2",
          },
        ] as SessionMessageBundle["parts"],
      },
    ];

    render(<MessageFeed messages={messages} showAssistantPlaceholder />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText(/Live events \(1\)/i)).toBeInTheDocument();
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
