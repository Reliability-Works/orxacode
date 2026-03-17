import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_LANDING_URL,
  EMPTY_BROWSER_RUNTIME_STATE,
  buildBrowserAutopilotHint,
  deriveSessionTitleFromPrompt,
  formatMemoryGraphError,
  isRecoverableSessionError,
  shouldAutoRenameSessionTitle,
  toBrowserSidebarState,
  toneForStatusLine,
} from "./app-session-utils";

describe("app-session-utils", () => {
  it("exposes browser defaults", () => {
    expect(DEFAULT_BROWSER_LANDING_URL).toBe("about:blank");
    expect(EMPTY_BROWSER_RUNTIME_STATE).toEqual({
      partition: "persist:orxa-browser",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      tabs: [],
      activeTabID: undefined,
    });
  });

  it("classifies toast tone from status text", () => {
    expect(toneForStatusLine("   ")).toBeNull();
    expect(toneForStatusLine("request failed with timeout")).toBe("error");
    expect(toneForStatusLine("warning: retry operation")).toBe("warning");
    expect(toneForStatusLine("all systems nominal")).toBeNull();
  });

  it("detects recoverable session errors from message or code", () => {
    expect(isRecoverableSessionError("No such file in workspace")).toBe(true);
    expect(isRecoverableSessionError("Unknown fatal", "ENOENT")).toBe(true);
    expect(isRecoverableSessionError("Unhandled error", "EPIPE")).toBe(false);
  });

  it("builds browser autopilot hint only for web-like prompts", () => {
    expect(buildBrowserAutopilotHint("write unit tests")).toBeUndefined();

    const forUrl = buildBrowserAutopilotHint("open https://example.com and summarize");
    expect(forUrl).toContain("Auto Browser Skill Triggered");
    expect(forUrl).toContain("Use URLs mentioned by the user as first navigation targets.");

    const forResearch = buildBrowserAutopilotHint("research the latest changelog updates");
    expect(forResearch).toContain("For research tasks, follow a loop: navigate, wait_for_idle, extract_text, then summarize.");
  });

  it("projects runtime browser data into sidebar state", () => {
    const state = toBrowserSidebarState({
      runtimeState: {
        partition: "persist:orxa-browser",
        bounds: { x: 10, y: 20, width: 800, height: 600 },
        tabs: [
          {
            id: "tab-1",
            url: "https://example.com",
            title: "",
            loading: false,
            canGoBack: true,
            canGoForward: false,
          },
          {
            id: "tab-2",
            url: "https://news.example.com",
            title: "News",
            loading: true,
            canGoBack: false,
            canGoForward: true,
          },
        ],
        activeTabID: "tab-2",
      },
      history: [
        { id: "h-1", url: "https://a.example.com", title: "", visitedAt: 1 },
        { id: "h-2", url: "https://b.example.com", title: "B", visitedAt: 2 },
      ],
      modeEnabled: true,
      controlOwner: "agent",
      actionRunning: true,
      canStop: true,
    });

    expect(state.activeTabID).toBe("tab-2");
    expect(state.activeUrl).toBe("https://news.example.com");
    expect(state.tabs[0]).toMatchObject({
      id: "tab-1",
      title: "https://example.com",
      isActive: false,
    });
    expect(state.history).toEqual([
      { id: "h-1", label: "https://a.example.com", url: "https://a.example.com" },
      { id: "h-2", label: "B", url: "https://b.example.com" },
    ]);
    expect(state.canGoBack).toBe(false);
    expect(state.canGoForward).toBe(true);
    expect(state.isLoading).toBe(true);
  });

  it("handles session title helpers", () => {
    expect(shouldAutoRenameSessionTitle(undefined)).toBe(true);
    expect(shouldAutoRenameSessionTitle("Untitled Session")).toBe(true);
    expect(shouldAutoRenameSessionTitle("My task")).toBe(false);

    expect(deriveSessionTitleFromPrompt("  Build   parser ✅ now  ")).toBe("Build parser  now");
    expect(deriveSessionTitleFromPrompt("")).toBe("New session");
    expect(deriveSessionTitleFromPrompt("a".repeat(80), 10)).toBe("aaaaaaa...");
  });

  it("formats memory graph IPC errors with actionable copy", () => {
    expect(formatMemoryGraphError(new Error("No handler registered for 'orxa:opencode:memory:getGraph'"))).toContain(
      "Memory IPC handlers are unavailable",
    );
    expect(formatMemoryGraphError(new Error("something else"))).toBe("something else");
    expect(formatMemoryGraphError("plain error")).toBe("plain error");
  });
});
