import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LayoutGrid,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { CanvasTile, CanvasTheme } from '../types/canvas'
import type { CanvasTileSortMode } from '../lib/canvas-layout'
import {
  HubMenu,
  JumpToTileButton,
  ManageTilesButton,
} from './CanvasToolbarMenuUI'
import { useCloseAllMenus, useOutsideClickCloser } from './CanvasToolbarMenuHooks'

type CanvasToolbarProps = {
  tileCount: number
  tiles: CanvasTile[]
  zoom: number
  snapToGrid: boolean
  theme?: CanvasTheme
  onAddTile: (type: CanvasTile['type']) => void
  onTheme?: () => void
  onThemeChange?: (theme: Partial<CanvasTheme>) => void
  onZoomOut: () => void
  onZoomIn: () => void
  onToggleSnap: () => void
  onReset: () => void
  onJumpToTile?: (tile: CanvasTile) => void
  onSortTiles?: (mode: CanvasTileSortMode) => void
  onDuplicateTile?: (tile: CanvasTile) => void
  onRemoveTile?: (tileId: string) => void
}

const DRAG_THRESHOLD = 5


// Sub-component: Zoom controls
function ZoomControls({
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
}: {
  zoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
}) {
  const zoomPercentLabel = `${Math.round(zoom * 100)}%`

  return (
    <div className="canvas-toolbar-zoom-group" aria-label="Canvas zoom controls">
      <button
        type="button"
        className="canvas-toolbar-icon-btn"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <ZoomOut size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="canvas-toolbar-zoom-label"
        onClick={onReset}
        aria-label="Reset canvas view"
        title="Reset canvas view"
      >
        {zoomPercentLabel}
      </button>
      <button
        type="button"
        className="canvas-toolbar-icon-btn"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <ZoomIn size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

// Sub-component: Bottom-right controls
function BottomControls({
  tiles,
  zoom,
  onZoomOut,
  onZoomIn,
  onReset,
  onJumpToTile,
  onDuplicateTile,
  onRemoveTile,
}: {
  tiles: CanvasTile[]
  zoom: number
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
  onJumpToTile?: (tile: CanvasTile) => void
  onDuplicateTile?: (tile: CanvasTile) => void
  onRemoveTile?: (tileId: string) => void
}) {
  return (
    <div className="canvas-toolbar-bottom-row">
      <ManageTilesButton
        tiles={tiles}
        onDuplicateTile={onDuplicateTile}
        onRemoveTile={onRemoveTile}
      />
      <JumpToTileButton tiles={tiles} onJumpToTile={onJumpToTile} />
      <ZoomControls zoom={zoom} onZoomOut={onZoomOut} onZoomIn={onZoomIn} onReset={onReset} />
    </div>
  )
}

// Hook for drag handling
function useDragHandlers(
  dragPosition: { x: number; y: number },
  setDragPosition: (pos: { x: number; y: number }) => void,
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
) {
  const isDraggingRef = useRef(false)
  const dragStartMouseRef = useRef({ x: 0, y: 0 })
  const dragStartPosRef = useRef({ x: 0, y: 0 })
  const totalMovedRef = useRef(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      totalMovedRef.current = 0
      dragStartMouseRef.current = { x: e.clientX, y: e.clientY }
      dragStartPosRef.current = { x: dragPosition.x, y: dragPosition.y }
    },
    [dragPosition]
  )

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartMouseRef.current.x
      const dy = e.clientY - dragStartMouseRef.current.y
      totalMovedRef.current = Math.max(totalMovedRef.current, Math.abs(dx) + Math.abs(dy))
      setDragPosition({
        x: dragStartPosRef.current.x + dx,
        y: dragStartPosRef.current.y + dy,
      })
    }
    function onMouseUp() {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      if (totalMovedRef.current < DRAG_THRESHOLD) {
        setMenuOpen(v => !v)
      }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [setDragPosition, setMenuOpen])

  return { handleMouseDown }
}

export function CanvasToolbar({
  tiles,
  zoom,
  snapToGrid,
  theme,
  onAddTile,
  onTheme,
  onThemeChange,
  onZoomOut,
  onZoomIn,
  onToggleSnap,
  onReset,
  onJumpToTile,
  onSortTiles,
  onDuplicateTile,
  onRemoveTile,
}: CanvasToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  const [dragPosition, setDragPosition] = useState({ x: 16, y: -24 })

  const hubRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  const { handleMouseDown } = useDragHandlers(dragPosition, setDragPosition, setMenuOpen)

  const hubStyle: React.CSSProperties = {
    left: dragPosition.x,
    top: dragPosition.y === -24 ? 'calc(50% - 24px)' : dragPosition.y,
  }

  // Close menus on outside click
  useCloseAllMenus(
    menuOpen,
    setMenuOpen,
    setDropdownOpen,
    setThemePickerOpen,
    () => {},
    setSortMenuOpen,
    () => {},
    hubRef
  )
  useOutsideClickCloser(sortMenuOpen, setSortMenuOpen, sortMenuRef)

  return (
    <div className="canvas-toolbar">
      <div ref={hubRef} className="canvas-hub" style={hubStyle}>
        <button
          type="button"
          className={`canvas-hub-trigger${menuOpen ? ' is-open' : ''}`}
          onMouseDown={handleMouseDown}
          aria-label="Canvas controls"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <LayoutGrid size={18} aria-hidden="true" />
        </button>

        <HubMenu
          menuOpen={menuOpen}
          dropdownOpen={dropdownOpen}
          setDropdownOpen={setDropdownOpen}
          themePickerOpen={themePickerOpen}
          setThemePickerOpen={setThemePickerOpen}
          theme={theme}
          onTheme={onTheme}
          onThemeChange={onThemeChange}
          snapToGrid={snapToGrid}
          onToggleSnap={onToggleSnap}
          onReset={onReset}
          setMenuOpen={setMenuOpen}
          sortMenuOpen={sortMenuOpen}
          setSortMenuOpen={setSortMenuOpen}
          sortMenuRef={sortMenuRef}
          onSortTiles={onSortTiles}
          tiles={tiles}
          addButtonRef={addButtonRef}
          onAddTile={onAddTile}
        />
      </div>

      <BottomControls
        tiles={tiles}
        zoom={zoom}
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onReset={onReset}
        onJumpToTile={onJumpToTile}
        onDuplicateTile={onDuplicateTile}
        onRemoveTile={onRemoveTile}
      />
    </div>
  )
}
