import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { McpDevToolsServerState } from "@shared/ipc";
import type { CanvasTile, CanvasSessionState } from "../types/canvas";
import {
  CANVAS_WORLD_ORIGIN,
  CANVAS_WORLD_SIZE,
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from "../types/canvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasTileComponent } from "./CanvasTile";
import { TerminalTile } from "./tiles/TerminalTile";
import { BrowserTile } from "./tiles/BrowserTile";
import { FileEditorTile } from "./tiles/FileEditorTile";
import { DevServerTile } from "./tiles/DevServerTile";
import { MarkdownTile } from "./tiles/MarkdownTile";
import { ImageTile } from "./tiles/ImageTile";
import { ApiTesterTile } from "./tiles/ApiTesterTile";

const TILE_DIMENSIONS: Record<CanvasTile["type"], { width: number; height: number }> = {
  terminal: { width: 560, height: 380 },
  browser: { width: 548, height: 380 },
  file_editor: { width: 380, height: 380 },
  dev_server: { width: 728, height: 380 },
  markdown_preview: { width: 480, height: 360 },
  image_viewer: { width: 480, height: 360 },
  api_tester: { width: 480, height: 360 },
};

const CASCADE_OFFSET = 30;
const INITIAL_X = 40;
const INITIAL_Y = 40;

function computeNewTilePosition(tiles: CanvasTile[]): { x: number; y: number } {
  if (tiles.length === 0) {
    return { x: INITIAL_X, y: INITIAL_Y };
  }
  const last = [...tiles].sort((a, b) => b.zIndex - a.zIndex)[0];
  return { x: last.x + CASCADE_OFFSET, y: last.y + CASCADE_OFFSET };
}

export type CanvasPaneCanvasState = CanvasSessionState & {
  addTile: (tile: Omit<CanvasTile, "zIndex">) => void;
  removeTile: (tileId: string) => void;
  updateTile: (tileId: string, updates: Partial<Omit<CanvasTile, "id">>) => void;
  bringToFront: (tileId: string) => void;
  toggleSnap: () => void;
  setTheme: (theme: Partial<CanvasSessionState["theme"]>) => void;
  setViewport: (viewport: Partial<CanvasSessionState["viewport"]>) => void;
  resetViewport: () => void;
};

type CanvasPaneProps = {
  canvasState: CanvasPaneCanvasState;
  directory?: string;
  onTheme?: () => void;
  mcpDevToolsState?: McpDevToolsServerState;
};

export function CanvasPane({ canvasState, directory = "", onTheme, mcpDevToolsState }: CanvasPaneProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const panStateRef = useRef<{ pointerX: number; pointerY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const viewportZoom = useMemo(
    () => Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, canvasState.viewport.zoom || DEFAULT_CANVAS_ZOOM)),
    [canvasState.viewport.zoom],
  );
  const baseWorldSize = CANVAS_WORLD_SIZE;
  const scaledWorldSize = baseWorldSize * viewportZoom;
  const standardTiles = useMemo(() => canvasState.tiles.filter((tile) => !tile.maximized), [canvasState.tiles]);
  const maximizedTiles = useMemo(() => canvasState.tiles.filter((tile) => tile.maximized), [canvasState.tiles]);

  const centerViewportOnRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, zoom = viewportZoom) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const scaledCenterX = (CANVAS_WORLD_ORIGIN + rect.x + rect.width / 2) * zoom;
      const scaledCenterY = (CANVAS_WORLD_ORIGIN + rect.y + rect.height / 2) * zoom;
      const maxScrollLeft = Math.max(0, baseWorldSize * zoom - viewport.clientWidth);
      const maxScrollTop = Math.max(0, baseWorldSize * zoom - viewport.clientHeight);

      canvasState.setViewport({
        zoom,
        scrollLeft: Math.min(maxScrollLeft, Math.max(0, scaledCenterX - viewport.clientWidth / 2)),
        scrollTop: Math.min(maxScrollTop, Math.max(0, scaledCenterY - viewport.clientHeight / 2)),
      });
    },
    [baseWorldSize, canvasState, viewportZoom],
  );

  const computeVisibleSpawnPosition = useCallback(
    (tileWidth: number, tileHeight: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return computeNewTilePosition(canvasState.tiles);
      }

      const logicalLeft = viewport.scrollLeft / viewportZoom - CANVAS_WORLD_ORIGIN;
      const logicalTop = viewport.scrollTop / viewportZoom - CANVAS_WORLD_ORIGIN;
      const insetX = Math.max(32, Math.min(96, (viewport.clientWidth / viewportZoom - tileWidth) / 2));
      const insetY = Math.max(32, Math.min(96, (viewport.clientHeight / viewportZoom - tileHeight) / 2));
      const cascadeCount = canvasState.tiles.length % 6;

      return {
        x: logicalLeft + insetX + cascadeCount * CASCADE_OFFSET,
        y: logicalTop + insetY + cascadeCount * CASCADE_OFFSET,
      };
    },
    [canvasState.tiles, viewportZoom],
  );

  const handleAddTile = useCallback(
    (type: CanvasTile["type"]) => {
      const dims = TILE_DIMENSIONS[type];
      const { x, y } = computeVisibleSpawnPosition(dims.width, dims.height);
      const focusZoom = canvasState.tiles.length === 0 || viewportZoom < 0.2
        ? DEFAULT_CANVAS_ZOOM
        : viewportZoom;

      const metaByType: Record<CanvasTile["type"], Record<string, unknown>> = {
        terminal: { directory, cwd: directory },
        browser: { url: "about:blank" },
        file_editor: { directory, filePath: "" },
        dev_server: { directory, port: 3000, status: "stopped" },
        markdown_preview: { directory, filePath: "", content: "" },
        image_viewer: { filePath: "" },
        api_tester: { method: "GET", url: "" },
      };

      canvasState.addTile({
        id: crypto.randomUUID(),
        type,
        x,
        y,
        width: dims.width,
        height: dims.height,
        minimized: false,
        maximized: false,
        meta: metaByType[type],
      });
      centerViewportOnRect({ x, y, width: dims.width, height: dims.height }, focusZoom);
    },
    [canvasState, centerViewportOnRect, computeVisibleSpawnPosition, directory, viewportZoom],
  );

  const handleTheme = useCallback(() => {
    onTheme?.();
  }, [onTheme]);

  const handleReset = useCallback(() => {
    canvasState.resetViewport();
  }, [canvasState]);

  const handleTileUpdate = useCallback(
    (id: string, patch: Partial<CanvasTile>) => {
      canvasState.updateTile(id, patch);
    },
    [canvasState],
  );

  const handleTileRemove = useCallback(
    (id: string) => {
      canvasState.removeTile(id);
    },
    [canvasState],
  );

  const handleBringToFront = useCallback(
    (id: string) => {
      canvasState.bringToFront(id);
    },
    [canvasState],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const nextScrollLeft = Math.max(0, canvasState.viewport.scrollLeft);
    const nextScrollTop = Math.max(0, canvasState.viewport.scrollTop);
    if (
      Math.abs(viewport.scrollLeft - nextScrollLeft) < 1
      && Math.abs(viewport.scrollTop - nextScrollTop) < 1
    ) {
      return;
    }

    syncingScrollRef.current = true;
    viewport.scrollLeft = nextScrollLeft;
    viewport.scrollTop = nextScrollTop;
    const rafId = window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [canvasState.viewport.scrollLeft, canvasState.viewport.scrollTop]);

  useEffect(() => {
    if (standardTiles.length === 0) {
      return;
    }
    const viewportLooksBroken =
      canvasState.viewport.scrollLeft === 0
      && canvasState.viewport.scrollTop === 0;
    const zoomLooksBroken = viewportZoom < 0.05;

    if (!viewportLooksBroken && !zoomLooksBroken) {
      return;
    }

    const minX = Math.min(...standardTiles.map((tile) => tile.x));
    const minY = Math.min(...standardTiles.map((tile) => tile.y));
    const maxX = Math.max(...standardTiles.map((tile) => tile.x + tile.width));
    const maxY = Math.max(...standardTiles.map((tile) => tile.y + tile.height));
    centerViewportOnRect({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }, DEFAULT_CANVAS_ZOOM);
  }, [canvasState.viewport.scrollLeft, canvasState.viewport.scrollTop, centerViewportOnRect, standardTiles, viewportZoom]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const panState = panStateRef.current;
      const viewport = viewportRef.current;
      if (!panState || !viewport) {
        return;
      }

      viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.pointerX);
      viewport.scrollTop = panState.scrollTop - (event.clientY - panState.pointerY);
    }

    function handleMouseUp() {
      panStateRef.current = null;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleViewportScroll = useCallback(() => {
    if (syncingScrollRef.current) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    canvasState.setViewport({
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
  }, [canvasState]);

  const applyZoom = useCallback(
    (nextZoom: number, anchor?: { clientX: number; clientY: number }) => {
      const clampedZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, nextZoom));
      const viewport = viewportRef.current;
      if (!viewport) {
        canvasState.setViewport({ zoom: clampedZoom });
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor ? anchor.clientX - rect.left : viewport.clientWidth / 2;
      const anchorY = anchor ? anchor.clientY - rect.top : viewport.clientHeight / 2;
      const logicalX = (viewport.scrollLeft + anchorX) / viewportZoom;
      const logicalY = (viewport.scrollTop + anchorY) / viewportZoom;
      const maxScrollLeft = Math.max(0, baseWorldSize * clampedZoom - viewport.clientWidth);
      const maxScrollTop = Math.max(0, baseWorldSize * clampedZoom - viewport.clientHeight);

      canvasState.setViewport({
        zoom: clampedZoom,
        scrollLeft: Math.min(maxScrollLeft, Math.max(0, logicalX * clampedZoom - anchorX)),
        scrollTop: Math.min(maxScrollTop, Math.max(0, logicalY * clampedZoom - anchorY)),
      });
    },
    [baseWorldSize, canvasState, viewportZoom],
  );

  const handleZoomIn = useCallback(() => {
    applyZoom(viewportZoom * 1.12);
  }, [applyZoom, viewportZoom]);

  const handleZoomOut = useCallback(() => {
    applyZoom(viewportZoom / 1.12);
  }, [applyZoom, viewportZoom]);

  const handleViewportWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    event.preventDefault();
    const multiplier = Math.exp(-event.deltaY * 0.0015);
    applyZoom(viewportZoom * multiplier, { clientX: event.clientX, clientY: event.clientY });
  }, [applyZoom, viewportZoom]);

  const handleViewportMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    if ((event.target as HTMLElement).closest(".canvas-tile")) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    event.preventDefault();
    panStateRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  }, []);

  const renderTile = useCallback((tile: CanvasTile, inViewportOverlay = false) => {
    const commonProps = {
      tile,
      canvasTheme: canvasState.theme,
      onUpdate: handleTileUpdate,
      onRemove: handleTileRemove,
      onBringToFront: handleBringToFront,
      snapToGrid: canvasState.snapToGrid,
      gridSize: canvasState.gridSize,
      allTiles: canvasState.tiles,
      canvasOffsetX: inViewportOverlay ? 0 : CANVAS_WORLD_ORIGIN,
      canvasOffsetY: inViewportOverlay ? 0 : CANVAS_WORLD_ORIGIN,
      viewportScale: inViewportOverlay ? 1 : viewportZoom,
    };

    if (tile.type === "terminal") {
      return <TerminalTile key={tile.id} {...commonProps} />;
    }

    if (tile.type === "browser") {
      return <BrowserTile key={tile.id} {...commonProps} mcpDevToolsState={mcpDevToolsState} />;
    }

    if (tile.type === "file_editor") {
      return <FileEditorTile key={tile.id} {...commonProps} />;
    }

    if (tile.type === "dev_server") {
      return <DevServerTile key={tile.id} {...commonProps} />;
    }

    if (tile.type === "markdown_preview") {
      return <MarkdownTile key={tile.id} {...commonProps} />;
    }

    if (tile.type === "image_viewer") {
      return <ImageTile key={tile.id} {...commonProps} />;
    }

    if (tile.type === "api_tester") {
      return <ApiTesterTile key={tile.id} {...commonProps} />;
    }

    return (
      <CanvasTileComponent
        key={tile.id}
        {...commonProps}
        icon={null}
        label={tile.type}
        iconColor={canvasState.theme.accent}
      >
        <div
          style={{
            padding: 12,
            color: "var(--text-muted)",
            fontSize: 12,
          }}
        >
          Tile content ({tile.type})
        </div>
      </CanvasTileComponent>
    );
  }, [
    canvasState.gridSize,
    canvasState.snapToGrid,
    canvasState.theme,
    canvasState.tiles,
    handleBringToFront,
    handleTileRemove,
    handleTileUpdate,
    mcpDevToolsState,
    viewportZoom,
  ]);

  return (
    <div className="canvas-pane">
      <CanvasToolbar
        tileCount={canvasState.tiles.length}
        zoom={viewportZoom}
        snapToGrid={canvasState.snapToGrid}
        theme={canvasState.theme}
        onAddTile={handleAddTile}
        onTheme={handleTheme}
        onThemeChange={canvasState.setTheme}
        onZoomOut={handleZoomOut}
        onZoomIn={handleZoomIn}
        onToggleSnap={canvasState.toggleSnap}
        onReset={handleReset}
      />
      <div
        ref={viewportRef}
        className="canvas-area-viewport"
        style={{ background: canvasState.theme.background }}
        onScroll={handleViewportScroll}
        onWheel={handleViewportWheel}
        onMouseDown={handleViewportMouseDown}
        tabIndex={0}
      >
        <div
          className="canvas-area-world"
          style={{
            width: scaledWorldSize,
            height: scaledWorldSize,
          }}
        >
          <div
            className="canvas-area-surface"
            style={{
              width: baseWorldSize,
              height: baseWorldSize,
              transform: `scale(${viewportZoom})`,
            }}
          >
            {standardTiles.map((tile) => renderTile(tile))}
          </div>
        </div>

        {maximizedTiles.length > 0 ? (
          <div className="canvas-overlay-layer">
            {maximizedTiles.map((tile) => renderTile(tile, true))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
