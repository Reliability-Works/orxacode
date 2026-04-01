import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import type { CanvasTile } from '../types/canvas'
import {
  CANVAS_WORLD_SIZE,
  DEFAULT_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
} from '../types/canvas'
import type { CanvasViewportState, TileRect, ViewportPoint } from './useCanvasPaneViewport'

type PanState = {
  pointerX: number
  pointerY: number
  scrollLeft: number
  scrollTop: number
}

type UseCanvasPaneViewportInteractionsArgs = {
  viewportRef: RefObject<HTMLDivElement | null>
  syncingScrollRef: MutableRefObject<boolean>
  panStateRef: MutableRefObject<PanState | null>
  viewportStateRef: MutableRefObject<CanvasViewportState>
  viewport: CanvasViewportState
  setViewport: (viewport: Partial<CanvasViewportState>) => void
  viewportZoom: number
  standardTiles: CanvasTile[]
  centerViewportOnRect: (rect: TileRect, zoom?: number) => void
}

function useViewportScrollSync({
  viewportRef,
  syncingScrollRef,
  viewportStateRef,
  viewport,
}: Pick<
  UseCanvasPaneViewportInteractionsArgs,
  'viewportRef' | 'syncingScrollRef' | 'viewportStateRef' | 'viewport'
>) {
  useLayoutEffect(() => {
    const view = viewportRef.current
    if (!view) return
    const nextScrollLeft = Math.max(0, viewport.scrollLeft)
    const nextScrollTop = Math.max(0, viewport.scrollTop)
    if (Math.abs(view.scrollLeft - nextScrollLeft) < 1 && Math.abs(view.scrollTop - nextScrollTop) < 1) {
      return
    }
    syncingScrollRef.current = true
    view.scrollLeft = nextScrollLeft
    view.scrollTop = nextScrollTop
    viewportStateRef.current.scrollLeft = nextScrollLeft
    viewportStateRef.current.scrollTop = nextScrollTop
    const rafId = window.requestAnimationFrame(() => {
      syncingScrollRef.current = false
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [syncingScrollRef, viewport.scrollLeft, viewport.scrollTop, viewportRef, viewportStateRef])
}

function useViewportAutoFit({
  centerViewportOnRect,
  standardTiles,
  viewport,
  viewportZoom,
}: Pick<
  UseCanvasPaneViewportInteractionsArgs,
  'centerViewportOnRect' | 'standardTiles' | 'viewport' | 'viewportZoom'
>) {
  useEffect(() => {
    if (standardTiles.length === 0) return
    const viewportLooksBroken = viewport.scrollLeft === 0 && viewport.scrollTop === 0
    const zoomLooksBroken = viewportZoom < 0.05
    if (!viewportLooksBroken && !zoomLooksBroken) return
    const minX = Math.min(...standardTiles.map(tile => tile.x))
    const minY = Math.min(...standardTiles.map(tile => tile.y))
    const maxX = Math.max(...standardTiles.map(tile => tile.x + tile.width))
    const maxY = Math.max(...standardTiles.map(tile => tile.y + tile.height))
    centerViewportOnRect(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      DEFAULT_CANVAS_ZOOM
    )
  }, [centerViewportOnRect, standardTiles, viewport.scrollLeft, viewport.scrollTop, viewportZoom])
}

function useViewportPanTracking({
  panStateRef,
  viewportRef,
  viewportStateRef,
}: Pick<UseCanvasPaneViewportInteractionsArgs, 'panStateRef' | 'viewportRef' | 'viewportStateRef'>) {
  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const panState = panStateRef.current
      const view = viewportRef.current
      if (!panState || !view) return
      view.scrollLeft = panState.scrollLeft - (event.clientX - panState.pointerX)
      view.scrollTop = panState.scrollTop - (event.clientY - panState.pointerY)
      viewportStateRef.current.scrollLeft = view.scrollLeft
      viewportStateRef.current.scrollTop = view.scrollTop
    }

    function handleMouseUp() {
      panStateRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [panStateRef, viewportRef, viewportStateRef])
}

function useViewportWheelZoom(
  viewportRef: RefObject<HTMLDivElement | null>,
  viewportStateRef: MutableRefObject<CanvasViewportState>,
  applyZoom: (nextZoom: number, anchor?: ViewportPoint) => void
) {
  const applyZoomRef = useRef(applyZoom)

  useEffect(() => {
    applyZoomRef.current = applyZoom
  }, [applyZoom])

  useEffect(() => {
    const view = viewportRef.current
    if (!view) return

    function handleWheel(event: WheelEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      const multiplier = Math.exp(-event.deltaY * 0.0015)
      applyZoomRef.current(viewportStateRef.current.zoom * multiplier, {
        clientX: event.clientX,
        clientY: event.clientY,
      })
    }

    view.addEventListener('wheel', handleWheel, { passive: false })
    return () => view.removeEventListener('wheel', handleWheel)
  }, [viewportRef, viewportStateRef])
}

export function useCanvasPaneViewportInteractions({
  viewportRef,
  syncingScrollRef,
  panStateRef,
  viewportStateRef,
  viewport,
  setViewport,
  viewportZoom,
  standardTiles,
  centerViewportOnRect,
}: UseCanvasPaneViewportInteractionsArgs) {
  useViewportScrollSync({ viewportRef, syncingScrollRef, viewportStateRef, viewport })
  useViewportAutoFit({ centerViewportOnRect, standardTiles, viewport, viewportZoom })
  useViewportPanTracking({ panStateRef, viewportRef, viewportStateRef })

  const applyZoom = useCallback(
    (nextZoom: number, anchor?: ViewportPoint) => {
      const clampedZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, nextZoom))
      const view = viewportRef.current
      if (!view) {
        viewportStateRef.current.zoom = clampedZoom
        setViewport({ zoom: clampedZoom })
        return
      }

      const rect = view.getBoundingClientRect()
      const anchorX = anchor ? anchor.clientX - rect.left : view.clientWidth / 2
      const anchorY = anchor ? anchor.clientY - rect.top : view.clientHeight / 2
      const currentZoom = viewportStateRef.current.zoom
      const currentScrollLeft = viewportStateRef.current.scrollLeft
      const currentScrollTop = viewportStateRef.current.scrollTop
      const logicalX = (currentScrollLeft + anchorX) / currentZoom
      const logicalY = (currentScrollTop + anchorY) / currentZoom
      const maxScrollLeft = Math.max(0, CANVAS_WORLD_SIZE * clampedZoom - view.clientWidth)
      const maxScrollTop = Math.max(0, CANVAS_WORLD_SIZE * clampedZoom - view.clientHeight)
      const scrollLeft = Math.min(maxScrollLeft, Math.max(0, logicalX * clampedZoom - anchorX))
      const scrollTop = Math.min(maxScrollTop, Math.max(0, logicalY * clampedZoom - anchorY))

      viewportStateRef.current = { zoom: clampedZoom, scrollLeft, scrollTop }
      setViewport({ zoom: clampedZoom, scrollLeft, scrollTop })
    },
    [setViewport, viewportRef, viewportStateRef]
  )

  useViewportWheelZoom(viewportRef, viewportStateRef, applyZoom)

  const handleViewportScroll = useCallback(() => {
    if (syncingScrollRef.current) return
    const view = viewportRef.current
    if (!view) return
    viewportStateRef.current.scrollLeft = view.scrollLeft
    viewportStateRef.current.scrollTop = view.scrollTop
    setViewport({ scrollLeft: view.scrollLeft, scrollTop: view.scrollTop })
  }, [setViewport, syncingScrollRef, viewportRef, viewportStateRef])

  const handleViewportMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return
      if ((event.target as HTMLElement).closest('.canvas-tile')) return
      const view = viewportRef.current
      if (!view) return
      event.preventDefault()
      panStateRef.current = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        scrollLeft: view.scrollLeft,
        scrollTop: view.scrollTop,
      }
    },
    [panStateRef, viewportRef]
  )

  const handleZoomIn = useCallback(() => {
    applyZoom(viewportStateRef.current.zoom * 1.12)
  }, [applyZoom, viewportStateRef])

  const handleZoomOut = useCallback(() => {
    applyZoom(viewportStateRef.current.zoom / 1.12)
  }, [applyZoom, viewportStateRef])

  return {
    handleViewportScroll,
    handleViewportMouseDown,
    handleZoomIn,
    handleZoomOut,
  }
}
