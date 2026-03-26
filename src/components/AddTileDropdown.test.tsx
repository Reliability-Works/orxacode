import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddTileDropdown } from "./AddTileDropdown";
import type { CanvasTile } from "../types/canvas";

type TileType = CanvasTile["type"];

function renderDropdown(overrides: { onAddTile?: (type: TileType) => void; onClose?: () => void } = {}) {
  const onAddTile = overrides.onAddTile ?? (vi.fn() as unknown as (type: TileType) => void);
  const onClose = overrides.onClose ?? (vi.fn() as unknown as () => void);

  render(<AddTileDropdown onAddTile={onAddTile} onClose={onClose} />);
  return { onAddTile, onClose };
}

describe("AddTileDropdown", () => {
  it("renders all 10 tile type options", () => {
    renderDropdown();
    expect(screen.getByText("terminal")).toBeInTheDocument();
    expect(screen.getByText("claude code")).toBeInTheDocument();
    expect(screen.getByText("codex cli")).toBeInTheDocument();
    expect(screen.getByText("opencode")).toBeInTheDocument();
    expect(screen.getByText("browser")).toBeInTheDocument();
    expect(screen.getByText("file editor")).toBeInTheDocument();
    expect(screen.getByText("dev server")).toBeInTheDocument();
    expect(screen.getByText("markdown preview")).toBeInTheDocument();
    expect(screen.getByText("image viewer")).toBeInTheDocument();
    expect(screen.getByText("api tester")).toBeInTheDocument();
  });

  it("search filters the list", () => {
    renderDropdown();
    const searchInput = screen.getByPlaceholderText("search...");
    fireEvent.change(searchInput, { target: { value: "term" } });

    expect(screen.getByText("terminal")).toBeInTheDocument();
    expect(screen.queryByText("browser")).not.toBeInTheDocument();
    expect(screen.queryByText("file editor")).not.toBeInTheDocument();
  });

  it("clicking a type calls onAddTile with correct type", () => {
    const { onAddTile } = renderDropdown();
    fireEvent.click(screen.getByText("claude code"));
    expect(onAddTile).toHaveBeenCalledWith("claude_code");
  });

  it("clicking a type also calls onClose", () => {
    const { onClose } = renderDropdown();
    fireEvent.click(screen.getByText("browser"));
    expect(onClose).toHaveBeenCalled();
  });

  it("escape key calls onClose", () => {
    const { onClose } = renderDropdown();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows 'no results' when search matches nothing", () => {
    renderDropdown();
    const searchInput = screen.getByPlaceholderText("search...");
    fireEvent.change(searchInput, { target: { value: "zzzznothing" } });
    expect(screen.getByText("no results")).toBeInTheDocument();
  });
});
