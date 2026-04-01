import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CanvasTile } from '../types/canvas'

export interface SnapGuide {
  type: 'h' | 'v'
  position: number
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type UseCanvasTileInteractionsArgs = {
  tile: CanvasTile
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
  snapToGrid: boolean
  gridSize: number
  allTiles: CanvasTile[]
  viewportScale: number
}

type CanvasTileEnvironmentRefs = {
  snapToGridRef: React.MutableRefObject<boolean>
  gridSizeRef: React.MutableRefObject<number>
  allTilesRef: React.MutableRefObject<CanvasTile[]>
  viewportScaleRef: React.MutableRefObject<number>
}

const MIN_WIDTH = 200
const MIN_HEIGHT = 150
const SNAP_THRESHOLD = 8

function snapToGridValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

function computeAlignmentSnap(
  proposedX: number,
  proposedY: number,
  tileW: number,
  tileH: number,
  allTiles: CanvasTile[],
  selfId: string
): { x: number; y: number; guides: SnapGuide[] } {
  let snappedX = proposedX
  let snappedY = proposedY
  const guides: SnapGuide[] = []
  const left = proposedX
  const right = proposedX + tileW
  const top = proposedY
  const bottom = proposedY + tileH
  const centerX = proposedX + tileW / 2
  const centerY = proposedY + tileH / 2

  let bestXDelta = SNAP_THRESHOLD + 1
  let bestYDelta = SNAP_THRESHOLD + 1
  let bestXSnap = proposedX
  let bestYSnap = proposedY
  let bestXGuide: SnapGuide | null = null
  let bestYGuide: SnapGuide | null = null

  for (const other of allTiles) {
    if (other.id === selfId || other.minimized || other.maximized) continue

    const oLeft = other.x
    const oRight = other.x + other.width
    const oTop = other.y
    const oBottom = other.y + other.height
    const oCenterX = other.x + other.width / 2
    const oCenterY = other.y + other.height / 2
    const xCandidates: Array<{ delta: number; snap: number; guide: SnapGuide }> = [
      { delta: Math.abs(left - oLeft), snap: oLeft, guide: { type: 'v', position: oLeft } },
      { delta: Math.abs(left - oRight), snap: oRight, guide: { type: 'v', position: oRight } },
      { delta: Math.abs(right - oRight), snap: oRight - tileW, guide: { type: 'v', position: oRight } },
      { delta: Math.abs(right - oLeft), snap: oLeft - tileW, guide: { type: 'v', position: oLeft } },
      { delta: Math.abs(centerX - oCenterX), snap: oCenterX - tileW / 2, guide: { type: 'v', position: oCenterX } },
    ]
    const yCandidates: Array<{ delta: number; snap: number; guide: SnapGuide }> = [
      { delta: Math.abs(top - oTop), snap: oTop, guide: { type: 'h', position: oTop } },
      { delta: Math.abs(top - oBottom), snap: oBottom, guide: { type: 'h', position: oBottom } },
      { delta: Math.abs(bottom - oBottom), snap: oBottom - tileH, guide: { type: 'h', position: oBottom } },
      { delta: Math.abs(bottom - oTop), snap: oTop - tileH, guide: { type: 'h', position: oTop } },
      { delta: Math.abs(centerY - oCenterY), snap: oCenterY - tileH / 2, guide: { type: 'h', position: oCenterY } },
    ]

    for (const candidate of xCandidates) {
      if (candidate.delta < bestXDelta) {
        bestXDelta = candidate.delta
        bestXSnap = candidate.snap
        bestXGuide = candidate.guide
      }
    }
    for (const candidate of yCandidates) {
      if (candidate.delta < bestYDelta) {
        bestYDelta = candidate.delta
        bestYSnap = candidate.snap
        bestYGuide = candidate.guide
      }
    }
  }

  if (bestXDelta <= SNAP_THRESHOLD) {
    snappedX = bestXSnap
    if (bestXGuide) guides.push(bestXGuide)
  }
  if (bestYDelta <= SNAP_THRESHOLD) {
    snappedY = bestYSnap
    if (bestYGuide) guides.push(bestYGuide)
  }

  return { x: snappedX, y: snappedY, guides }
}

function useCanvasTileEnvironmentRefs({
  snapToGrid,
  gridSize,
  allTiles,
  viewportScale,
}: Pick<UseCanvasTileInteractionsArgs, 'snapToGrid' | 'gridSize' | 'allTiles' | 'viewportScale'>): CanvasTileEnvironmentRefs {
  const snapToGridRef = useRef(snapToGrid)
  const gridSizeRef = useRef(gridSize)
  const allTilesRef = useRef(allTiles)
  const viewportScaleRef = useRef(viewportScale)

  useEffect(() => void (snapToGridRef.current = snapToGrid), [snapToGrid])
  useEffect(() => void (gridSizeRef.current = gridSize), [gridSize])
  useEffect(() => void (allTilesRef.current = allTiles), [allTiles])
  useEffect(() => void (viewportScaleRef.current = viewportScale), [viewportScale])

  return { snapToGridRef, gridSizeRef, allTilesRef, viewportScaleRef }
}

function useCanvasTileDrag({
  tile,
  onUpdate,
  onBringToFront,
  snapToGrid,
  envRefs,
}: Pick<UseCanvasTileInteractionsArgs, 'tile' | 'onUpdate' | 'onBringToFront' | 'snapToGrid'> & {
  envRefs: CanvasTileEnvironmentRefs
}) {
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; tileX: number; tileY: number } | null>(
    null
  )
  const isDraggingRef = useRef(false)

  const handleTileMouseDown = useCallback(() => {
    onBringToFront(tile.id)
  }, [onBringToFront, tile.id])

  const handleHeaderMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement).closest('.canvas-tile-ctrl')) return
      if (tile.maximized || snapToGrid) return

      event.preventDefault()
      event.stopPropagation()
      onBringToFront(tile.id)
      dragStartRef.current = { mouseX: event.clientX, mouseY: event.clientY, tileX: tile.x, tileY: tile.y }
      isDraggingRef.current = true
    },
    [onBringToFront, snapToGrid, tile.id, tile.maximized, tile.x, tile.y]
  )

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!isDraggingRef.current || !dragStartRef.current) return
      const scale = envRefs.viewportScaleRef.current || 1
      const dx = (event.clientX - dragStartRef.current.mouseX) / scale
      const dy = (event.clientY - dragStartRef.current.mouseY) / scale
      let newX = dragStartRef.current.tileX + dx
      let newY = dragStartRef.current.tileY + dy

      if (envRefs.snapToGridRef.current) {
        const gs = envRefs.gridSizeRef.current
        newX = snapToGridValue(newX, gs)
        newY = snapToGridValue(newY, gs)
        const aligned = computeAlignmentSnap(newX, newY, tile.width, tile.height, envRefs.allTilesRef.current, tile.id)
        newX = aligned.x
        newY = aligned.y
        setSnapGuides(aligned.guides)
      } else {
        setSnapGuides([])
      }

      onUpdate(tile.id, { x: newX, y: newY })
    }

    function onMouseUp() {
      isDraggingRef.current = false
      dragStartRef.current = null
      setSnapGuides([])
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [envRefs, onUpdate, tile.height, tile.id, tile.width])

  return { snapGuides, handleTileMouseDown, handleHeaderMouseDown }
}

function useCanvasTileResize({
  tile,
  onUpdate,
  onBringToFront,
  snapToGrid,
  envRefs,
}: Pick<UseCanvasTileInteractionsArgs, 'tile' | 'onUpdate' | 'onBringToFront' | 'snapToGrid'> & {
  envRefs: CanvasTileEnvironmentRefs
}) {
  const resizeStartRef = useRef<{
    mouseX: number
    mouseY: number
    tileX: number
    tileY: number
    tileW: number
    tileH: number
    direction: ResizeDirection
  } | null>(null)
  const isResizingRef = useRef(false)

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent, direction: ResizeDirection) => {
      if (event.button !== 0) return
      if (tile.maximized || tile.minimized || snapToGrid) return

      event.preventDefault()
      event.stopPropagation()
      onBringToFront(tile.id)
      resizeStartRef.current = {
        mouseX: event.clientX,
        mouseY: event.clientY,
        tileX: tile.x,
        tileY: tile.y,
        tileW: tile.width,
        tileH: tile.height,
        direction,
      }
      isResizingRef.current = true
    },
    [onBringToFront, snapToGrid, tile.height, tile.id, tile.maximized, tile.minimized, tile.width, tile.x, tile.y]
  )

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!isResizingRef.current || !resizeStartRef.current) return
      const { mouseX, mouseY, tileX, tileY, tileW, tileH, direction } = resizeStartRef.current
      const scale = envRefs.viewportScaleRef.current || 1
      const dx = (event.clientX - mouseX) / scale
      const dy = (event.clientY - mouseY) / scale

      let newX = tileX
      let newY = tileY
      let newW = tileW
      let newH = tileH

      if (direction.includes('e')) newW = Math.max(MIN_WIDTH, tileW + dx)
      if (direction.includes('w')) {
        const proposedW = tileW - dx
        newW = proposedW >= MIN_WIDTH ? proposedW : MIN_WIDTH
        newX = proposedW >= MIN_WIDTH ? tileX + dx : tileX + tileW - MIN_WIDTH
      }
      if (direction.includes('s')) newH = Math.max(MIN_HEIGHT, tileH + dy)
      if (direction.includes('n')) {
        const proposedH = tileH - dy
        newH = proposedH >= MIN_HEIGHT ? proposedH : MIN_HEIGHT
        newY = proposedH >= MIN_HEIGHT ? tileY + dy : tileY + tileH - MIN_HEIGHT
      }

      if (envRefs.snapToGridRef.current) {
        const gs = envRefs.gridSizeRef.current
        newW = Math.max(MIN_WIDTH, snapToGridValue(newW, gs))
        newH = Math.max(MIN_HEIGHT, snapToGridValue(newH, gs))
        newX = snapToGridValue(newX, gs)
        newY = snapToGridValue(newY, gs)
      }

      onUpdate(tile.id, { x: newX, y: newY, width: newW, height: newH })
    }

    function onMouseUp() {
      isResizingRef.current = false
      resizeStartRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [envRefs, onUpdate, tile.id])

  return { handleResizeMouseDown }
}

export function useCanvasTileInteractions({
  tile,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  viewportScale,
}: UseCanvasTileInteractionsArgs) {
  const prevGeometryRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const envRefs = useCanvasTileEnvironmentRefs({ snapToGrid, gridSize, allTiles, viewportScale })
  const { snapGuides, handleTileMouseDown, handleHeaderMouseDown } = useCanvasTileDrag({
    tile,
    onUpdate,
    onBringToFront,
    snapToGrid,
    envRefs,
  })
  const { handleResizeMouseDown } = useCanvasTileResize({
    tile,
    onUpdate,
    onBringToFront,
    snapToGrid,
    envRefs,
  })

  const handleMinimize = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation()
      onUpdate(tile.id, { minimized: !tile.minimized, maximized: false })
    },
    [onUpdate, tile.id, tile.minimized]
  )

  const handleMaximize = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation()
      if (tile.maximized) {
        const prev = prevGeometryRef.current
        if (prev) {
          onUpdate(tile.id, { maximized: false, minimized: false, x: prev.x, y: prev.y, width: prev.width, height: prev.height })
          prevGeometryRef.current = null
        } else {
          onUpdate(tile.id, { maximized: false, minimized: false })
        }
        return
      }
      prevGeometryRef.current = { x: tile.x, y: tile.y, width: tile.width, height: tile.height }
      onUpdate(tile.id, { maximized: true, minimized: false })
    },
    [onUpdate, tile.height, tile.id, tile.maximized, tile.width, tile.x, tile.y]
  )

  const handleClose = useCallback(
    (event: ReactMouseEvent) => {
      event.stopPropagation()
      onRemove(tile.id)
    },
    [onRemove, tile.id]
  )

  return {
    snapGuides,
    handleTileMouseDown,
    handleHeaderMouseDown,
    handleResizeMouseDown,
    handleMinimize,
    handleMaximize,
    handleClose,
  }
}
