import { render, screen, fireEvent } from "@testing-library/react";
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

function buildOrxaClaudeTerminal() {
  return {
    create: vi.fn(async () => ({ processId: "claude-term-1", directory: "/workspace/project" })),
    write: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    close: vi.fn(async () => true),
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
    localStorage.clear();
  });

  afterEach(() => {
    // Remove window.orxa after each test
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("renders permission modal when no stored preference", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText("Claude Code Permissions")).toBeInTheDocument();
    expect(screen.getByText("Standard Mode")).toBeInTheDocument();
    expect(screen.getByText("Full Access Mode")).toBeInTheDocument();
  });

  it("renders toolbar with claude code label in permission modal state", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText("claude code")).toBeInTheDocument();
  });

  it("renders workspace directory path in toolbar", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/my-project" onExit={mockOnExit} />);

    expect(screen.getByText("/workspace/my-project")).toBeInTheDocument();
  });

  it("launches terminal after choosing standard mode", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Standard Mode"));

    // After choosing, the permission modal should be gone
    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  it("launches terminal after choosing full access mode", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Full Access Mode"));

    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeInTheDocument();
  });

  it("remembers choice when checkbox is checked", () => {
    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Remember this choice for this workspace"));
    fireEvent.click(screen.getByText("Standard Mode"));

    expect(localStorage.getItem("claude-permission-mode:/workspace/project")).toBe("standard");
  });

  it("skips modal when stored preference exists", () => {
    localStorage.setItem("claude-permission-mode:/workspace/project", "full");

    window.orxa = {
      claudeTerminal: buildOrxaClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    // Should skip directly to terminal view
    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart/i })).toBeInTheDocument();
  });

  it("shows unavailable message when claude terminal API is not available", () => {
    // Ensure window.orxa.claudeTerminal is absent
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    // Need to pick a mode first for the unavailable check to trigger
    localStorage.setItem("claude-permission-mode:/workspace/project", "standard");

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText(/terminal api is not available/i)).toBeInTheDocument();
  });

  it("shows exit button in unavailable state", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    localStorage.setItem("claude-permission-mode:/workspace/project", "standard");

    render(<ClaudeTerminalPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });
});
