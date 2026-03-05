import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionMessageBundle } from "@shared/ipc";
import { ORXA_BROWSER_RESULT_PREFIX, parseBrowserActionsFromText, useBrowserAgentBridge } from "./useBrowserAgentBridge";

function assistantBundle(text: string): SessionMessageBundle {
  return {
    info: { role: "assistant" },
    parts: [{ type: "text", text }],
  } as unknown as SessionMessageBundle;
}

function assistantToolBundle(tool: string): SessionMessageBundle {
  const now = Date.now();
  return {
    info: {
      role: "assistant",
      id: `assistant-tool-${tool}`,
      sessionID: "session-1",
      time: { created: now, updated: now },
    },
    parts: [
      {
        id: `part-tool-${tool}`,
        type: "tool",
        sessionID: "session-1",
        messageID: `assistant-tool-${tool}`,
        callID: `call-${tool}`,
        tool,
        state: {
          status: "completed",
          input: {},
          output: "",
          title: tool,
          metadata: {},
          time: { start: now, end: now },
        },
      },
    ],
  } as unknown as SessionMessageBundle;
}

describe("parseBrowserActionsFromText", () => {
  it("parses valid browser action envelopes and ignores malformed payloads", () => {
    const text = [
      "Before",
      '<orxa_browser_action>{"id":"a1","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>',
      '<orxa_browser_action>{"id":"","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>',
      '<orxa_browser_action>{"id":"a2","action":"click","args":{"selector":"#cta"}}</orxa_browser_action>',
      '<orxa_browser_action>{"id":"broken","action":1}</orxa_browser_action>',
    ].join("\n");

    expect(parseBrowserActionsFromText(text)).toEqual([
      {
        id: "a1",
        action: "navigate",
        args: {
          url: "https://example.com",
        },
      },
      {
        id: "a2",
        action: "click",
        args: {
          selector: "#cta",
        },
      },
    ]);
  });
});

describe("useBrowserAgentBridge", () => {
  it("executes actions once per id and returns machine results", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true, data: { title: "Example" } }));
    const sendPrompt = vi.fn(async (input: { text: string }) => {
      void input;
      return true;
    });
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    const messages = [
      assistantBundle('<orxa_browser_action>{"id":"action-1","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>'),
      assistantBundle('<orxa_browser_action>{"id":"action-1","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>'),
    ];

    const { rerender } = renderHook(
      (props: { messages: SessionMessageBundle[] }) =>
        useBrowserAgentBridge({
          activeProjectDir: "/repo",
          activeSessionID: "session-1",
          messages: props.messages,
          browserModeEnabled: true,
          controlOwner: "agent",
        }),
      { initialProps: { messages } },
    );

    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });
    expect(performAgentAction).toHaveBeenCalledWith({
      action: "navigate",
      url: "https://example.com",
      workspace: "/repo",
      sessionID: "session-1",
      actionID: "action-1",
    });

    rerender({ messages });
    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });

    const sentText = sendPrompt.mock.calls[0]?.[0]?.text as string;
    const sentRequest = sendPrompt.mock.calls[0]?.[0] as { promptSource?: string; contextModeEnabled?: boolean } | undefined;
    expect(sentText.startsWith(ORXA_BROWSER_RESULT_PREFIX)).toBe(true);
    expect(sentText).toContain('"id":"action-1"');
    expect(sentText).toContain('"ok":true');
    expect(sentRequest?.promptSource).toBe("machine");
    expect(sentRequest?.contextModeEnabled).toBe(false);
  });

  it("blocks actions when control owner is human without injecting machine prompts", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async (input: { text: string }) => {
      void input;
      return true;
    });
    const onGuardrailViolation = vi.fn();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle('<orxa_browser_action>{"id":"action-2","action":"click","args":{"selector":"#buy"}}</orxa_browser_action>'),
        ],
        browserModeEnabled: true,
        controlOwner: "human",
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).not.toHaveBeenCalled();
      expect(sendPrompt).not.toHaveBeenCalled();
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
  });

  it("does not replay browser actions that already have ORXA machine results in the transcript", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle(
            '<orxa_browser_action>{"id":"action-7","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>',
          ),
          {
            info: { role: "user" },
            parts: [{ type: "text", text: '[ORXA_BROWSER_RESULT]{"id":"action-7","action":"navigate","ok":true}' }],
          } as unknown as SessionMessageBundle,
        ],
        browserModeEnabled: true,
        controlOwner: "agent",
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).not.toHaveBeenCalled();
      expect(sendPrompt).not.toHaveBeenCalled();
    });
  });

  it("does not execute browser actions while automation is halted for the session", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle('<orxa_browser_action>{"id":"action-8","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>'),
        ],
        browserModeEnabled: true,
        controlOwner: "agent",
        automationHalted: true,
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).not.toHaveBeenCalled();
      expect(sendPrompt).not.toHaveBeenCalled();
    });
  });

  it("attaches screenshot artifacts when browser action returns file metadata", async () => {
    const performAgentAction = vi.fn(async () => ({
      action: "screenshot",
      ok: true,
      data: {
        fileUrl: "file:///tmp/action-3.png",
        mime: "image/png",
        artifactID: "artifact-3",
      },
    }));
    const sendPrompt = vi.fn(async (input: { text: string }) => {
      void input;
      return true;
    });
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle('<orxa_browser_action>{"id":"action-3","action":"screenshot","args":{"tabID":"tab-1"}}</orxa_browser_action>'),
        ],
        browserModeEnabled: true,
        controlOwner: "agent",
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });
    expect(performAgentAction).toHaveBeenCalledWith({
      action: "screenshot",
      tabID: "tab-1",
      workspace: "/repo",
      sessionID: "session-1",
      actionID: "action-3",
    });

    const sentRequest = sendPrompt.mock.calls[0]?.[0] as
      | { attachments?: Array<{ url: string; mime: string }>; promptSource?: string; contextModeEnabled?: boolean; text?: string }
      | undefined;
    expect(sentRequest?.attachments).toEqual([
      {
        url: "file:///tmp/action-3.png",
        mime: "image/png",
      },
    ]);
    expect(sentRequest?.promptSource).toBe("machine");
    expect(sentRequest?.contextModeEnabled).toBe(false);
    expect(sentRequest?.text).toContain('"id":"action-3"');
  });

  it("preserves explicit action context values in envelope args", async () => {
    const performAgentAction = vi.fn(async () => ({ action: "screenshot", ok: true }));
    const sendPrompt = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle(
            '<orxa_browser_action>{"id":"action-4","action":"screenshot","args":{"tabID":"tab-2","workspace":"/explicit","sessionID":"session-override","actionID":"explicit-action-id"}}</orxa_browser_action>',
          ),
        ],
        browserModeEnabled: true,
        controlOwner: "agent",
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });

    expect(performAgentAction).toHaveBeenCalledWith({
      action: "screenshot",
      tabID: "tab-2",
      workspace: "/explicit",
      sessionID: "session-override",
      actionID: "explicit-action-id",
    });
  });

  it("does not replay the same action when status callback identity changes", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    const messages = [
      assistantBundle('<orxa_browser_action>{"id":"action-5","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>'),
    ];

    const { rerender } = renderHook(
      (props: { onStatus: (message: string) => void }) =>
        useBrowserAgentBridge({
          activeProjectDir: "/repo",
          activeSessionID: "session-1",
          messages,
          browserModeEnabled: true,
          controlOwner: "agent",
          onStatus: props.onStatus,
        }),
      {
        initialProps: {
          onStatus: () => undefined,
        },
      },
    );

    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });

    rerender({ onStatus: () => undefined });
    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });
  });

  it("raises guardrail violation when assistant text references forbidden external tooling", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    const onGuardrailViolation = vi.fn();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [assistantBundle("Error: McpError: MCP error -32603: failed to connect to running Pencil app.")],
        browserModeEnabled: true,
        controlOwner: "agent",
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
    expect(performAgentAction).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("raises guardrail violation when web progress is claimed without ORXA browser actions", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    const onGuardrailViolation = vi.fn();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [assistantBundle("Great start! I've loaded the a16z report and captured key points.")],
        browserModeEnabled: true,
        controlOwner: "agent",
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
    expect(performAgentAction).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it("does not raise progress guardrail when ORXA browser action tags are present", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    const onGuardrailViolation = vi.fn();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [
          assistantBundle('<orxa_browser_action>{"id":"action-6","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>'),
          assistantBundle("I've loaded the source and will continue."),
        ],
        browserModeEnabled: true,
        controlOwner: "agent",
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(performAgentAction).toHaveBeenCalledTimes(1);
      expect(sendPrompt).toHaveBeenCalledTimes(1);
    });
    expect(onGuardrailViolation).not.toHaveBeenCalled();
  });

  it("raises guardrail violation when assistant emits forbidden non-ORXA tool parts", async () => {
    const performAgentAction = vi.fn(async () => ({ ok: true }));
    const sendPrompt = vi.fn(async () => true);
    const onGuardrailViolation = vi.fn();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        browser: { performAgentAction },
        opencode: { sendPrompt },
      },
    });

    renderHook(() =>
      useBrowserAgentBridge({
        activeProjectDir: "/repo",
        activeSessionID: "session-1",
        messages: [assistantToolBundle("web_search")],
        browserModeEnabled: true,
        controlOwner: "agent",
        onGuardrailViolation,
      }),
    );

    await waitFor(() => {
      expect(onGuardrailViolation).toHaveBeenCalledTimes(1);
    });
    expect(performAgentAction).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
