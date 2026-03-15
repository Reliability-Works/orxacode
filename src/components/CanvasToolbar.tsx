import { useRef, useState } from "react";
import { Lock, Palette, Plus, RotateCcw } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../types/canvas";
import { AddTileDropdown } from "./AddTileDropdown";
import { CanvasThemePicker } from "./CanvasThemePicker";

type CanvasToolbarProps = {
  tileCount: number;
  snapToGrid: boolean;
  theme?: CanvasTheme;
  onAddTile: (type: CanvasTile["type"]) => void;
  onTheme?: () => void;
  onThemeChange?: (theme: Partial<CanvasTheme>) => void;
  onToggleSnap: () => void;
  onReset: () => void;
};

export function CanvasToolbar({
  tileCount,
  snapToGrid,
  theme,
  onAddTile,
  onTheme,
  onThemeChange,
  onToggleSnap,
  onReset,
}: CanvasToolbarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

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

      <div className="canvas-toolbar-spacer" />

      <span className="canvas-toolbar-count">{tileCount} tiles</span>

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

      <button
        type="button"
        className="canvas-toolbar-icon-btn"
        onClick={onReset}
        aria-label="Reset canvas"
        title="Reset canvas"
      >
        <RotateCcw size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
