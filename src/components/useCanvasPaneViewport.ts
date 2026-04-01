import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CanvasTile } from '../types/canvas'
import {
  CANVAS_WORLD_ORIGIN,
  CANVAS_WORLD_SIZE,
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '../types/canvas'
import { useCanvasPaneViewportInteractions } from './useCanvasPaneViewportInteractions'

export type TileRect = { x: number; y: number; width: number; height: number }
export type ViewportPoint = { clientX: number; clientY: number }

export type CanvasViewportState = {
  zoom: number
  scrollLeft: number
  scrollTop: number
}

type CanvasViewportArgs = {
  tiles: CanvasTile[]
  viewport: CanvasViewportState
  setViewport: (viewport: Partial<CanvasViewportState>) => void
}

const CASCADE_OFFSET = 30
const INITIAL_X = 40
const INITIAL_Y = 40

function computeNewTilePosition(tiles: CanvasTile[]): { x: number; y: number } {
  if (tiles.length === 0) {
    return { x: INITIAL_X, y: INITIAL_Y }
  }
  const last = [...tiles].sort((a, b) => b.zIndex - a.zIndex)[0]
  return { x: last.x + CASCADE_OFFSET, y: last.y + CASCADE_OFFSET }
}

export function useCanvasPaneViewport({ tiles, viewport, setViewport }: CanvasViewportArgs) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const syncingScrollRef = useRef(false)
  const panStateRef = useRef<{ pointerX: number; pointerY: number; scrollLeft: number; scrollTop: number } | null>(null)
  const viewportZoom = useMemo(
    () => Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, viewport.zoom || DEFAULT_CANVAS_ZOOM)),
    [viewport.zoom]
  )
  const scaledWorldSize = CANVAS_WORLD_SIZE * viewportZoom
  const viewportStateRef = useRef({ zoom: viewportZoom, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop })

  useEffect(() => {
    viewportStateRef.current = { zoom: viewportZoom, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop }
  }, [viewport.scrollLeft, viewport.scrollTop, viewportZoom])

  const centerViewportOnRect = useCallback(
    (rect: TileRect, zoom = viewportZoom) => {
      const view = viewportRef.current
      if (!view) return
      const scaledCenterX = (CANVAS_WORLD_ORIGIN + rect.x + rect.width / 2) * zoom
      const scaledCenterY = (CANVAS_WORLD_ORIGIN + rect.y + rect.height / 2) * zoom
      const maxScrollLeft = Math.max(0, CANVAS_WORLD_SIZE * zoom - view.clientWidth)
      const maxScrollTop = Math.max(0, CANVAS_WORLD_SIZE * zoom - view.clientHeight)
      setViewport({
        zoom,
        scrollLeft: Math.min(maxScrollLeft, Math.max(0, scaledCenterX - view.clientWidth / 2)),
        scrollTop: Math.min(maxScrollTop, Math.max(0, scaledCenterY - view.clientHeight / 2)),
      })
    },
    [setViewport, viewportZoom]
  )

  const computeVisibleSpawnPosition = useCallback(
    (tileWidth: number, tileHeight: number) => {
      const view = viewportRef.current
      if (!view) return computeNewTilePosition(tiles)
      const logicalLeft = view.scrollLeft / viewportZoom - CANVAS_WORLD_ORIGIN
      const logicalTop = view.scrollTop / viewportZoom - CANVAS_WORLD_ORIGIN
      const insetX = Math.max(32, Math.min(96, (view.clientWidth / viewportZoom - tileWidth) / 2))
      const insetY = Math.max(32, Math.min(96, (view.clientHeight / viewportZoom - tileHeight) / 2))
      const cascadeCount = tiles.length % 6
      return { x: logicalLeft + insetX + cascadeCount * CASCADE_OFFSET, y: logicalTop + insetY + cascadeCount * CASCADE_OFFSET }
    },
    [tiles, viewportZoom]
  )

  const standardTiles = useMemo(() => tiles.filter(tile => !tile.maximized), [tiles])
  const maximizedTiles = useMemo(() => tiles.filter(tile => tile.maximized), [tiles])

  const {
    handleViewportScroll,
    handleViewportMouseDown,
    handleZoomIn,
    handleZoomOut,
  } = useCanvasPaneViewportInteractions({
    viewportRef,
    syncingScrollRef,
    panStateRef,
    viewportStateRef,
    viewport,
    setViewport,
    viewportZoom,
    standardTiles,
    centerViewportOnRect,
  })

  return {
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
  }
}
