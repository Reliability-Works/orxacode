import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";

const terminalWriteMocks: Array<ReturnType<typeof vi.fn>> = [];

vi.mock("xterm", () => {
  function Terminal() {
    const write = vi.fn();
    terminalWriteMocks.push(write);
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      write,
      writeln: vi.fn(),
      cols: 80,
      rows: 24,
    };
  }
  return { Terminal };
});

vi.mock("xterm-addon-fit", () => {
  function FitAddon() {
    return { fit: vi.fn() };
  }
  return { FitAddon };
});

vi.mock("xterm/css/xterm.css", () => ({}));

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

describe("TerminalPanel", () => {
  beforeEach(() => {
    terminalWriteMocks.length = 0;
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        terminal: {
          connect: vi.fn(async () => ({ connected: true })),
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    });
  });

  it("keeps both the tab label and close affordance mounted so hover does not swap content", () => {
    const { container } = render(
      <TerminalPanel
        directory="/workspace/project"
        tabs={[{ id: "tab-1", label: "Tab 1" }]}
        activeTabId="tab-1"
        open
        onCreateTab={vi.fn(async () => undefined)}
        onCloseTab={vi.fn(async () => undefined)}
        onSwitchTab={vi.fn()}
      />,
    );

    const tab = container.querySelector(".terminal-tab");
    expect(tab?.querySelector(".terminal-tab-label")?.textContent).toBe("Tab 1");
    expect(tab?.querySelector(".terminal-tab-close")).toBeTruthy();

    fireEvent.mouseEnter(tab!);

    expect(tab?.querySelector(".terminal-tab-label")?.textContent).toBe("Tab 1");
    expect(tab?.querySelector(".terminal-tab-close")).toBeTruthy();
  });

  it("renders a resize handle and forwards drag start events when open", () => {
    const onResizeStart = vi.fn();
    const { getByRole } = render(
      <TerminalPanel
        directory="/workspace/project"
        tabs={[{ id: "tab-1", label: "Tab 1" }]}
        activeTabId="tab-1"
        open
        height={240}
        onCreateTab={vi.fn(async () => undefined)}
        onCloseTab={vi.fn(async () => undefined)}
        onSwitchTab={vi.fn()}
        onResizeStart={onResizeStart}
      />,
    );

    fireEvent.mouseDown(getByRole("button", { name: "Resize integrated terminal" }));
    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it("suppresses the PTY cursor connect artifact before writing to xterm", async () => {
    render(
      <TerminalPanel
        directory="/workspace/project"
        tabs={[{ id: "tab-1", label: "Tab 1" }]}
        activeTabId="tab-1"
        open
        onCreateTab={vi.fn(async () => undefined)}
        onCloseTab={vi.fn(async () => undefined)}
        onSwitchTab={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(window.orxa.events.subscribe).toHaveBeenCalledTimes(1);
    });

    const subscribe = window.orxa.events.subscribe as unknown as ReturnType<typeof vi.fn>;
    const listener = subscribe.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");

    listener({
      type: "pty.output",
      payload: {
        ptyID: "tab-1",
        directory: "/workspace/project",
        chunk: '{"cursor":0}%                                                                                                                                          ',
      },
    });

    expect(terminalWriteMocks[0]).toBeDefined();
    expect(terminalWriteMocks[0]).not.toHaveBeenCalled();
  });

  it("refits and resizes the active PTY when the panel height changes", async () => {
    const resizeMock = vi.fn(async () => true);
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        terminal: {
          connect: vi.fn(async () => ({ connected: true })),
          resize: resizeMock,
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    });

    const view = render(
      <TerminalPanel
        directory="/workspace/project"
        tabs={[{ id: "tab-1", label: "Tab 1" }]}
        activeTabId="tab-1"
        open
        height={180}
        onCreateTab={vi.fn(async () => undefined)}
        onCloseTab={vi.fn(async () => undefined)}
        onSwitchTab={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(resizeMock).toHaveBeenCalled();
    });

    const callsBefore = resizeMock.mock.calls.length;
    view.rerender(
      <TerminalPanel
        directory="/workspace/project"
        tabs={[{ id: "tab-1", label: "Tab 1" }]}
        activeTabId="tab-1"
        open
        height={260}
        onCreateTab={vi.fn(async () => undefined)}
        onCloseTab={vi.fn(async () => undefined)}
        onSwitchTab={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(resizeMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
