import { useCallback } from "react";
import type { CanvasTile, CanvasSessionState } from "../types/canvas";
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
};

type CanvasPaneProps = {
  canvasState: CanvasPaneCanvasState;
  directory?: string;
  onTheme?: () => void;
};

export function CanvasPane({ canvasState, directory = "", onTheme }: CanvasPaneProps) {
  const handleAddTile = useCallback(
    (type: CanvasTile["type"]) => {
      const dims = TILE_DIMENSIONS[type];
      const { x, y } = computeNewTilePosition(canvasState.tiles);

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
    },
    [canvasState, directory],
  );

  const handleTheme = useCallback(() => {
    onTheme?.();
  }, [onTheme]);

  const handleReset = useCallback(() => {
    // Reset will be wired in the snap-to-grid / canvas-theme-system features
  }, []);

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

  return (
    <div className="canvas-pane">
      <CanvasToolbar
        tileCount={canvasState.tiles.length}
        snapToGrid={canvasState.snapToGrid}
        theme={canvasState.theme}
        onAddTile={handleAddTile}
        onTheme={handleTheme}
        onThemeChange={canvasState.setTheme}
        onToggleSnap={canvasState.toggleSnap}
        onReset={handleReset}
      />
      <div
        className="canvas-area"
        style={{ background: canvasState.theme.background }}
      >
        {canvasState.tiles.map((tile) => {
          if (tile.type === "terminal") {
            return (
              <TerminalTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "browser") {
            return (
              <BrowserTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "file_editor") {
            return (
              <FileEditorTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "dev_server") {
            return (
              <DevServerTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "markdown_preview") {
            return (
              <MarkdownTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "image_viewer") {
            return (
              <ImageTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          if (tile.type === "api_tester") {
            return (
              <ApiTesterTile
                key={tile.id}
                tile={tile}
                canvasTheme={canvasState.theme}
                onUpdate={handleTileUpdate}
                onRemove={handleTileRemove}
                onBringToFront={handleBringToFront}
                snapToGrid={canvasState.snapToGrid}
                gridSize={canvasState.gridSize}
                allTiles={canvasState.tiles}
              />
            );
          }

          return (
            <CanvasTileComponent
              key={tile.id}
              tile={tile}
              canvasTheme={canvasState.theme}
              onUpdate={handleTileUpdate}
              onRemove={handleTileRemove}
              onBringToFront={handleBringToFront}
              icon={null}
              label={tile.type}
              iconColor={canvasState.theme.accent}
              snapToGrid={canvasState.snapToGrid}
              gridSize={canvasState.gridSize}
              allTiles={canvasState.tiles}
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
        })}
      </div>
    </div>
  );
}
