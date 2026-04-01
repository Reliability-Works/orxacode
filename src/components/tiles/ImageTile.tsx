import { useCallback, useRef, useState } from 'react'
import { FolderOpen, Image as ImageIcon, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { CanvasTileComponent } from '../CanvasTile'
import { tilePathBasename, type CanvasTileComponentProps } from './tile-shared'

type ImageTileProps = CanvasTileComponentProps

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const ZOOM_STEP = 0.25

// Sub-component: Image display
function ImageDisplay({
  src,
  fileName,
  scale,
  onError,
  onLoad,
}: {
  src: string
  fileName: string | undefined
  scale: number
  onError: () => void
  onLoad: () => void
}) {
  return (
    <img
      className="image-tile-img"
      src={src}
      alt={fileName ?? 'image'}
      style={{ transform: `scale(${scale})` }}
      onError={onError}
      onLoad={onLoad}
      draggable={false}
    />
  )
}

// Sub-component: Image placeholder when no file loaded
function EmptyPlaceholder({ onPick }: { onPick: () => void }) {
  return (
    <div className="image-tile-placeholder">
      <ImageIcon size={32} />
      <span>no image loaded</span>
      <button className="image-tile-open-btn" onClick={() => void onPick()} title="Open image file">
        <FolderOpen size={13} />
        <span>open image</span>
      </button>
    </div>
  )
}

// Sub-component: Error placeholder
function ErrorPlaceholder({ filePath, onPick }: { filePath: string; onPick: () => void }) {
  return (
    <div className="image-tile-placeholder image-tile-error">
      <ImageIcon size={32} />
      <span>failed to load image</span>
      <span className="image-tile-error-path">{filePath}</span>
      <button
        className="image-tile-open-btn"
        onClick={() => void onPick()}
        title="Open different image"
      >
        <FolderOpen size={13} />
        <span>open another</span>
      </button>
    </div>
  )
}

// Sub-component: Image viewport content
function ImageViewport({
  filePath,
  src,
  fileName,
  scale,
  imgError,
  containerRef,
  onWheel,
  onImgError,
  onImgLoad,
  onPickImage,
}: {
  filePath: string
  src: string
  fileName: string | undefined
  scale: number
  imgError: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  onWheel: (e: React.WheelEvent) => void
  onImgError: () => void
  onImgLoad: () => void
  onPickImage: () => void
}) {
  return (
    <div className="image-tile-viewport" ref={containerRef} onWheel={onWheel}>
      {!filePath ? (
        <EmptyPlaceholder onPick={onPickImage} />
      ) : imgError ? (
        <ErrorPlaceholder filePath={filePath} onPick={onPickImage} />
      ) : (
        <ImageDisplay src={src} fileName={fileName} scale={scale} onError={onImgError} onLoad={onImgLoad} />
      )}
    </div>
  )
}

// Sub-component: Zoom controls
function ImageControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
  onPickImage,
}: {
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onPickImage: () => void
}) {
  return (
    <div className="image-tile-controls">
      <button className="image-tile-ctrl-btn" onClick={() => void onPickImage()} title="Open image">
        <FolderOpen size={11} />
      </button>
      <button
        className="image-tile-ctrl-btn"
        onClick={onZoomOut}
        title="Zoom out"
        disabled={scale <= MIN_SCALE}
      >
        <ZoomOut size={11} />
      </button>
      <span className="image-tile-zoom-label">{Math.round(scale * 100)}%</span>
      <button
        className="image-tile-ctrl-btn"
        onClick={onZoomIn}
        title="Zoom in"
        disabled={scale >= MAX_SCALE}
      >
        <ZoomIn size={11} />
      </button>
      <button
        className="image-tile-ctrl-btn image-tile-ctrl-reset"
        onClick={onReset}
        title="Reset zoom"
      >
        <RotateCcw size={11} />
      </button>
    </div>
  )
}

// Hook for image tile state and handlers
function useImageTileState(
  tile: ImageTileProps['tile'],
  onUpdate: ImageTileProps['onUpdate']
) {
  const filePath = typeof tile.meta.filePath === 'string' ? tile.meta.filePath : ''
  const [scale, setScale] = useState(1)
  const [imgError, setImgError] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fileName = filePath ? tilePathBasename(filePath) : undefined

  const src = filePath
    ? filePath.startsWith('http://') ||
      filePath.startsWith('https://') ||
      filePath.startsWith('file://')
      ? filePath
      : `file://${filePath}`
    : ''

  const handleZoomIn = useCallback(() => {
    setScale(s => Math.min(MAX_SCALE, parseFloat((s + ZOOM_STEP).toFixed(2))))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale(s => Math.max(MIN_SCALE, parseFloat((s - ZOOM_STEP).toFixed(2))))
  }, [])

  const handleReset = useCallback(() => {
    setScale(1)
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
    setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, parseFloat((s + delta).toFixed(2)))))
  }, [])

  const handleImgError = useCallback(() => {
    setImgError(true)
  }, [])

  const handleImgLoad = useCallback(() => {
    setImgError(false)
  }, [])

  const handlePickImage = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.orxa?.opencode : undefined
    if (!bridge?.pickImage) return

    try {
      const result = await bridge.pickImage()
      if (!result) return
      setImgError(false)
      setScale(1)
      onUpdate(tile.id, {
        meta: { ...tile.meta, filePath: result.path },
      })
    } catch {
      // Silently ignore picker cancellation or errors
    }
  }, [tile.id, tile.meta, onUpdate])

  return {
    filePath,
    src,
    fileName,
    scale,
    imgError,
    containerRef,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleWheel,
    handleImgError,
    handleImgLoad,
    handlePickImage,
  }
}

export function ImageTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: ImageTileProps) {
  const {
    filePath,
    src,
    fileName,
    scale,
    imgError,
    containerRef,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    handleWheel,
    handleImgError,
    handleImgLoad,
    handlePickImage,
  } = useImageTileState(tile, onUpdate)

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<ImageIcon size={12} />}
      label="image viewer"
      iconColor="var(--text-tertiary, #737373)"
      metadata={fileName}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="image-tile-body">
        <ImageViewport
          filePath={filePath}
          src={src}
          fileName={fileName}
          scale={scale}
          imgError={imgError}
          containerRef={containerRef}
          onWheel={handleWheel}
          onImgError={handleImgError}
          onImgLoad={handleImgLoad}
          onPickImage={handlePickImage}
        />
        <ImageControls
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onReset={handleReset}
          onPickImage={handlePickImage}
        />
      </div>
    </CanvasTileComponent>
  )
}
