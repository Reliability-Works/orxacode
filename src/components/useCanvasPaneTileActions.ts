import { useCallback } from 'react'
import type { ReactElement, RefObject } from 'react'
import type { McpDevToolsServerState } from '@shared/ipc'
import type { CanvasTile } from '../types/canvas'
import { CANVAS_WORLD_ORIGIN, DEFAULT_CANVAS_ZOOM } from '../types/canvas'
import {
  arrangeCanvasTilesInGrid,
  sortCanvasTilesForLayout,
  type CanvasTileSortMode,
} from '../lib/canvas-layout'
import { renderCanvasPaneTile } from './canvas-pane-render-tile'
import type { CanvasPaneCanvasState } from './useCanvasPaneController'

const TILE_DIMENSIONS: Record<CanvasTile['type'], { width: number; height: number }> = {
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
}

const GRID_ARRANGE_PADDING = 48

type UseCanvasPaneTileActionsArgs = {
  canvasState: CanvasPaneCanvasState
  directory: string
  viewportRef: RefObject<HTMLDivElement | null>
  viewportZoom: number
  standardTiles: CanvasTile[]
  centerViewportOnRect: (
    rect: { x: number; y: number; width: number; height: number },
    zoom?: number
  ) => void
  computeVisibleSpawnPosition: (tileWidth: number, tileHeight: number) => { x: number; y: number }
  mcpDevToolsState?: McpDevToolsServerState
}

function useCanvasPaneTileMutationActions({
  canvasState,
  centerViewportOnRect,
  computeVisibleSpawnPosition,
  directory,
  viewportZoom,
}: Pick<
  UseCanvasPaneTileActionsArgs,
  'canvasState' | 'centerViewportOnRect' | 'computeVisibleSpawnPosition' | 'directory' | 'viewportZoom'
>) {
  const handleAddTile = useCallback(
    (type: CanvasTile['type']) => {
      const dims = TILE_DIMENSIONS[type]
      const { x, y } = computeVisibleSpawnPosition(dims.width, dims.height)
      const focusZoom =
        canvasState.tiles.length === 0 || viewportZoom < 0.2 ? DEFAULT_CANVAS_ZOOM : viewportZoom
      const createdAt = Date.now()

      const metaByType: Record<CanvasTile['type'], Record<string, unknown>> = {
        terminal: { directory, cwd: directory, createdAt },
        claude_code: {
          directory,
          cwd: directory,
          createdAt,
          startupCommand:
            'env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY claude\n',
          startupFilter: 'claude',
        },
        codex_cli: { directory, cwd: directory, createdAt, startupCommand: 'codex\n' },
        opencode_cli: { directory, cwd: directory, createdAt, startupCommand: 'opencode\n' },
        browser: { url: 'about:blank', createdAt },
        file_editor: { directory, filePath: '', createdAt },
        dev_server: { directory, port: 3000, status: 'stopped', createdAt },
        markdown_preview: { directory, filePath: '', content: '', createdAt },
        image_viewer: { filePath: '', createdAt },
        api_tester: { method: 'GET', url: '', createdAt },
      }

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
      })
      centerViewportOnRect({ x, y, width: dims.width, height: dims.height }, focusZoom)
    },
    [canvasState, centerViewportOnRect, computeVisibleSpawnPosition, directory, viewportZoom]
  )

  const handleTileUpdate = useCallback(
    (id: string, patch: Partial<CanvasTile>) => {
      canvasState.updateTile(id, patch)
    },
    [canvasState]
  )

  const handleTileRemove = useCallback(
    (id: string) => {
      canvasState.removeTile(id)
    },
    [canvasState]
  )

  const handleDuplicateTile = useCallback(
    (tile: CanvasTile) => {
      const offset = 40
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
      })
    },
    [canvasState]
  )

  const handleBringToFront = useCallback(
    (id: string) => {
      canvasState.bringToFront(id)
    },
    [canvasState]
  )

  return {
    handleAddTile,
    handleTileUpdate,
    handleTileRemove,
    handleDuplicateTile,
    handleBringToFront,
  }
}

function useCanvasPaneTileViewportActions({
  canvasState,
  centerViewportOnRect,
  standardTiles,
  viewportRef,
  viewportZoom,
}: Pick<
  UseCanvasPaneTileActionsArgs,
  'canvasState' | 'centerViewportOnRect' | 'standardTiles' | 'viewportRef' | 'viewportZoom'
>) {
  const handleJumpToTile = useCallback(
    (tile: CanvasTile) => {
      centerViewportOnRect({ x: tile.x, y: tile.y, width: tile.width, height: tile.height })
    },
    [centerViewportOnRect]
  )

  const handleSortTiles = useCallback(
    (mode: CanvasTileSortMode) => {
      const viewport = viewportRef.current
      const logicalLeft = viewport
        ? viewport.scrollLeft / viewportZoom - CANVAS_WORLD_ORIGIN + GRID_ARRANGE_PADDING
        : 40
      const logicalTop = viewport
        ? viewport.scrollTop / viewportZoom - CANVAS_WORLD_ORIGIN + GRID_ARRANGE_PADDING
        : 40
      const availableWidth = viewport
        ? viewport.clientWidth / viewportZoom - GRID_ARRANGE_PADDING * 2
        : 1280

      const sortedTiles = sortCanvasTilesForLayout(standardTiles, mode)
      const arrangedTiles = arrangeCanvasTilesInGrid(
        sortedTiles,
        logicalLeft,
        logicalTop,
        availableWidth
      )
      const arrangedById = new Map(arrangedTiles.map(tile => [tile.id, tile]))

      canvasState.setTiles(canvasState.tiles.map(tile => arrangedById.get(tile.id) ?? tile))
    },
    [canvasState, standardTiles, viewportRef, viewportZoom]
  )

  return {
    handleJumpToTile,
    handleSortTiles,
  }
}

function useCanvasPaneTileRenderer({
  canvasState,
  handleBringToFront,
  handleTileRemove,
  handleTileUpdate,
  mcpDevToolsState,
  viewportZoom,
}: Pick<
  UseCanvasPaneTileActionsArgs,
  'canvasState' | 'mcpDevToolsState' | 'viewportZoom'
> & {
  handleTileUpdate: (id: string, patch: Partial<CanvasTile>) => void
  handleTileRemove: (id: string) => void
  handleBringToFront: (id: string) => void
}) {
  return useCallback(
    (tile: CanvasTile, inViewportOverlay = false): ReactElement => {
      return renderCanvasPaneTile({
        tile,
        theme: canvasState.theme,
        onUpdate: handleTileUpdate,
        onRemove: handleTileRemove,
        onBringToFront: handleBringToFront,
        snapToGrid: canvasState.snapToGrid,
        gridSize: canvasState.gridSize,
        allTiles: canvasState.tiles,
        viewportZoom,
        accent: canvasState.theme.accent,
        mcpDevToolsState,
        inViewportOverlay,
      })
    },
    [
      canvasState.gridSize,
      canvasState.snapToGrid,
      canvasState.theme,
      canvasState.tiles,
      handleBringToFront,
      handleTileRemove,
      handleTileUpdate,
      mcpDevToolsState,
      viewportZoom,
    ]
  )
}

export function useCanvasPaneTileActions(args: UseCanvasPaneTileActionsArgs) {
  const {
    handleAddTile,
    handleTileUpdate,
    handleTileRemove,
    handleDuplicateTile,
    handleBringToFront,
  } = useCanvasPaneTileMutationActions(args)
  const { handleJumpToTile, handleSortTiles } = useCanvasPaneTileViewportActions(args)
  const renderTile = useCanvasPaneTileRenderer({
    canvasState: args.canvasState,
    handleBringToFront,
    handleTileRemove,
    handleTileUpdate,
    mcpDevToolsState: args.mcpDevToolsState,
    viewportZoom: args.viewportZoom,
  })

  return {
    handleAddTile,
    handleTileUpdate,
    handleTileRemove,
    handleDuplicateTile,
    handleBringToFront,
    handleJumpToTile,
    handleSortTiles,
    renderTile,
  }
}
