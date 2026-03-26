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
import { arrangeCanvasTilesInGrid, sortCanvasTilesForLayout, type CanvasTileSortMode } from "../lib/canvas-layout";
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
  claude_code: { width: 560, height: 380 },
  codex_cli: { width: 560, height: 380 },
  opencode_cli: { width: 560, height: 380 },
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
const GRID_ARRANGE_PADDING = 48;

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
  setTiles: (tiles: CanvasTile[]) => void;
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
  const viewportStateRef = useRef({
    zoom: viewportZoom,
    scrollLeft: canvasState.viewport.scrollLeft,
    scrollTop: canvasState.viewport.scrollTop,
  });
  const standardTiles = useMemo(() => canvasState.tiles.filter((tile) => !tile.maximized), [canvasState.tiles]);
  const maximizedTiles = useMemo(() => canvasState.tiles.filter((tile) => tile.maximized), [canvasState.tiles]);

  useEffect(() => {
    viewportStateRef.current = {
      zoom: viewportZoom,
      scrollLeft: canvasState.viewport.scrollLeft,
      scrollTop: canvasState.viewport.scrollTop,
    };
  }, [canvasState.viewport.scrollLeft, canvasState.viewport.scrollTop, viewportZoom]);

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
      const createdAt = Date.now();

      const metaByType: Record<CanvasTile["type"], Record<string, unknown>> = {
        terminal: { directory, cwd: directory, createdAt },
        claude_code: {
          directory,
          cwd: directory,
          createdAt,
          startupCommand: "env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude\n",
          startupFilter: "claude",
        },
        codex_cli: { directory, cwd: directory, createdAt, startupCommand: "codex\n" },
        opencode_cli: { directory, cwd: directory, createdAt, startupCommand: "opencode\n" },
        browser: { url: "about:blank", createdAt },
        file_editor: { directory, filePath: "", createdAt },
        dev_server: { directory, port: 3000, status: "stopped", createdAt },
        markdown_preview: { directory, filePath: "", content: "", createdAt },
        image_viewer: { filePath: "", createdAt },
        api_tester: { method: "GET", url: "", createdAt },
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

  const handleDuplicateTile = useCallback(
    (tile: CanvasTile) => {
      const offset = 40;
      canvasState.addTile({
        id: crypto.randomUUID(),
        type: tile.type,
        x: tile.x + offset,
        y: tile.y + offset,
        width: tile.width,
        height: tile.height,
        minimized: false,
        maximized: false,
        meta: { ...tile.meta, createdAt: Date.now() },
      });
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
    viewportStateRef.current.scrollLeft = nextScrollLeft;
    viewportStateRef.current.scrollTop = nextScrollTop;
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

  const handleJumpToTile = useCallback((tile: CanvasTile) => {
    centerViewportOnRect({ x: tile.x, y: tile.y, width: tile.width, height: tile.height });
  }, [centerViewportOnRect]);

  const handleSortTiles = useCallback((mode: CanvasTileSortMode) => {
    const viewport = viewportRef.current;
    const logicalLeft = viewport
      ? viewportStateRef.current.scrollLeft / viewportStateRef.current.zoom - CANVAS_WORLD_ORIGIN + GRID_ARRANGE_PADDING
      : INITIAL_X;
    const logicalTop = viewport
      ? viewportStateRef.current.scrollTop / viewportStateRef.current.zoom - CANVAS_WORLD_ORIGIN + GRID_ARRANGE_PADDING
      : INITIAL_Y;
    const availableWidth = viewport
      ? viewport.clientWidth / viewportStateRef.current.zoom - GRID_ARRANGE_PADDING * 2
      : 1280;

    const sortedTiles = sortCanvasTilesForLayout(standardTiles, mode);
    const arrangedTiles = arrangeCanvasTilesInGrid(sortedTiles, logicalLeft, logicalTop, availableWidth);
    const arrangedById = new Map(arrangedTiles.map((tile) => [tile.id, tile]));

    canvasState.setTiles(
      canvasState.tiles.map((tile) => arrangedById.get(tile.id) ?? tile),
    );
  }, [canvasState, standardTiles]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const panState = panStateRef.current;
      const viewport = viewportRef.current;
      if (!panState || !viewport) {
        return;
      }

      viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.pointerX);
      viewport.scrollTop = panState.scrollTop - (event.clientY - panState.pointerY);
      viewportStateRef.current.scrollLeft = viewport.scrollLeft;
      viewportStateRef.current.scrollTop = viewport.scrollTop;
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

    viewportStateRef.current.scrollLeft = viewport.scrollLeft;
    viewportStateRef.current.scrollTop = viewport.scrollTop;
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
        viewportStateRef.current.zoom = clampedZoom;
        canvasState.setViewport({ zoom: clampedZoom });
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor ? anchor.clientX - rect.left : viewport.clientWidth / 2;
      const anchorY = anchor ? anchor.clientY - rect.top : viewport.clientHeight / 2;
      const currentZoom = viewportStateRef.current.zoom;
      const currentScrollLeft = viewportStateRef.current.scrollLeft;
      const currentScrollTop = viewportStateRef.current.scrollTop;
      const logicalX = (currentScrollLeft + anchorX) / currentZoom;
      const logicalY = (currentScrollTop + anchorY) / currentZoom;
      const maxScrollLeft = Math.max(0, baseWorldSize * clampedZoom - viewport.clientWidth);
      const maxScrollTop = Math.max(0, baseWorldSize * clampedZoom - viewport.clientHeight);
      const scrollLeft = Math.min(maxScrollLeft, Math.max(0, logicalX * clampedZoom - anchorX));
      const scrollTop = Math.min(maxScrollTop, Math.max(0, logicalY * clampedZoom - anchorY));

      viewportStateRef.current.zoom = clampedZoom;
      viewportStateRef.current.scrollLeft = scrollLeft;
      viewportStateRef.current.scrollTop = scrollTop;

      canvasState.setViewport({
        zoom: clampedZoom,
        scrollLeft,
        scrollTop,
      });
    },
    [baseWorldSize, canvasState],
  );

  const handleZoomIn = useCallback(() => {
    applyZoom(viewportStateRef.current.zoom * 1.12);
  }, [applyZoom]);

  const handleZoomOut = useCallback(() => {
    applyZoom(viewportStateRef.current.zoom / 1.12);
  }, [applyZoom]);

  // Attach wheel handler as non-passive native event so preventDefault() stops the scroll
  const applyZoomRef = useRef(applyZoom);
  useEffect(() => { applyZoomRef.current = applyZoom; }, [applyZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      applyZoomRef.current(viewportStateRef.current.zoom * multiplier, { clientX: event.clientX, clientY: event.clientY });
    }

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

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

    if (tile.type === "terminal" || tile.type === "claude_code" || tile.type === "codex_cli" || tile.type === "opencode_cli") {
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
        tiles={canvasState.tiles}
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
        onJumpToTile={handleJumpToTile}
        onSortTiles={handleSortTiles}
        onDuplicateTile={handleDuplicateTile}
        onRemoveTile={handleTileRemove}
      />
      <div
        ref={viewportRef}
        className="canvas-area-viewport"
        style={{
          background: canvasState.theme.background,
          ...(canvasState.theme.backgroundImage ? {
            backgroundImage: `url(${canvasState.theme.backgroundImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          } : {}),
        }}
        onScroll={handleViewportScroll}
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

      </div>

      {maximizedTiles.length > 0 ? (
        <div className="canvas-overlay-layer">
          {maximizedTiles.map((tile) => renderTile(tile, true))}
        </div>
      ) : null}
    </div>
  );
}
