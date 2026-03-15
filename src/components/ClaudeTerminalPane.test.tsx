import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ClaudeTerminalPane } from "./ClaudeTerminalPane";

// xterm uses DOM APIs not available in jsdom — mock it
vi.mock("xterm", () => {
  function Terminal() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      writeln: vi.fn(),
      write: vi.fn(),
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

// ResizeObserver is not in jsdom — use a proper constructor
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const mockOnExit = vi.fn();

function buildOrxaTerminal() {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: "pty-1" })),
    connect: vi.fn(async () => ({})),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  };
}

describe("ClaudeTerminalPane", () => {
  beforeEach(() => {
    mockOnExit.mockReset();
  });

  afterEach(() => {
    // Remove window.orxa after each test
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("renders toolbar with claude code label", () => {
    window.orxa = {
      terminal: buildOrxaTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText("claude code")).toBeInTheDocument();
  });

  it("renders workspace directory path in toolbar", () => {
    window.orxa = {
      terminal: buildOrxaTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/my-project" onExit={mockOnExit} />);

    expect(screen.getByText("/workspace/my-project")).toBeInTheDocument();
  });

  it("renders restart and exit buttons", () => {
    window.orxa = {
      terminal: buildOrxaTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /restart/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  it("shows unavailable message when terminal API is not available", () => {
    // Ensure window.orxa.terminal is absent
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText(/terminal api is not available/i)).toBeInTheDocument();
  });

  it("shows exit button in unavailable state", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });
});
