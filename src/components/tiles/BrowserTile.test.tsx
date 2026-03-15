import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserTile } from "./BrowserTile";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";

const DEFAULT_THEME: CanvasTheme = {
  preset: "midnight",
  background: "#0C0C0C",
  tileBorder: "#1F1F1F",
  accent: "#22C55E",
};

function makeTile(overrides: Partial<CanvasTile> = {}): CanvasTile {
  return {
    id: "browser-1",
    type: "browser",
    x: 40,
    y: 40,
    width: 548,
    height: 380,
    zIndex: 1,
    minimized: false,
    maximized: false,
    meta: { url: "https://example.com" },
    ...overrides,
  };
}

function renderBrowserTile(tileOverrides: Partial<CanvasTile> = {}, handlers: { onUpdate?: (id: string, patch: Partial<CanvasTile>) => void } = {}) {
  const onUpdate = handlers.onUpdate ?? (vi.fn() as unknown as (id: string, patch: Partial<CanvasTile>) => void);
  const onRemove = vi.fn() as unknown as (id: string) => void;
  const onBringToFront = vi.fn() as unknown as (id: string) => void;
  const tile = makeTile(tileOverrides);

  render(
    <BrowserTile
      tile={tile}
      canvasTheme={DEFAULT_THEME}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
    />,
  );

  return { onUpdate, onRemove, onBringToFront };
}

describe("BrowserTile", () => {
  it("renders URL bar with current URL", () => {
    renderBrowserTile();
    const urlInput = screen.getByRole("textbox", { name: "URL" });
    expect(urlInput).toHaveValue("https://example.com");
  });

  it("displays hostname in tile header metadata", () => {
    renderBrowserTile();
    expect(screen.getByText("example.com")).toBeInTheDocument();
  });

  it("changing URL input and pressing Enter updates tile meta", () => {
    const { onUpdate } = renderBrowserTile();
    const urlInput = screen.getByRole("textbox", { name: "URL" });

    fireEvent.change(urlInput, { target: { value: "https://google.com" } });
    fireEvent.keyDown(urlInput, { key: "Enter" });

    expect(onUpdate).toHaveBeenCalledWith(
      "browser-1",
      expect.objectContaining({
        meta: expect.objectContaining({ url: "https://google.com" }),
      }),
    );
  });

  it("renders about:blank when no URL in meta", () => {
    renderBrowserTile({ meta: {} });
    const urlInput = screen.getByRole("textbox", { name: "URL" });
    expect(urlInput).toHaveValue("about:blank");
  });

  it("renders back and forward navigation buttons", () => {
    renderBrowserTile();
    expect(screen.getByTitle("Back")).toBeInTheDocument();
    expect(screen.getByTitle("Forward")).toBeInTheDocument();
  });

  it("renders refresh button", () => {
    renderBrowserTile();
    expect(screen.getByTitle("Refresh")).toBeInTheDocument();
  });

  it("auto-prefixes bare hostnames with https://", () => {
    const { onUpdate } = renderBrowserTile();
    const urlInput = screen.getByRole("textbox", { name: "URL" });

    fireEvent.change(urlInput, { target: { value: "google.com" } });
    fireEvent.keyDown(urlInput, { key: "Enter" });

    expect(onUpdate).toHaveBeenCalledWith(
      "browser-1",
      expect.objectContaining({
        meta: expect.objectContaining({ url: "https://google.com" }),
      }),
    );
  });
});
