import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasPane, type CanvasPaneCanvasState } from "./CanvasPane";
import type { CanvasTile, CanvasTheme } from "../types/canvas";

const DEFAULT_THEME: CanvasTheme = {
  preset: "midnight",
  background: "#0C0C0C",
  tileBorder: "#1F1F1F",
  accent: "#22C55E",
};

function buildCanvasState(overrides: Partial<CanvasPaneCanvasState> = {}): CanvasPaneCanvasState {
  return {
    tiles: [],
    theme: DEFAULT_THEME,
    snapToGrid: false,
    gridSize: 12,
    addTile: vi.fn(),
    removeTile: vi.fn(),
    updateTile: vi.fn(),
    bringToFront: vi.fn(),
    toggleSnap: vi.fn(),
    setTheme: vi.fn(),
    ...overrides,
  };
}

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: "tile-1",
    type: "browser",
    x: 40,
    y: 40,
    width: 548,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { url: "about:blank" },
    ...overrides,
  };
}

describe("CanvasPane", () => {
  it("renders canvas toolbar with add tile button", () => {
    const state = buildCanvasState();
    render(<CanvasPane canvasState={state} />);
    expect(screen.getByRole("button", { name: "Add tile" })).toBeInTheDocument();
  });

  it("displays the tile count from canvasState", () => {
    const state = buildCanvasState({ tiles: [makeTile(), makeTile({ id: "tile-2" })] });
    render(<CanvasPane canvasState={state} />);
    expect(screen.getByText("2 tiles")).toBeInTheDocument();
  });

  it("renders tiles from canvasState", () => {
    const tile = makeTile({ type: "browser", meta: { url: "about:blank" } });
    const state = buildCanvasState({ tiles: [tile] });
    render(<CanvasPane canvasState={state} />);
    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("adds a terminal tile with correct meta including directory", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    // Open the add tile dropdown
    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    // Click "terminal"
    fireEvent.click(screen.getByText("terminal"));

    expect(addTile).toHaveBeenCalledTimes(1);
    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("terminal");
    expect(call.meta).toEqual({ directory: "/workspace/project", cwd: "/workspace/project" });
  });

  it("adds a browser tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("browser"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("browser");
    expect(call.meta).toEqual({ url: "about:blank" });
  });

  it("adds a file_editor tile with correct meta including directory", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("file editor"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("file_editor");
    expect(call.meta).toEqual({ directory: "/workspace/project", filePath: "" });
  });

  it("adds a dev_server tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("dev server"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("dev_server");
    expect(call.meta).toEqual({ directory: "/workspace/project", port: 3000, status: "stopped" });
  });

  it("adds a markdown_preview tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("markdown preview"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("markdown_preview");
    expect(call.meta).toEqual({ directory: "/workspace/project", filePath: "", content: "" });
  });

  it("adds an image_viewer tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("image viewer"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("image_viewer");
    expect(call.meta).toEqual({ filePath: "" });
  });

  it("adds an api_tester tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
    fireEvent.click(screen.getByText("api tester"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("api_tester");
    expect(call.meta).toEqual({ method: "GET", url: "" });
  });

  it("tile count label updates when tiles change", () => {
    const state = buildCanvasState({ tiles: [] });
    const { rerender } = render(<CanvasPane canvasState={state} />);
    expect(screen.getByText("0 tiles")).toBeInTheDocument();

    const updatedState = buildCanvasState({ tiles: [makeTile(), makeTile({ id: "tile-2" }), makeTile({ id: "tile-3" })] });
    rerender(<CanvasPane canvasState={updatedState} />);
    expect(screen.getByText("3 tiles")).toBeInTheDocument();
  });
});
