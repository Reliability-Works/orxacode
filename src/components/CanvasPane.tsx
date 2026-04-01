import { useCanvasPaneController, type CanvasPaneCanvasState } from './useCanvasPaneController'
import { CanvasToolbar } from './CanvasToolbar'

export type { CanvasPaneCanvasState } from './useCanvasPaneController'

type CanvasPaneProps = {
  canvasState: CanvasPaneCanvasState
  directory?: string
  onTheme?: () => void
  mcpDevToolsState?: import('@shared/ipc').McpDevToolsServerState
}

export function CanvasPane({
  canvasState,
  directory = '',
  onTheme,
  mcpDevToolsState,
}: CanvasPaneProps) {
  const {
    viewportRef,
    viewportZoom,
    scaledWorldSize,
    standardTiles,
    maximizedTiles,
    handleAddTile,
    handleTheme,
    handleReset,
    handleTileRemove,
    handleDuplicateTile,
    handleJumpToTile,
    handleSortTiles,
    handleViewportScroll,
    handleViewportMouseDown,
    handleZoomIn,
    handleZoomOut,
    renderTile,
  } = useCanvasPaneController({ canvasState, directory, onTheme, mcpDevToolsState })

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
          ...(canvasState.theme.backgroundImage
            ? {
                backgroundImage: `url(${canvasState.theme.backgroundImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
              }
            : {}),
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
              width: scaledWorldSize / viewportZoom,
              height: scaledWorldSize / viewportZoom,
              transform: `scale(${viewportZoom})`,
            }}
          >
            {standardTiles.map(tile => renderTile(tile))}
          </div>
        </div>
      </div>

      {maximizedTiles.length > 0 ? (
        <div className="canvas-overlay-layer">
          {maximizedTiles.map(tile => renderTile(tile, true))}
        </div>
      ) : null}
    </div>
  )
}
