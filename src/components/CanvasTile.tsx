import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Maximize2, X } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../types/canvas";

interface SnapGuide {
  type: "h" | "v";
  position: number; // top (h) or left (v), in px
}

interface CanvasTileProps {
  tile: CanvasTile;
  canvasTheme: CanvasTheme;
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void;
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  iconColor: string;
  metadata?: string;
  snapToGrid?: boolean;
  gridSize?: number;
  allTiles?: CanvasTile[];
}

type ResizeDirection =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

const MIN_WIDTH = 200;
const MIN_HEIGHT = 150;

const SNAP_THRESHOLD = 8; // px — edge proximity for alignment guide snap

function snapToGridValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Given a dragged tile's proposed position, check all other tiles for edge
 * alignment. Returns snapped coordinates and any guides to display.
 */
function computeAlignmentSnap(
  proposedX: number,
  proposedY: number,
  tileW: number,
  tileH: number,
  allTiles: CanvasTile[],
  selfId: string,
): { x: number; y: number; guides: SnapGuide[] } {
  let snappedX = proposedX;
  let snappedY = proposedY;
  const guides: SnapGuide[] = [];

  // Edges of the dragged tile
  const left = proposedX;
  const right = proposedX + tileW;
  const top = proposedY;
  const bottom = proposedY + tileH;
  const centerX = proposedX + tileW / 2;
  const centerY = proposedY + tileH / 2;

  let bestXDelta = SNAP_THRESHOLD + 1;
  let bestYDelta = SNAP_THRESHOLD + 1;
  let bestXSnap = proposedX;
  let bestYSnap = proposedY;
  let bestXGuide: SnapGuide | null = null;
  let bestYGuide: SnapGuide | null = null;

  for (const other of allTiles) {
    if (other.id === selfId || other.minimized || other.maximized) continue;

    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.height;
    const oCenterX = other.x + other.width / 2;
    const oCenterY = other.y + other.height / 2;

    // Horizontal edge checks (snap X so our edges align with other's edges)
    const xCandidates: Array<{ delta: number; snap: number; guide: SnapGuide }> = [
      // our left aligns with other's left
      { delta: Math.abs(left - oLeft), snap: oLeft, guide: { type: "v", position: oLeft } },
      // our left aligns with other's right
      { delta: Math.abs(left - oRight), snap: oRight, guide: { type: "v", position: oRight } },
      // our right aligns with other's right
      { delta: Math.abs(right - oRight), snap: oRight - tileW, guide: { type: "v", position: oRight } },
      // our right aligns with other's left
      { delta: Math.abs(right - oLeft), snap: oLeft - tileW, guide: { type: "v", position: oLeft } },
      // our centerX aligns with other's centerX
      { delta: Math.abs(centerX - oCenterX), snap: oCenterX - tileW / 2, guide: { type: "v", position: oCenterX } },
    ];

    const yCandidates: Array<{ delta: number; snap: number; guide: SnapGuide }> = [
      { delta: Math.abs(top - oTop), snap: oTop, guide: { type: "h", position: oTop } },
      { delta: Math.abs(top - oBottom), snap: oBottom, guide: { type: "h", position: oBottom } },
      { delta: Math.abs(bottom - oBottom), snap: oBottom - tileH, guide: { type: "h", position: oBottom } },
      { delta: Math.abs(bottom - oTop), snap: oTop - tileH, guide: { type: "h", position: oTop } },
      { delta: Math.abs(centerY - oCenterY), snap: oCenterY - tileH / 2, guide: { type: "h", position: oCenterY } },
    ];

    for (const c of xCandidates) {
      if (c.delta < bestXDelta) {
        bestXDelta = c.delta;
        bestXSnap = c.snap;
        bestXGuide = c.guide;
      }
    }
    for (const c of yCandidates) {
      if (c.delta < bestYDelta) {
        bestYDelta = c.delta;
        bestYSnap = c.snap;
        bestYGuide = c.guide;
      }
    }
  }

  if (bestXDelta <= SNAP_THRESHOLD) {
    snappedX = bestXSnap;
    if (bestXGuide) guides.push(bestXGuide);
  }
  if (bestYDelta <= SNAP_THRESHOLD) {
    snappedY = bestYSnap;
    if (bestYGuide) guides.push(bestYGuide);
  }

  return { x: snappedX, y: snappedY, guides };
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
}: CanvasTileProps) {
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  // Store previous position/size for restore from maximize
  const prevGeometryRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Drag state
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    tileX: number;
    tileY: number;
  } | null>(null);

  // Resize state
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    tileX: number;
    tileY: number;
    tileW: number;
    tileH: number;
    direction: ResizeDirection;
  } | null>(null);

  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);

  // Bring to front on any mousedown on the tile
  const handleTileMouseDown = useCallback(() => {
    onBringToFront(tile.id);
  }, [onBringToFront, tile.id]);

  // --- Drag logic ---
  const handleHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only left button, not on control buttons
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".canvas-tile-ctrl")) return;
      if (tile.maximized) return;
      if (snapToGrid) return; // Locked — prevent drag

      e.preventDefault();
      e.stopPropagation();

      onBringToFront(tile.id);

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        tileX: tile.x,
        tileY: tile.y,
      };
      isDraggingRef.current = true;
    },
    [onBringToFront, tile.id, tile.x, tile.y, tile.maximized, snapToGrid],
  );

  // Keep refs up-to-date for use inside event handlers without adding to deps
  const snapToGridRef = useRef(snapToGrid);
  const gridSizeRef = useRef(gridSize);
  const allTilesRef = useRef(allTiles);
  useEffect(() => { snapToGridRef.current = snapToGrid; }, [snapToGrid]);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { allTilesRef.current = allTiles; }, [allTiles]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      let newX = Math.max(0, dragStartRef.current.tileX + dx);
      let newY = Math.max(0, dragStartRef.current.tileY + dy);

      if (snapToGridRef.current) {
        const gs = gridSizeRef.current;
        // First apply grid snap
        newX = snapToGridValue(newX, gs);
        newY = snapToGridValue(newY, gs);
        // Then check alignment guides against other tiles
        const { x: alignX, y: alignY, guides } = computeAlignmentSnap(
          newX,
          newY,
          tile.width,
          tile.height,
          allTilesRef.current,
          tile.id,
        );
        newX = alignX;
        newY = alignY;
        setSnapGuides(guides);
      } else {
        setSnapGuides([]);
      }

      onUpdate(tile.id, { x: newX, y: newY });
    }

    function onMouseUp() {
      isDraggingRef.current = false;
      dragStartRef.current = null;
      setSnapGuides([]);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onUpdate, tile.id, tile.width, tile.height]);

  // --- Resize logic ---
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, direction: ResizeDirection) => {
      if (e.button !== 0) return;
      if (tile.maximized || tile.minimized) return;
      if (snapToGrid) return; // Locked — prevent resize

      e.preventDefault();
      e.stopPropagation();

      onBringToFront(tile.id);

      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        tileX: tile.x,
        tileY: tile.y,
        tileW: tile.width,
        tileH: tile.height,
        direction,
      };
      isResizingRef.current = true;
    },
    [onBringToFront, tile.id, tile.x, tile.y, tile.width, tile.height, tile.maximized, tile.minimized, snapToGrid],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isResizingRef.current || !resizeStartRef.current) return;
      const { mouseX, mouseY, tileX, tileY, tileW, tileH, direction } = resizeStartRef.current;
      const dx = e.clientX - mouseX;
      const dy = e.clientY - mouseY;

      let newX = tileX;
      let newY = tileY;
      let newW = tileW;
      let newH = tileH;

      // Horizontal
      if (direction.includes("e")) {
        newW = Math.max(MIN_WIDTH, tileW + dx);
      }
      if (direction.includes("w")) {
        const proposedW = tileW - dx;
        if (proposedW >= MIN_WIDTH) {
          newW = proposedW;
          newX = tileX + dx;
        } else {
          newW = MIN_WIDTH;
          newX = tileX + tileW - MIN_WIDTH;
        }
      }

      // Vertical
      if (direction.includes("s")) {
        newH = Math.max(MIN_HEIGHT, tileH + dy);
      }
      if (direction.includes("n")) {
        const proposedH = tileH - dy;
        if (proposedH >= MIN_HEIGHT) {
          newH = proposedH;
          newY = tileY + dy;
        } else {
          newH = MIN_HEIGHT;
          newY = tileY + tileH - MIN_HEIGHT;
        }
      }

      // Apply grid snapping to dimensions and position
      if (snapToGridRef.current) {
        const gs = gridSizeRef.current;
        newW = Math.max(MIN_WIDTH, snapToGridValue(newW, gs));
        newH = Math.max(MIN_HEIGHT, snapToGridValue(newH, gs));
        newX = snapToGridValue(newX, gs);
        newY = snapToGridValue(newY, gs);
      }

      onUpdate(tile.id, { x: newX, y: newY, width: newW, height: newH });
    }

    function onMouseUp() {
      isResizingRef.current = false;
      resizeStartRef.current = null;
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onUpdate, tile.id]);

  // --- Controls ---
  const handleMinimize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onUpdate(tile.id, { minimized: !tile.minimized, maximized: false });
    },
    [onUpdate, tile.id, tile.minimized],
  );

  const handleMaximize = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (tile.maximized) {
        // Restore
        const prev = prevGeometryRef.current;
        if (prev) {
          onUpdate(tile.id, {
            maximized: false,
            minimized: false,
            x: prev.x,
            y: prev.y,
            width: prev.width,
            height: prev.height,
          });
          prevGeometryRef.current = null;
        } else {
          onUpdate(tile.id, { maximized: false, minimized: false });
        }
      } else {
        prevGeometryRef.current = {
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
        };
        onUpdate(tile.id, { maximized: true, minimized: false });
      }
    },
    [onUpdate, tile.id, tile.maximized, tile.x, tile.y, tile.width, tile.height],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(tile.id);
    },
    [onRemove, tile.id],
  );

  const tileStyle: React.CSSProperties = tile.maximized
    ? {
        zIndex: tile.zIndex,
      }
    : {
        left: tile.x,
        top: tile.y,
        width: tile.width,
        height: tile.minimized ? 32 : tile.height,
        zIndex: tile.zIndex,
      };

  const classes = [
    "canvas-tile",
    tile.minimized ? "minimized" : "",
    tile.maximized ? "maximized" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={tileStyle}
      onMouseDown={handleTileMouseDown}
    >
      {/* Resize handles — only when not maximized/minimized/locked */}
      {!tile.maximized && !tile.minimized && !snapToGrid && (
        <>
          <div
            className="canvas-tile-resize canvas-tile-resize-n"
            onMouseDown={(e) => handleResizeMouseDown(e, "n")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-s"
            onMouseDown={(e) => handleResizeMouseDown(e, "s")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-e"
            onMouseDown={(e) => handleResizeMouseDown(e, "e")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-w"
            onMouseDown={(e) => handleResizeMouseDown(e, "w")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-ne"
            onMouseDown={(e) => handleResizeMouseDown(e, "ne")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-nw"
            onMouseDown={(e) => handleResizeMouseDown(e, "nw")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-se"
            onMouseDown={(e) => handleResizeMouseDown(e, "se")}
          />
          <div
            className="canvas-tile-resize canvas-tile-resize-sw"
            onMouseDown={(e) => handleResizeMouseDown(e, "sw")}
          />
        </>
      )}

      <div className={`canvas-tile-header${snapToGrid ? " locked" : ""}`} onMouseDown={handleHeaderMouseDown}>
        <span className="canvas-tile-icon" style={{ color: iconColor }}>
          {icon}
        </span>
        <span className="canvas-tile-label">{label}</span>
        {metadata ? (
          <span className="canvas-tile-meta">{metadata}</span>
        ) : null}
        <span className="canvas-tile-header-spacer" />
        <button
          className="canvas-tile-ctrl"
          onClick={handleMinimize}
          title={tile.minimized ? "Restore" : "Minimize"}
        >
          <Minus size={10} />
        </button>
        <button
          className="canvas-tile-ctrl"
          onClick={handleMaximize}
          title={tile.maximized ? "Restore" : "Maximize"}
        >
          <Maximize2 size={10} />
        </button>
        <button
          className="canvas-tile-ctrl canvas-tile-ctrl-close"
          onClick={handleClose}
          title="Close"
        >
          <X size={10} />
        </button>
      </div>

      {!tile.minimized && (
        <div className="canvas-tile-body">{children}</div>
      )}

      {/* Alignment snap guides — shown during drag when snap is active */}
      {snapGuides.map((guide, i) =>
        guide.type === "h" ? (
          <div
            key={i}
            className="canvas-snap-guide canvas-snap-guide-h"
            style={{ top: guide.position - tile.y }}
          />
        ) : (
          <div
            key={i}
            className="canvas-snap-guide canvas-snap-guide-v"
            style={{ left: guide.position - tile.x }}
          />
        )
      )}
    </div>
  );
}

// Also export as default for convenience
export default CanvasTileComponent;
