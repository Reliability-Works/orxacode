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
  it("renders all session type options when open", () => {
    renderPicker();
    expect(screen.getByText("opencode session")).toBeInTheDocument();
    expect(screen.getByText("canvas session")).toBeInTheDocument();
    expect(screen.getByText("claude chat session")).toBeInTheDocument();
    expect(screen.getByText("claude terminal session")).toBeInTheDocument();
    expect(screen.getByText("codex session")).toBeInTheDocument();
  });

  it("renders nothing when not open", () => {
    renderPicker({ isOpen: false });
    expect(screen.queryByText("opencode session")).not.toBeInTheDocument();
    expect(screen.queryByText("canvas session")).not.toBeInTheDocument();
    expect(screen.queryByText("claude chat session")).not.toBeInTheDocument();
    expect(screen.queryByText("claude terminal session")).not.toBeInTheDocument();
    expect(screen.queryByText("codex session")).not.toBeInTheDocument();
  });

  it("clicking opencode calls onPick with 'standalone'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("opencode session"));
    expect(onPick).toHaveBeenCalledWith("standalone");
  });

  it("clicking canvas calls onPick with 'canvas'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("canvas session"));
    expect(onPick).toHaveBeenCalledWith("canvas");
  });

  it("clicking claude chat calls onPick with 'claude-chat'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("claude chat session"));
    expect(onPick).toHaveBeenCalledWith("claude-chat");
  });

  it("clicking claude terminal calls onPick with 'claude'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("claude terminal session"));
    expect(onPick).toHaveBeenCalledWith("claude");
  });

  it("clicking codex calls onPick with 'codex'", () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText("codex session"));
    expect(onPick).toHaveBeenCalledWith("codex");
  });

  it("escape key calls onClose", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
