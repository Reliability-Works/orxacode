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
      clear: vi.fn(),
      reset: vi.fn(),
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

function buildClaudeTerminal() {
  return {
    list: vi.fn(async () => []),
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
    (
      globalThis as typeof globalThis & {
        __resetClaudeTerminalPaneStateForTests?: () => void;
      }
    ).__resetClaudeTerminalPaneStateForTests?.();
  });

  afterEach(() => {
    // Remove window.orxa after each test
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("renders permission modal when no stored preference", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    expect(screen.getByText("Claude Code Permissions")).toBeInTheDocument();
    expect(screen.getByText("Standard Mode")).toBeInTheDocument();
    expect(screen.getByText("Full Access Mode")).toBeInTheDocument();
  });

  it("renders toolbar with claude code label in permission modal state", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    expect(screen.getByText("claude code")).toBeInTheDocument();
  });

  it("renders workspace directory path in toolbar", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/my-project" sessionStorageKey="/workspace/my-project::claude-session" onExit={mockOnExit} />);

    expect(screen.getByText("/workspace/my-project")).toBeInTheDocument();
  });

  it("launches terminal after choosing standard mode", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Standard Mode"));

    // After choosing, the permission modal should be gone and the terminal toolbar is visible
    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /split/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  it("launches terminal after choosing full access mode", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Full Access Mode"));

    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /split/i })).toBeInTheDocument();
  });

  it("remembers choice when checkbox is checked", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    fireEvent.click(screen.getByText("Remember this choice for this workspace"));
    fireEvent.click(screen.getByText("Standard Mode"));

    expect(localStorage.getItem("claude-permission-mode:/workspace/project")).toBe("standard");
  });

  it("skips modal when stored preference exists", () => {
    localStorage.setItem("claude-permission-mode:/workspace/project", "full");

    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    // Should skip directly to terminal view
    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /split/i })).toBeInTheDocument();
  });

  it("keeps the selected mode for the same session without requiring remember choice", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    const view = render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();

    view.unmount();

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    expect(screen.queryByText("Claude Code Permissions")).not.toBeInTheDocument();
  });

  it("shows unavailable message when claude terminal API is not available", () => {
    // Ensure window.orxa.claudeTerminal is absent
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    // Need to pick a mode first for the unavailable check to trigger
    localStorage.setItem("claude-permission-mode:/workspace/project", "standard");

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    expect(screen.getByText(/terminal api is not available/i)).toBeInTheDocument();
  });

  it("shows exit button in unavailable state", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    localStorage.setItem("claude-permission-mode:/workspace/project", "standard");

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  // ── Multi-tab tests ──

  it("shows tab bar with initial tab after choosing mode", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    // Should show the panel tab bar with at least one tab
    const tabBar = document.querySelector(".claude-panel-tab-bar");
    expect(tabBar).toBeInTheDocument();
  });

  it("adds a new tab when + button is clicked", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    const addBtn = screen.getByRole("button", { name: /new tab/i });
    fireEvent.click(addBtn);

    // Should now have two tabs
    const tabs = document.querySelectorAll(".claude-tab:not(.claude-tab-add)");
    expect(tabs.length).toBe(2);
  });

  it("switches active tab when clicked", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    // Add a second tab
    const addBtn = screen.getByRole("button", { name: /new tab/i });
    fireEvent.click(addBtn);

    // Get the tabs
    const tabs = document.querySelectorAll(".claude-tab:not(.claude-tab-add)");
    expect(tabs.length).toBe(2);

    // Click the first tab
    fireEvent.click(tabs[0]);
    expect(tabs[0].classList.contains("active")).toBe(true);
  });

  // ── Split view tests ──

  it("shows split menu when split button is clicked", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    const splitBtn = screen.getByRole("button", { name: /split/i });
    fireEvent.click(splitBtn);

    expect(screen.getByText("Split horizontal")).toBeInTheDocument();
    expect(screen.getByText("Split vertical")).toBeInTheDocument();
  });

  it("creates a split view when horizontal split is selected", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    const splitBtn = screen.getByRole("button", { name: /split/i });
    fireEvent.click(splitBtn);
    fireEvent.click(screen.getByText("Split horizontal"));

    const container = document.querySelector(".claude-split-container");
    expect(container?.classList.contains("claude-split-horizontal")).toBe(true);

    const panels = document.querySelectorAll(".claude-split-panel");
    expect(panels.length).toBe(2);
  });

  it("creates a split view when vertical split is selected", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    const splitBtn = screen.getByRole("button", { name: /split/i });
    fireEvent.click(splitBtn);
    fireEvent.click(screen.getByText("Split vertical"));

    const container = document.querySelector(".claude-split-container");
    expect(container?.classList.contains("claude-split-vertical")).toBe(true);

    const panels = document.querySelectorAll(".claude-split-panel");
    expect(panels.length).toBe(2);
  });

  it("shows unsplit option when already split", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    // Split first
    const splitBtn = screen.getByRole("button", { name: /split/i });
    fireEvent.click(splitBtn);
    fireEvent.click(screen.getByText("Split horizontal"));

    // Open menu again
    fireEvent.click(splitBtn);
    expect(screen.getByText("Unsplit")).toBeInTheDocument();
  });

  it("removes split when unsplit is selected", () => {
    window.orxa = {
      claudeTerminal: buildClaudeTerminal(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    // Split
    const splitBtn = screen.getByRole("button", { name: /split/i });
    fireEvent.click(splitBtn);
    fireEvent.click(screen.getByText("Split horizontal"));

    // Unsplit
    fireEvent.click(splitBtn);
    fireEvent.click(screen.getByText("Unsplit"));

    const panels = document.querySelectorAll(".claude-split-panel");
    expect(panels.length).toBe(1);
  });

  it("starts Claude via the dedicated claude terminal bridge instead of echoing a shell launch command", () => {
    const claudeTerminal = buildClaudeTerminal();
    const genericTerminal = {
      create: vi.fn(),
      connect: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    };

    window.orxa = {
      claudeTerminal,
      terminal: genericTerminal,
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<ClaudeTerminalPane directory="/workspace/project" sessionStorageKey="/workspace/project::claude-session" onExit={mockOnExit} />);
    fireEvent.click(screen.getByText("Standard Mode"));

    expect(claudeTerminal.create).toHaveBeenCalledWith("/workspace/project", "standard", expect.any(Number), expect.any(Number));
    expect(genericTerminal.create).not.toHaveBeenCalled();
    expect(genericTerminal.write).not.toHaveBeenCalled();
  });
});
