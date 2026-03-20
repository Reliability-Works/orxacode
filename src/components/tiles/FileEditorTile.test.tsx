import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileEditorTile } from "./FileEditorTile";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";

const DEFAULT_THEME: CanvasTheme = {
  preset: "midnight",
  background: "#0C0C0C",
  tileBorder: "#1F1F1F",
  accent: "#22C55E",
};

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: "editor-1",
    type: "file_editor",
    x: 40,
    y: 40,
    width: 380,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { directory: "/workspace/project", filePath: "" },
    ...overrides,
  };
}

function renderEditorTile(tileOverrides: Partial<CanvasTile> = {}, handlers: { onUpdate?: (id: string, patch: Partial<CanvasTile>) => void } = {}) {
  const onUpdate = handlers.onUpdate ?? (vi.fn() as unknown as (id: string, patch: Partial<CanvasTile>) => void);
  const onRemove = vi.fn() as unknown as (id: string) => void;
  const onBringToFront = vi.fn() as unknown as (id: string) => void;
  const tile = makeTile(tileOverrides);

  render(
    <FileEditorTile
      tile={tile}
      canvasTheme={DEFAULT_THEME}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
    />,
  );

  return { onUpdate, onRemove, onBringToFront };
}

describe("FileEditorTile", () => {
  it("renders with placeholder when no file selected", () => {
    renderEditorTile();
    const textarea = screen.getByRole("textbox", { name: /file editor/i });
    expect(textarea).toHaveValue("// Select a file from the tree to begin editing.");
  });

  it("shows 'untitled' as metadata when no filePath", () => {
    renderEditorTile();
    expect(screen.getByText("untitled")).toBeInTheDocument();
  });

  it("shows filename in metadata when filePath is set", () => {
    renderEditorTile({ meta: { directory: "/workspace", filePath: "/workspace/src/App.tsx" } });
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("shows line numbers", () => {
    renderEditorTile();
    // Placeholder has 1 line
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("content changes update tile meta via onUpdate", () => {
    const onUpdate = vi.fn();
    renderEditorTile({}, { onUpdate });

    const textarea = screen.getByRole("textbox", { name: /file editor/i });
    fireEvent.change(textarea, { target: { value: "const x = 1;" } });

    expect(onUpdate).toHaveBeenCalledWith(
      "editor-1",
      expect.objectContaining({
        meta: expect.objectContaining({ content: "const x = 1;" }),
      }),
    );
  });

  it("renders file editor label in header", () => {
    renderEditorTile();
    expect(screen.getByText("file editor")).toBeInTheDocument();
  });

  it("line count updates when content changes", () => {
    renderEditorTile();
    const textarea = screen.getByRole("textbox", { name: /file editor/i });
    fireEvent.change(textarea, { target: { value: "line1\nline2\nline3" } });

    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
