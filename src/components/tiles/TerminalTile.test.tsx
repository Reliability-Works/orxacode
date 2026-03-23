import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalTile } from "./TerminalTile";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";

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

vi.mock("../CanvasTile", () => ({
  CanvasTileComponent: ({ children, label, metadata }: { children: ReactNode; label: string; metadata?: string }) => (
    <div>
      <div>{label}</div>
      {metadata ? <div>{metadata}</div> : null}
      {children}
    </div>
  ),
}));

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const DEFAULT_THEME: CanvasTheme = {
  preset: "midnight",
  background: "#0C0C0C",
  tileBorder: "#1F1F1F",
  accent: "#22C55E",
};

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: "terminal-1",
    type: "terminal",
    x: 40,
    y: 40,
    width: 560,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { directory: "/workspace/project", cwd: "/workspace/project" },
    ...overrides,
  };
}

function renderTerminalTile(tileOverrides: Partial<CanvasTile> = {}) {
  return render(
    <TerminalTile
      tile={makeTile(tileOverrides)}
      canvasTheme={DEFAULT_THEME}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      onBringToFront={vi.fn()}
    />,
  );
}

describe("TerminalTile", () => {
  beforeEach(() => {
    terminalWriteMocks.length = 0;
    vi.useRealTimers();
    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        terminal: {
          create: vi.fn(async () => ({ id: "pty-1" })),
          connect: vi.fn(async () => ({ connected: true, ptyID: "pty-1", directory: "/workspace/project" })),
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

  it("retries transient PTY connect failures before subscribing to output", async () => {
    const connectMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unexpected server response: 500"))
      .mockResolvedValue({ connected: true, ptyID: "pty-1", directory: "/workspace/project" });

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        terminal: {
          create: vi.fn(async () => ({ id: "pty-1" })),
          connect: connectMock,
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    });

    renderTerminalTile();

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(2);
    }, { timeout: 4000 });

    expect(window.orxa.events.subscribe).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(window.orxa.terminal.resize).toHaveBeenCalledWith("/workspace/project", "pty-1", 80, 24);
    });
    await waitFor(() => {
      expect(screen.queryByText("Connecting terminal...")).not.toBeInTheDocument();
    });
  });

  it("shows a visible error when PTY connect never succeeds", async () => {
    const connectMock = vi.fn(async () => {
      throw new Error("Unexpected server response: 500");
    });

    Object.defineProperty(window, "orxa", {
      configurable: true,
      value: {
        terminal: {
          create: vi.fn(async () => ({ id: "pty-1" })),
          connect: connectMock,
          resize: vi.fn(async () => true),
          write: vi.fn(async () => true),
          close: vi.fn(async () => true),
        },
        events: {
          subscribe: vi.fn(() => vi.fn()),
        },
      },
    });

    renderTerminalTile();

    await waitFor(() => {
      expect(screen.getByText("Unexpected server response: 500")).toBeInTheDocument();
    }, { timeout: 4000 });

    expect(connectMock).toHaveBeenCalledTimes(5);
    expect(window.orxa.events.subscribe).not.toHaveBeenCalled();
  });
});
