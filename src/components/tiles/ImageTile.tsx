import { useCallback, useRef, useState } from "react";
import { FolderOpen, Image as ImageIcon, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { CanvasTileComponent } from "../CanvasTile";
import { tilePathBasename, type CanvasTileComponentProps } from "./tile-shared";

type ImageTileProps = CanvasTileComponentProps;

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.25;

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
  const filePath = typeof tile.meta.filePath === "string" ? tile.meta.filePath : "";

  const [scale, setScale] = useState(1);
  const [imgError, setImgError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fileName = filePath ? tilePathBasename(filePath) : undefined;

  // Resolve src — electron file:// paths need the protocol prefix
  const src = filePath
    ? filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("file://")
      ? filePath
      : `file://${filePath}`
    : "";

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_SCALE, parseFloat((s + ZOOM_STEP).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_SCALE, parseFloat((s - ZOOM_STEP).toFixed(2))));
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, parseFloat((s + delta).toFixed(2)))));
  }, []);

  const handleImgError = useCallback(() => {
    setImgError(true);
  }, []);

  const handleImgLoad = useCallback(() => {
    setImgError(false);
  }, []);

  const handlePickImage = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.orxa?.opencode : undefined;
    if (!bridge?.pickImage) return;

    try {
      const result = await bridge.pickImage();
      if (!result) return;
      setImgError(false);
      setScale(1);
      onUpdate(tile.id, {
        meta: { ...tile.meta, filePath: result.path },
      });
    } catch {
      // Silently ignore picker cancellation or errors
    }
  }, [tile.id, tile.meta, onUpdate]);

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
        <div
          className="image-tile-viewport"
          ref={containerRef}
          onWheel={handleWheel}
        >
          {!filePath ? (
            <div className="image-tile-placeholder">
              <ImageIcon size={32} />
              <span>no image loaded</span>
              <button
                className="image-tile-open-btn"
                onClick={() => void handlePickImage()}
                title="Open image file"
              >
                <FolderOpen size={13} />
                <span>open image</span>
              </button>
            </div>
          ) : imgError ? (
            <div className="image-tile-placeholder image-tile-error">
              <ImageIcon size={32} />
              <span>failed to load image</span>
              <span className="image-tile-error-path">{filePath}</span>
              <button
                className="image-tile-open-btn"
                onClick={() => void handlePickImage()}
                title="Open different image"
              >
                <FolderOpen size={13} />
                <span>open another</span>
              </button>
            </div>
          ) : (
            <img
              className="image-tile-img"
              src={src}
              alt={fileName ?? "image"}
              style={{ transform: `scale(${scale})` }}
              onError={handleImgError}
              onLoad={handleImgLoad}
              draggable={false}
            />
          )}
        </div>
        <div className="image-tile-controls">
          <button
            className="image-tile-ctrl-btn"
            onClick={() => void handlePickImage()}
            title="Open image"
          >
            <FolderOpen size={11} />
          </button>
          <button
            className="image-tile-ctrl-btn"
            onClick={handleZoomOut}
            title="Zoom out"
            disabled={scale <= MIN_SCALE}
          >
            <ZoomOut size={11} />
          </button>
          <span className="image-tile-zoom-label">{Math.round(scale * 100)}%</span>
          <button
            className="image-tile-ctrl-btn"
            onClick={handleZoomIn}
            title="Zoom in"
            disabled={scale >= MAX_SCALE}
          >
            <ZoomIn size={11} />
          </button>
          <button
            className="image-tile-ctrl-btn image-tile-ctrl-reset"
            onClick={handleReset}
            title="Reset zoom"
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>
    </CanvasTileComponent>
  );
}
