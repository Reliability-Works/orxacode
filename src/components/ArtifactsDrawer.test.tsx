import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactRecord } from "@shared/ipc";
import { ArtifactsDrawer } from "./ArtifactsDrawer";

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: "artifact-1",
    workspace: "global",
    workspaceHash: "hash-global",
    sessionID: "browser",
    kind: "browser.screenshot",
    createdAt: Date.now() - 1_000,
    mime: "image/png",
    sizeBytes: 2048,
    ...overrides,
  };
}

describe("ArtifactsDrawer app-private scope", () => {
  it("renders app-private artifacts and allows switching scopes", () => {
    const onTabChange = vi.fn();

    render(
      <ArtifactsDrawer
        open
        tab="app"
        onTabChange={onTabChange}
        sessionArtifacts={[]}
        workspaceArtifacts={[]}
        appArtifacts={[makeArtifact()]}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("tab", { name: "App" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 app-private artifacts not bound to workspace/session")).toBeInTheDocument();
    expect(screen.getByText("Workspace:")).toBeInTheDocument();
    expect(screen.getByText("global")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Session" }));
    expect(onTabChange).toHaveBeenCalledWith("session");
  });
});
