import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitSidebar } from "./GitSidebar";

const baseProps = {
  sidebarPanelTab: "git" as const,
  setSidebarPanelTab: vi.fn(),
  gitPanelTab: "diff" as const,
  setGitPanelTab: vi.fn(),
  gitPanelOutput: [
    "## Unstaged",
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1 +1 @@",
    "-const a = 1;",
    "+const a = 2;",
  ].join("\n"),
  branchState: null,
  branchQuery: "",
  setBranchQuery: vi.fn(),
  activeProjectDir: "/repo",
  onLoadGitDiff: vi.fn(async () => undefined),
  onLoadGitLog: vi.fn(async () => undefined),
  onLoadGitIssues: vi.fn(async () => undefined),
  onLoadGitPrs: vi.fn(async () => undefined),
  gitDiffViewMode: "list" as const,
  setGitDiffViewMode: vi.fn(),
  onStageAllChanges: vi.fn(async () => undefined),
  onDiscardAllChanges: vi.fn(async () => undefined),
  onStageFile: vi.fn(async () => undefined),
  onRestoreFile: vi.fn(async () => undefined),
  onUnstageFile: vi.fn(async () => undefined),
  onAddToChatPath: vi.fn(),
  onStatusChange: vi.fn(),
};

describe("GitSidebar provenance", () => {
  it("renders provenance labels for known records", () => {
    render(
      <GitSidebar
        {...baseProps}
        fileProvenanceByPath={{
          "src/app.ts": {
            filePath: "src/app.ts",
            operation: "edit",
            actorType: "main",
            actorName: "Main agent",
            eventID: "evt-1",
            timestamp: Date.now(),
            reason: "Edited src/app.ts",
          },
        }}
      />,
    );

    expect(screen.getByText(/Main agent/i)).toBeInTheDocument();
  });

  it("renders unknown provenance fallback when no records exist", () => {
    render(<GitSidebar {...baseProps} fileProvenanceByPath={{}} />);
    expect(screen.getByText(/Unknown provenance/i)).toBeInTheDocument();
  });
});

