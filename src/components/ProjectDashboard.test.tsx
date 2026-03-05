import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectDashboard } from "./ProjectDashboard";

type DashboardProps = Parameters<typeof ProjectDashboard>[0];

function buildProps(overrides: Partial<DashboardProps> = {}): DashboardProps {
  return {
    loading: false,
    sessionCount: 12,
    sessions7d: 4,
    sessions30d: 10,
    tokenInput30d: 12_500,
    tokenOutput30d: 8_100,
    tokenCacheRead30d: 2_700,
    totalCost30d: 12.34,
    topModels: [{ model: "openai/gpt-5", count: 7 }],
    updatedAt: Date.now() - 60_000,
    error: undefined,
    agentsDocument: { path: "/repo/AGENTS.md", content: "# Rules", exists: true },
    agentsDraft: "# Rules",
    agentsLoading: false,
    agentsSaving: false,
    onAgentsDraftChange: vi.fn(),
    onCreateAgents: vi.fn(),
    onSaveAgents: vi.fn(),
    onRefresh: vi.fn(),
    onRefreshAgents: vi.fn(),
    workspaceContextFiles: [
      {
        id: "ctx-1",
        title: "Architecture decisions",
        filename: "architecture.md",
        updatedAt: Date.now() - 5 * 60_000,
      },
    ],
    workspaceArtifactsSummary: {
      artifacts: 5,
      sessions: 2,
      screenshots: 3,
      contextSelections: 2,
      lastCreatedAt: Date.now() - 2 * 60_000,
    },
    onViewAllWorkspaceContext: vi.fn(),
    onAddWorkspaceContext: vi.fn(),
    onViewAllWorkspaceArtifacts: vi.fn(),
    ...overrides,
  };
}

describe("ProjectDashboard workspace context and artifacts", () => {
  it("renders workspace context and artifact summaries", () => {
    render(<ProjectDashboard {...buildProps()} />);

    expect(screen.getByRole("heading", { name: "Workspace Context" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Workspace Artifacts" })).toBeInTheDocument();
    expect(screen.getByText("Architecture decisions")).toBeInTheDocument();
    expect(screen.getByText("Total Artifacts")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("fires workspace action callbacks", () => {
    const onViewAllWorkspaceContext = vi.fn();
    const onAddWorkspaceContext = vi.fn();
    const onViewAllWorkspaceArtifacts = vi.fn();

    render(
      <ProjectDashboard
        {...buildProps({
          onViewAllWorkspaceContext,
          onAddWorkspaceContext,
          onViewAllWorkspaceArtifacts,
        })}
      />,
    );

    const viewAllButtons = screen.getAllByRole("button", { name: "View all" });
    fireEvent.click(viewAllButtons[0]);
    fireEvent.click(viewAllButtons[1]);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onViewAllWorkspaceContext).toHaveBeenCalledTimes(1);
    expect(onViewAllWorkspaceArtifacts).toHaveBeenCalledTimes(1);
    expect(onAddWorkspaceContext).toHaveBeenCalledTimes(1);
  });
});
