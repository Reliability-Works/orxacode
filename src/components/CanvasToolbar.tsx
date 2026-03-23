import { useEffect, useRef, useState } from "react";
import { Copy, Crosshair, Lock, Palette, Plus, RotateCcw, Settings2, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../types/canvas";
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
  onDuplicateTile?: (tile: CanvasTile) => void;
  onRemoveTile?: (tileId: string) => void;
};

export function CanvasToolbar({
  tileCount,
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
  onDuplicateTile,
  onRemoveTile,
}: CanvasToolbarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const jumpMenuRef = useRef<HTMLDivElement>(null);
  const manageMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const zoomPercentLabel = `${Math.round(zoom * 100)}%`;

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
    if (!manageMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (manageMenuRef.current && !manageMenuRef.current.contains(e.target as Node)) {
        setManageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [manageMenuOpen]);

  return (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar-add-wrap">
        <button
          ref={addButtonRef}
          type="button"
          className={`canvas-toolbar-add${dropdownOpen ? " active" : ""}`}
          onClick={() => setDropdownOpen((v) => !v)}
          aria-label="Add tile"
          aria-expanded={dropdownOpen}
          aria-haspopup="dialog"
        >
          <Plus size={12} aria-hidden="true" />
          <span>add tile</span>
        </button>

        {dropdownOpen && (
          <AddTileDropdown
            onAddTile={onAddTile}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>

      <div className="canvas-toolbar-theme-anchor">
        <button
          type="button"
          className={`canvas-toolbar-btn${themePickerOpen ? " active" : ""}`}
          onClick={() => {
            if (theme && onThemeChange) {
              setThemePickerOpen((v) => !v);
            } else {
              onTheme?.();
            }
          }}
          aria-label="Theme"
          title="Theme"
          aria-expanded={theme && onThemeChange ? themePickerOpen : undefined}
          aria-haspopup={theme && onThemeChange ? "dialog" : undefined}
        >
          <Palette size={12} aria-hidden="true" />
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

      <button
        type="button"
        className={`canvas-toolbar-btn${snapToGrid ? " active" : ""}`}
        onClick={onToggleSnap}
        aria-label="Lock tiles"
        title={snapToGrid ? "Unlock tiles" : "Lock tiles"}
        aria-pressed={snapToGrid}
      >
        <Lock size={12} aria-hidden="true" />
        <span>{snapToGrid ? "locked" : "lock"}</span>
      </button>

      {onJumpToTile && tiles.length > 0 ? (
        <div ref={jumpMenuRef} className="canvas-toolbar-jump-wrap">
          <button
            type="button"
            className={`canvas-toolbar-btn${jumpMenuOpen ? " active" : ""}`}
            onClick={() => setJumpMenuOpen((v) => !v)}
            aria-label="Jump to tile"
            title="Jump to tile"
            aria-expanded={jumpMenuOpen}
            aria-haspopup="menu"
          >
            <Crosshair size={12} aria-hidden="true" />
            <span>jump to</span>
          </button>
          {jumpMenuOpen ? (
            <div className="canvas-toolbar-jump-menu" role="menu">
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

      {tiles.length > 0 && (onDuplicateTile || onRemoveTile) ? (
        <div ref={manageMenuRef} className="canvas-toolbar-jump-wrap">
          <button
            type="button"
            className={`canvas-toolbar-btn${manageMenuOpen ? " active" : ""}`}
            onClick={() => setManageMenuOpen((v) => !v)}
            aria-label="Manage tiles"
            title="Manage tiles"
            aria-expanded={manageMenuOpen}
            aria-haspopup="menu"
          >
            <Settings2 size={12} aria-hidden="true" />
            <span>manage</span>
          </button>
          {manageMenuOpen ? (
            <div className="canvas-toolbar-jump-menu" role="menu">
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

      <button
        type="button"
        className="canvas-toolbar-icon-btn"
        onClick={onReset}
        aria-label="Center canvas view"
        title="Center canvas view"
      >
        <RotateCcw size={13} aria-hidden="true" />
      </button>

      <div className="canvas-toolbar-spacer" />

      <span className="canvas-toolbar-count">{tileCount} tiles</span>
    </div>
  );
}
