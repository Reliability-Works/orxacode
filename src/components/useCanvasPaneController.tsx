import { useCallback } from 'react'
import type { McpDevToolsServerState } from '@shared/ipc'
import type { CanvasTile, CanvasSessionState } from '../types/canvas'
import type { CanvasTileSortMode } from '../lib/canvas-layout'
import { useCanvasPaneTileActions } from './useCanvasPaneTileActions'
import { useCanvasPaneViewport } from './useCanvasPaneViewport'

export type CanvasPaneCanvasState = CanvasSessionState & {
  addTile: (tile: Omit<CanvasTile, 'zIndex'>) => void
  removeTile: (tileId: string) => void
  updateTile: (tileId: string, updates: Partial<Omit<CanvasTile, 'id'>>) => void
  setTiles: (tiles: CanvasTile[]) => void
  bringToFront: (tileId: string) => void
  toggleSnap: () => void
  setTheme: (theme: Partial<CanvasSessionState['theme']>) => void
  setViewport: (viewport: Partial<CanvasSessionState['viewport']>) => void
  resetViewport: () => void
}

type CanvasPaneProps = {
  canvasState: CanvasPaneCanvasState
  directory?: string
  onTheme?: () => void
  mcpDevToolsState?: McpDevToolsServerState
}

export type CanvasPaneControllerResult = {
  viewportRef: React.RefObject<HTMLDivElement | null>
  viewportZoom: number
  scaledWorldSize: number
  standardTiles: CanvasTile[]
  maximizedTiles: CanvasTile[]
  handleAddTile: (type: CanvasTile['type']) => void
  handleTheme: () => void
  handleReset: () => void
  handleTileUpdate: (id: string, patch: Partial<CanvasTile>) => void
  handleTileRemove: (id: string) => void
  handleDuplicateTile: (tile: CanvasTile) => void
  handleBringToFront: (id: string) => void
  handleJumpToTile: (tile: CanvasTile) => void
  handleSortTiles: (mode: CanvasTileSortMode) => void
  handleViewportScroll: () => void
  handleViewportMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  handleZoomIn: () => void
  handleZoomOut: () => void
  renderTile: (tile: CanvasTile, inViewportOverlay?: boolean) => React.ReactElement
}

export function useCanvasPaneController({
  canvasState,
  directory = '',
  onTheme,
  mcpDevToolsState,
}: CanvasPaneProps): CanvasPaneControllerResult {
  const {
    viewportRef,
    viewportZoom,
    scaledWorldSize,
    standardTiles,
    maximizedTiles,
    centerViewportOnRect,
    computeVisibleSpawnPosition,
    handleViewportScroll,
    handleViewportMouseDown,
    handleZoomIn,
    handleZoomOut,
  } = useCanvasPaneViewport({
    tiles: canvasState.tiles,
    viewport: canvasState.viewport,
    setViewport: canvasState.setViewport,
  })

  const {
    handleAddTile,
    handleTileUpdate,
    handleTileRemove,
    handleDuplicateTile,
    handleBringToFront,
    handleJumpToTile,
    handleSortTiles,
    renderTile,
  } = useCanvasPaneTileActions({
    canvasState,
    directory,
    viewportRef,
    viewportZoom,
    standardTiles,
    centerViewportOnRect,
    computeVisibleSpawnPosition,
    mcpDevToolsState,
  })

  const handleTheme = useCallback(() => {
    onTheme?.()
  }, [onTheme])

  const handleReset = useCallback(() => {
    canvasState.resetViewport()
  }, [canvasState])

  return {
    viewportRef,
    viewportZoom,
    scaledWorldSize,
    standardTiles,
    maximizedTiles,
    handleAddTile,
    handleTheme,
    handleReset,
    handleTileUpdate,
    handleTileRemove,
    handleDuplicateTile,
    handleBringToFront,
    handleJumpToTile,
    handleSortTiles,
    handleViewportScroll,
    handleViewportMouseDown,
    handleZoomIn,
    handleZoomOut,
    renderTile,
  }
}
