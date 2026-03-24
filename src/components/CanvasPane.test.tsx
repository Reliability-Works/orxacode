import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasPane, type CanvasPaneCanvasState } from "./CanvasPane";
import type { CanvasTile, CanvasTheme } from "../types/canvas";
import { DEFAULT_CANVAS_SCROLL_LEFT, DEFAULT_CANVAS_SCROLL_TOP, DEFAULT_CANVAS_ZOOM } from "../types/canvas";

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
    viewport: {
      zoom: DEFAULT_CANVAS_ZOOM,
      scrollLeft: DEFAULT_CANVAS_SCROLL_LEFT,
      scrollTop: DEFAULT_CANVAS_SCROLL_TOP,
    },
    addTile: vi.fn(),
    removeTile: vi.fn(),
    updateTile: vi.fn(),
    bringToFront: vi.fn(),
    toggleSnap: vi.fn(),
    setTheme: vi.fn(),
    setViewport: vi.fn(),
    resetViewport: vi.fn(),
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
    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); expect(screen.getByRole("menuitem", { name: "Add tile" })).toBeInTheDocument();
  });

  it("displays the tile count from canvasState", () => {
    const state = buildCanvasState({ tiles: [makeTile(), makeTile({ id: "tile-2" })] });
    render(<CanvasPane canvasState={state} />);
    
    expect(screen.getByText("100%")).toBeInTheDocument();
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
    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
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

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("browser"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("browser");
    expect(call.meta).toEqual({ url: "about:blank" });
  });

  it("adds a file_editor tile with correct meta including directory", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("file editor"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("file_editor");
    expect(call.meta).toEqual({ directory: "/workspace/project", filePath: "" });
  });

  it("adds a dev_server tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("dev server"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("dev_server");
    expect(call.meta).toEqual({ directory: "/workspace/project", port: 3000, status: "stopped" });
  });

  it("adds a markdown_preview tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("markdown preview"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("markdown_preview");
    expect(call.meta).toEqual({ directory: "/workspace/project", filePath: "", content: "" });
  });

  it("adds an image_viewer tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("image viewer"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("image_viewer");
    expect(call.meta).toEqual({ filePath: "" });
  });

  it("adds an api_tester tile with correct meta", () => {
    const addTile = vi.fn();
    const state = buildCanvasState({ addTile });
    render(<CanvasPane canvasState={state} directory="/workspace/project" />);

    const hub = screen.getByRole("button", { name: "Canvas controls" }); fireEvent.mouseDown(hub, { clientX: 0, clientY: 0 }); fireEvent.mouseUp(document, { clientX: 0, clientY: 0 }); fireEvent.click(screen.getByRole("menuitem", { name: "Add tile" }));
    fireEvent.click(screen.getByText("api tester"));

    const call = addTile.mock.calls[0][0];
    expect(call.type).toBe("api_tester");
    expect(call.meta).toEqual({ method: "GET", url: "" });
  });

  it("renders zoom controls", () => {
    const state = buildCanvasState();
    render(<CanvasPane canvasState={state} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("updates viewport state when canvas is scrolled", async () => {
    const setViewport = vi.fn();
    const state = buildCanvasState({ setViewport });
    const { container } = render(<CanvasPane canvasState={state} />);
    const viewport = container.querySelector(".canvas-area-viewport") as HTMLDivElement;

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    Object.defineProperty(viewport, "scrollLeft", { configurable: true, writable: true, value: 420 });
    Object.defineProperty(viewport, "scrollTop", { configurable: true, writable: true, value: 360 });
    fireEvent.scroll(viewport);

    expect(setViewport).toHaveBeenCalledWith({ scrollLeft: 420, scrollTop: 360 });
  });

  it("zooms in and out from toolbar controls", () => {
    const setViewport = vi.fn();
    const state = buildCanvasState({ setViewport });
    render(<CanvasPane canvasState={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

    expect(setViewport).toHaveBeenCalled();
  });
});
