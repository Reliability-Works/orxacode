import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnifiedTimelineRowView } from "./UnifiedTimelineRow";
import type { UnifiedTimelineRenderRow } from "./unified-timeline-model";

function buildPlanRow(content: string): UnifiedTimelineRenderRow {
  return {
    id: "plan-row-1",
    kind: "plan-card",
    content,
  };
}

describe("UnifiedTimelineRowView plan card", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders markdown content in the plan body", () => {
    const { container } = render(
      <UnifiedTimelineRowView row={buildPlanRow("## Plan\n\n- First step\n- Second step")} />,
    );

    expect(container.querySelector(".message-card.message-assistant .plan-card-bubble")).toBeInTheDocument();
    expect(container.querySelector(".plan-card-bubble-body .part-text-md")).toBeInTheDocument();
    expect(container.querySelector(".plan-card-bubble-fallback")).toBeNull();
    expect(screen.getByText("Plan", { selector: ".md-h2" })).toBeInTheDocument();
    expect(screen.getByText("First step")).toBeInTheDocument();
    expect(screen.getByText("Second step")).toBeInTheDocument();
  });

  it("shows an expand toggle only when the collapsed plan would overflow", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(480);

    const { container } = render(
      <UnifiedTimelineRowView row={buildPlanRow("## Plan\n\n- First step\n- Second step")} />,
    );

    const toggle = await screen.findByRole("button", { name: /expand plan/i });
    expect(container.querySelector(".plan-card-bubble--collapsible")).toBeInTheDocument();
    expect(container.querySelector(".plan-card-bubble--expanded")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: /collapse plan/i })).toBeInTheDocument();
    expect(container.querySelector(".plan-card-bubble--expanded")).toBeInTheDocument();
  });

  it("does not show an expand toggle when the plan fits within the collapsed height", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(200);

    render(<UnifiedTimelineRowView row={buildPlanRow("## Plan\n\n- First step\n- Second step")} />);

    expect(screen.queryByRole("button", { name: /expand plan/i })).toBeNull();
  });

  it("falls back to plain text when markdown render has no visible text nodes", () => {
    const { container } = render(<UnifiedTimelineRowView row={buildPlanRow("<!-- hidden plan -->")} />);

    expect(container.querySelector(".plan-card-bubble-body .part-text-md")).toBeNull();
    expect(screen.getByText("<!-- hidden plan -->")).toBeInTheDocument();
  });
});
