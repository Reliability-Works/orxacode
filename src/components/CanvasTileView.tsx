import { Minus, Maximize2, X } from 'lucide-react'
import type { CanvasTile } from '../types/canvas'
import type { ResizeDirection, SnapGuide } from './useCanvasTileInteractions'

type CanvasTileViewProps = {
  tile: CanvasTile
  classes: string
  tileStyle: React.CSSProperties
  children: React.ReactNode
  icon: React.ReactNode
  label: string
  iconColor: string
  metadata?: string
  snapToGrid: boolean
  snapGuides: SnapGuide[]
  onTileMouseDown: () => void
  onHeaderMouseDown: (event: React.MouseEvent) => void
  onResizeMouseDown: (event: React.MouseEvent, direction: ResizeDirection) => void
  onMinimize: (event: React.MouseEvent) => void
  onMaximize: (event: React.MouseEvent) => void
  onClose: (event: React.MouseEvent) => void
}

function CanvasTileResizeHandles({
  onResizeMouseDown,
}: {
  onResizeMouseDown: CanvasTileViewProps['onResizeMouseDown']
}) {
  const directions: ResizeDirection[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  return (
    <>
      {directions.map(direction => (
        <div
          key={direction}
          className={`canvas-tile-resize canvas-tile-resize-${direction}`}
          onMouseDown={event => onResizeMouseDown(event, direction)}
        />
      ))}
    </>
  )
}

function CanvasTileSnapGuides({
  snapGuides,
  tile,
}: {
  snapGuides: SnapGuide[]
  tile: CanvasTile
}) {
  return (
    <>
      {snapGuides.map((guide, index) =>
        guide.type === 'h' ? (
          <div
            key={index}
            className="canvas-snap-guide canvas-snap-guide-h"
            style={{ top: guide.position - tile.y }}
          />
        ) : (
          <div
            key={index}
            className="canvas-snap-guide canvas-snap-guide-v"
            style={{ left: guide.position - tile.x }}
          />
        )
      )}
    </>
  )
}

export function CanvasTileView({
  tile,
  classes,
  tileStyle,
  children,
  icon,
  label,
  iconColor,
  metadata,
  snapToGrid,
  snapGuides,
  onTileMouseDown,
  onHeaderMouseDown,
  onResizeMouseDown,
  onMinimize,
  onMaximize,
  onClose,
}: CanvasTileViewProps) {
  return (
    <div className={classes} style={tileStyle} onMouseDown={onTileMouseDown}>
      {!tile.maximized && !tile.minimized && !snapToGrid && (
        <CanvasTileResizeHandles onResizeMouseDown={onResizeMouseDown} />
      )}

      <div className={`canvas-tile-header${snapToGrid ? ' locked' : ''}`} onMouseDown={onHeaderMouseDown}>
        <span className="canvas-tile-icon" style={{ color: iconColor }}>
          {icon}
        </span>
        <span className="canvas-tile-label">{label}</span>
        {metadata ? <span className="canvas-tile-meta">{metadata}</span> : null}
        <span className="canvas-tile-header-spacer" />
        <button className="canvas-tile-ctrl" onClick={onMinimize} title={tile.minimized ? 'Restore' : 'Minimize'}>
          <Minus size={10} />
        </button>
        <button className="canvas-tile-ctrl" onClick={onMaximize} title={tile.maximized ? 'Restore' : 'Maximize'}>
          <Maximize2 size={10} />
        </button>
        <button className="canvas-tile-ctrl canvas-tile-ctrl-close" onClick={onClose} title="Close">
          <X size={10} />
        </button>
      </div>

      {!tile.minimized && <div className="canvas-tile-body">{children}</div>}
      <CanvasTileSnapGuides snapGuides={snapGuides} tile={tile} />
    </div>
  )
}
