import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { CodexPane } from "./CodexPane";

const mockOnExit = vi.fn();

function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({ status: "connected" as const, serverInfo: { name: "codex", version: "1.0.0" } })),
    stop: vi.fn(async () => ({ status: "disconnected" as const })),
    getState: vi.fn(async () => ({ status: "disconnected" as const })),
    startThread: vi.fn(async () => ({ id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() })),
    listThreads: vi.fn(async () => ({ threads: [], nextCursor: undefined })),
    listModels: vi.fn(async () => []),
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

function buildDefaultBranchProps() {
  return {
    branchMenuOpen: false,
    setBranchMenuOpen: vi.fn() as Mock<(updater: (value: boolean) => boolean) => void>,
    branchControlWidthCh: 20,
    branchLoading: false,
    branchSwitching: false,
    hasActiveProject: false,
    branchCurrent: undefined,
    branchDisplayValue: "",
    branchSearchInputRef: { current: null },
    branchQuery: "",
    setBranchQuery: vi.fn(),
    branchActionError: null,
    clearBranchActionError: vi.fn(),
    checkoutBranch: vi.fn(),
    filteredBranches: [],
    openBranchCreateModal: vi.fn(),
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

  it("shows unavailable message when codex bridge is not available", () => {
    window.orxa = {
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByText(/codex is not available/i)).toBeInTheDocument();
  });

  it("renders the composer input", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByPlaceholderText(/connecting to codex/i)).toBeInTheDocument();
  });

  it("renders the send button", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("renders the conversation log area", () => {
    window.orxa = {
      codex: buildOrxaCodex(),
      events: buildOrxaEvents(),
    } as unknown as typeof window.orxa;

    render(<CodexPane directory="/workspace/project" onExit={mockOnExit} {...buildDefaultBranchProps()} />);

    expect(screen.getByRole("log", { name: /codex conversation/i })).toBeInTheDocument();
  });
});
