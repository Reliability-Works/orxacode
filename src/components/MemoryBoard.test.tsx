import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryGraphSnapshot } from "@shared/ipc";
import { MemoryBoard } from "./MemoryBoard";

vi.mock("react-cytoscapejs", () => ({
  default: ({ elements }: { elements: Array<unknown> }) => (
    <div data-testid="cy-mock">{String(elements.length)}</div>
  ),
}));

afterEach(() => {
  cleanup();
});

function graphFixture(): MemoryGraphSnapshot {
  return {
    nodes: [
      {
        id: "n1",
        workspace: "/repo-a",
        summary: "Alpha memory",
        content: "Alpha detail",
        confidence: 0.8,
        tags: ["preference"],
        source: { sessionID: "s1", actor: "user" },
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: "n2",
        workspace: "/repo-b",
        summary: "Beta memory",
        content: "Beta detail",
        confidence: 0.7,
        tags: ["decision"],
        source: { sessionID: "s2", actor: "assistant" },
        createdAt: 3,
        updatedAt: 4,
      },
    ],
    edges: [
      {
        id: "e1",
        workspace: "/repo-a",
        from: "n1",
        to: "n2",
        relation: "related",
        weight: 1,
        createdAt: 5,
        updatedAt: 6,
      },
    ],
    workspaces: ["/repo-a", "/repo-b"],
    updatedAt: 10,
  };
}

describe("MemoryBoard", () => {
  it("renders graph controls and dispatches actions", () => {
    const onRefresh = vi.fn();
    const onPrepareBackfillSession = vi.fn();
    const onWorkspaceFilterChange = vi.fn();
    render(
      <MemoryBoard
        snapshot={graphFixture()}
        loading={false}
        workspaceFilter="all"
        onWorkspaceFilterChange={onWorkspaceFilterChange}
        onRefresh={onRefresh}
        onPrepareBackfillSession={onPrepareBackfillSession}
        preparingBackfillSession={false}
        backfillStatus={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Memory Graph" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: /repo-b/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onPrepareBackfillSession).not.toHaveBeenCalled();
    expect(onWorkspaceFilterChange).toHaveBeenCalledWith("/repo-b");
  });

  it("shows backfill progress and prepare-session action in empty state", () => {
    const onPrepareBackfillSession = vi.fn();
    render(
      <MemoryBoard
        snapshot={{ nodes: [], edges: [], workspaces: [], updatedAt: Date.now() }}
        loading={false}
        workspaceFilter="all"
        onWorkspaceFilterChange={() => undefined}
        onRefresh={() => undefined}
        onPrepareBackfillSession={onPrepareBackfillSession}
        preparingBackfillSession={false}
        backfillStatus={{
          running: true,
          progress: 0.5,
          scannedSessions: 5,
          totalSessions: 10,
          inserted: 3,
          updated: 1,
          message: "Backfilling",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Prepare Backfill Session" }));

    expect(onPrepareBackfillSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText("No memories available for this filter.")).toBeInTheDocument();
  });
});
