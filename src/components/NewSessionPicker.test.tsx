import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NewSessionPicker } from "./NewSessionPicker";
import type { SessionType } from "../types/canvas";

function renderPicker(overrides: { isOpen?: boolean; onPick?: (type: SessionType) => void; onClose?: () => void } = {}) {
  const onPick = overrides.onPick ?? (vi.fn() as unknown as (type: SessionType) => void);
  const onClose = overrides.onClose ?? (vi.fn() as unknown as () => void);
  const isOpen = overrides.isOpen ?? true;

  render(<NewSessionPicker isOpen={isOpen} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
}

describe("NewSessionPicker", () => {
  it("renders both session type options when open", () => {
    renderPicker();
    expect(screen.getByText("standalone session")).toBeInTheDocument();
    expect(screen.getByText("canvas session")).toBeInTheDocument();
  });

  it("renders nothing when not open", () => {
    renderPicker({ isOpen: false });
    expect(screen.queryByText("standalone session")).not.toBeInTheDocument();
    expect(screen.queryByText("canvas session")).not.toBeInTheDocument();
  });

  it("clicking standalone calls onPick with 'standalone'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("standalone session"));
    expect(onPick).toHaveBeenCalledWith("standalone");
  });

  it("clicking canvas calls onPick with 'canvas'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("canvas session"));
    expect(onPick).toHaveBeenCalledWith("canvas");
  });

  it("escape key calls onClose", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
