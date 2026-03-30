import { useMemo } from 'react'
import type { CanvasTile, CanvasTheme } from '../types/canvas'
import { CanvasTileView } from './CanvasTileView'
import { useCanvasTileInteractions } from './useCanvasTileInteractions'

interface CanvasTileProps {
  tile: CanvasTile
  canvasTheme: CanvasTheme
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void
  onRemove: (id: string) => void
  onBringToFront: (id: string) => void
  children: React.ReactNode
  icon: React.ReactNode
  label: string
  iconColor: string
  metadata?: string
  snapToGrid?: boolean
  gridSize?: number
  allTiles?: CanvasTile[]
  canvasOffsetX?: number
  canvasOffsetY?: number
  viewportScale?: number
}

export function CanvasTileComponent({
  tile,
  onUpdate,
  onRemove,
  onBringToFront,
  children,
  icon,
  label,
  iconColor,
  metadata,
  snapToGrid = false,
  gridSize = 12,
  allTiles = [],
  canvasOffsetX = 0,
  canvasOffsetY = 0,
  viewportScale = 1,
}: CanvasTileProps) {
  const {
    snapGuides,
    handleTileMouseDown,
    handleHeaderMouseDown,
    handleResizeMouseDown,
    handleMinimize,
    handleMaximize,
    handleClose,
  } = useCanvasTileInteractions({
    tile,
    onUpdate,
    onRemove,
    onBringToFront,
    snapToGrid,
    gridSize,
    allTiles,
    viewportScale,
  })
  const tileStyle = useMemo<React.CSSProperties>(
    () =>
      tile.maximized
        ? { zIndex: tile.zIndex }
        : {
            left: tile.x + canvasOffsetX,
            top: tile.y + canvasOffsetY,
            width: tile.width,
            height: tile.minimized ? 32 : tile.height,
            zIndex: tile.zIndex,
          },
    [canvasOffsetX, canvasOffsetY, tile.height, tile.maximized, tile.minimized, tile.width, tile.x, tile.y, tile.zIndex]
  )
  const classes = useMemo(
    () => ['canvas-tile', tile.minimized ? 'minimized' : '', tile.maximized ? 'maximized' : ''].filter(Boolean).join(' '),
    [tile.maximized, tile.minimized]
  )

  return (
    <CanvasTileView
      tile={tile}
      classes={classes}
      tileStyle={tileStyle}
      children={children}
      icon={icon}
      label={label}
      iconColor={iconColor}
      metadata={metadata}
      snapToGrid={snapToGrid}
      snapGuides={snapGuides}
      onTileMouseDown={handleTileMouseDown}
      onHeaderMouseDown={handleHeaderMouseDown}
      onResizeMouseDown={handleResizeMouseDown}
      onMinimize={handleMinimize}
      onMaximize={handleMaximize}
      onClose={handleClose}
    />
  )
}

// Also export as default for convenience
export default CanvasTileComponent
