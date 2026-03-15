import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CodexPane } from "./CodexPane";

const mockOnExit = vi.fn();

function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({ status: "connected" as const, serverInfo: { name: "codex", version: "1.0.0" } })),
    stop: vi.fn(async () => ({ status: "disconnected" as const })),
    getState: vi.fn(async () => ({ status: "disconnected" as const })),
    startThread: vi.fn(async () => ({ id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() })),
    listThreads: vi.fn(async () => ({ threads: [], nextCursor: undefined })),
    startTurn: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    deny: vi.fn(async () => undefined),
  };
}

function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  };
}

describe("CodexPane", () => {
  beforeEach(() => {
    mockOnExit.mockReset();
  });

  afterEach(() => {
    // @ts-expect-error test teardown
    delete window.orxa;
  });

  it("renders toolbar with codex label", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText("codex")).toBeInTheDocument();
  });

  it("renders workspace directory path in toolbar", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/my-project" onExit={mockOnExit} />);

    expect(screen.getByText("/workspace/my-project")).toBeInTheDocument();
  });

  it("renders exit button", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /exit/i })).toBeInTheDocument();
  });

  it("clicking exit calls onExit", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(mockOnExit).toHaveBeenCalled();
  });

  it("shows unavailable message when codex bridge is not available", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByText(/codex is not available/i)).toBeInTheDocument();
  });

  it("renders the composer input", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByPlaceholderText(/connecting to codex/i)).toBeInTheDocument();
  });

  it("renders the send button", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("renders the conversation log area", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} />);

    expect(screen.getByRole("log", { name: /codex conversation/i })).toBeInTheDocument();
  });
});
