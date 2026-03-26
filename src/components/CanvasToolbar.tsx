import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Crosshair, LayoutGrid, Lock, Palette, Plus, RotateCcw, Settings2, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../types/canvas";
import type { CanvasTileSortMode } from "../lib/canvas-layout";
import { AddTileDropdown } from "./AddTileDropdown";
import { CanvasThemePicker } from "./CanvasThemePicker";

type CanvasToolbarProps = {
  tileCount: number;
  tiles: CanvasTile[];
  zoom: number;
  snapToGrid: boolean;
  theme?: CanvasTheme;
  onAddTile: (type: CanvasTile["type"]) => void;
  onTheme?: () => void;
  onThemeChange?: (theme: Partial<CanvasTheme>) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onToggleSnap: () => void;
  onReset: () => void;
  onJumpToTile?: (tile: CanvasTile) => void;
  onSortTiles?: (mode: CanvasTileSortMode) => void;
  onDuplicateTile?: (tile: CanvasTile) => void;
  onRemoveTile?: (tileId: string) => void;
};

const DRAG_THRESHOLD = 5;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);

  const [dragPosition, setDragPosition] = useState({ x: 16, y: -24 });
  const isDraggingRef = useRef(false);
  const dragStartMouseRef = useRef({ x: 0, y: 0 });
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const totalMovedRef = useRef(0);

  const hubRef = useRef<HTMLDivElement>(null);
  const jumpMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const manageMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const zoomPercentLabel = `${Math.round(zoom * 100)}%`;

  // --- Drag handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    totalMovedRef.current = 0;
    dragStartMouseRef.current = { x: e.clientX, y: e.clientY };
    dragStartPosRef.current = { x: dragPosition.x, y: dragPosition.y };
  }, [dragPosition]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartMouseRef.current.x;
      const dy = e.clientY - dragStartMouseRef.current.y;
      totalMovedRef.current = Math.max(totalMovedRef.current, Math.abs(dx) + Math.abs(dy));
      setDragPosition({
        x: dragStartPosRef.current.x + dx,
        y: dragStartPosRef.current.y + dy,
      });
    }
    function onMouseUp() {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      if (totalMovedRef.current < DRAG_THRESHOLD) {
        setMenuOpen((v) => !v);
      }
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // --- Close hub menu on outside click ---
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (hubRef.current && !hubRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setDropdownOpen(false);
        setThemePickerOpen(false);
        setJumpMenuOpen(false);
        setSortMenuOpen(false);
        setManageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // --- Close submenus on outside click ---
  useEffect(() => {
    if (!jumpMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (jumpMenuRef.current && !jumpMenuRef.current.contains(e.target as Node)) {
        setJumpMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [jumpMenuOpen]);

  useEffect(() => {
    if (!sortMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortMenuOpen]);

  useEffect(() => {
    if (!manageMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (manageMenuRef.current && !manageMenuRef.current.contains(e.target as Node)) {
        setManageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [manageMenuOpen]);

  // Use calc for vertical centering: default y=-24 means top: calc(50% - 24px)
  const hubStyle: React.CSSProperties = {
    left: dragPosition.x,
    top: dragPosition.y === -24 ? "calc(50% - 24px)" : dragPosition.y,
  };

  return (
    <div className="canvas-toolbar">
      {/* --- Draggable floating hub --- */}
      <div ref={hubRef} className="canvas-hub" style={hubStyle}>
        <button
          type="button"
          className={`canvas-hub-trigger${menuOpen ? " is-open" : ""}`}
          onMouseDown={handleMouseDown}
          aria-label="Canvas controls"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <LayoutGrid size={18} aria-hidden="true" />
        </button>

        {menuOpen && (
          <div className="canvas-hub-menu" role="menu">
            {/* Add tile */}
            <div className="canvas-toolbar-add-wrap">
              <button
                ref={addButtonRef}
                type="button"
                role="menuitem"
                className={`canvas-hub-menu-item${dropdownOpen ? " active" : ""}`}
                onClick={() => setDropdownOpen((v) => !v)}
                aria-label="Add tile"
                aria-expanded={dropdownOpen}
                aria-haspopup="dialog"
              >
                <Plus size={14} aria-hidden="true" />
                <span>add tile</span>
              </button>
              {dropdownOpen && (
                <AddTileDropdown
                  onAddTile={onAddTile}
                  onClose={() => setDropdownOpen(false)}
                />
              )}
            </div>

            {/* Theme */}
            <div className="canvas-toolbar-theme-anchor">
              <button
                type="button"
                role="menuitem"
                className={`canvas-hub-menu-item${themePickerOpen ? " active" : ""}`}
                onClick={() => {
                  if (theme && onThemeChange) {
                    setThemePickerOpen((v) => !v);
                  } else {
                    onTheme?.();
                  }
                }}
                aria-label="Theme"
                aria-expanded={theme && onThemeChange ? themePickerOpen : undefined}
                aria-haspopup={theme && onThemeChange ? "dialog" : undefined}
              >
                <Palette size={14} aria-hidden="true" />
                <span>theme</span>
              </button>
              {themePickerOpen && theme && onThemeChange && (
                <CanvasThemePicker
                  theme={theme}
                  onThemeChange={onThemeChange}
                  onClose={() => setThemePickerOpen(false)}
                />
              )}
            </div>

            {/* Lock / snap to grid */}
            <button
              type="button"
              role="menuitem"
              className={`canvas-hub-menu-item${snapToGrid ? " active" : ""}`}
              onClick={onToggleSnap}
              aria-label="Lock tiles"
              title={snapToGrid ? "Unlock tiles" : "Lock tiles"}
              aria-pressed={snapToGrid}
            >
              <Lock size={14} aria-hidden="true" />
              <span>{snapToGrid ? "locked" : "lock"}</span>
            </button>

            {onSortTiles && tiles.length > 1 ? (
              <div ref={sortMenuRef} className="canvas-toolbar-jump-wrap">
                <button
                  type="button"
                  role="menuitem"
                  className={`canvas-hub-menu-item${sortMenuOpen ? " active" : ""}`}
                  onClick={() => setSortMenuOpen((v) => !v)}
                  aria-label="Sort tiles"
                  aria-expanded={sortMenuOpen}
                  aria-haspopup="menu"
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                  <span>sort</span>
                </button>
                {sortMenuOpen ? (
                  <div className="canvas-toolbar-jump-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSortMenuOpen(false);
                        setMenuOpen(false);
                        onSortTiles("type");
                      }}
                    >
                      <span className="canvas-toolbar-jump-type">mode</span>
                      <span className="canvas-toolbar-jump-meta">by tile type</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setSortMenuOpen(false);
                        setMenuOpen(false);
                        onSortTiles("created");
                      }}
                    >
                      <span className="canvas-toolbar-jump-type">mode</span>
                      <span className="canvas-toolbar-jump-meta">by time created</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Reset view */}
            <button
              type="button"
              role="menuitem"
              className="canvas-hub-menu-item"
              onClick={() => {
                onReset();
                setMenuOpen(false);
              }}
              aria-label="Reset canvas view"
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>reset view</span>
            </button>
          </div>
        )}
      </div>

      {/* --- Bottom-right controls --- */}
      <div className="canvas-toolbar-bottom-row">
        {tiles.length > 0 && (onDuplicateTile || onRemoveTile) ? (
          <div ref={manageMenuRef} className="canvas-toolbar-jump-wrap canvas-toolbar-pill-wrap">
            <button
              type="button"
              className={`canvas-toolbar-btn canvas-toolbar-pill${manageMenuOpen ? " active" : ""}`}
              onClick={() => setManageMenuOpen((v) => !v)}
              aria-label="Manage tiles"
              aria-expanded={manageMenuOpen}
              aria-haspopup="menu"
            >
              <Settings2 size={12} aria-hidden="true" />
              <span>manage</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            {manageMenuOpen ? (
              <div className="canvas-toolbar-jump-menu canvas-toolbar-jump-menu-up" role="menu">
                {tiles.map((tile) => (
                  <div key={tile.id} className="canvas-toolbar-manage-row">
                    <span className="canvas-toolbar-jump-type">{tile.type.replace(/_/g, " ")}</span>
                    <span className="canvas-toolbar-jump-meta">
                      {(tile.meta?.title as string) || (tile.meta?.url as string) || (tile.meta?.directory as string) || tile.id.slice(0, 8)}
                    </span>
                    <span className="canvas-toolbar-manage-actions">
                      {onDuplicateTile ? (
                        <button
                          type="button"
                          title="Duplicate"
                          onClick={() => { setManageMenuOpen(false); onDuplicateTile(tile); }}
                        >
                          <Copy size={11} />
                        </button>
                      ) : null}
                      {onRemoveTile ? (
                        <button
                          type="button"
                          className="canvas-toolbar-manage-delete"
                          title="Remove"
                          onClick={() => { setManageMenuOpen(false); onRemoveTile(tile.id); }}
                        >
                          <Trash2 size={11} />
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {onJumpToTile && tiles.length > 0 ? (
          <div ref={jumpMenuRef} className="canvas-toolbar-jump-wrap canvas-toolbar-pill-wrap">
            <button
              type="button"
              className={`canvas-toolbar-btn canvas-toolbar-pill${jumpMenuOpen ? " active" : ""}`}
              onClick={() => setJumpMenuOpen((v) => !v)}
              aria-label="Jump to tile"
              aria-expanded={jumpMenuOpen}
              aria-haspopup="menu"
            >
              <Crosshair size={12} aria-hidden="true" />
              <span>jump to</span>
              <ChevronDown size={11} aria-hidden="true" />
            </button>
            {jumpMenuOpen ? (
              <div className="canvas-toolbar-jump-menu canvas-toolbar-jump-menu-up" role="menu">
                {tiles.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setJumpMenuOpen(false);
                      onJumpToTile(tile);
                    }}
                  >
                    <span className="canvas-toolbar-jump-type">{tile.type.replace(/_/g, " ")}</span>
                    <span className="canvas-toolbar-jump-meta">
                      {(tile.meta?.title as string) || (tile.meta?.url as string) || (tile.meta?.directory as string) || tile.id.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
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
      </div>
    </div>
  );
}
