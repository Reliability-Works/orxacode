import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CanvasTheme } from "../types/canvas";

export const CANVAS_PRESETS = [
  { id: "midnight", label: "midnight", background: "#0C0C0C", tileBorder: "#1F1F1F", accent: "#22C55E" },
  { id: "charcoal", label: "charcoal", background: "#2A2A2A", tileBorder: "#3A3A3A", accent: "#22C55E" },
  { id: "deep_navy", label: "deep_navy", background: "#0D1B2A", tileBorder: "#1B3A5C", accent: "#3B82F6" },
  { id: "forest", label: "forest", background: "#0D1F0D", tileBorder: "#1A3A1A", accent: "#22C55E" },
  { id: "obsidian", label: "obsidian", background: "#1A0A2E", tileBorder: "#2D1B4E", accent: "#A78BFA" },
  { id: "slate", label: "slate", background: "#2C3E50", tileBorder: "#3D5166", accent: "#3B82F6" },
] as const;

type CanvasPresetId = (typeof CANVAS_PRESETS)[number]["id"];

type CanvasThemePickerProps = {
  theme: CanvasTheme;
  onThemeChange: (theme: Partial<CanvasTheme>) => void;
  onClose: () => void;
};

export function CanvasThemePicker({ theme, onThemeChange, onClose }: CanvasThemePickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  function handlePresetClick(preset: (typeof CANVAS_PRESETS)[number]) {
    onThemeChange({
      preset: preset.id,
      background: preset.background,
      tileBorder: preset.tileBorder,
      accent: preset.accent,
    });
  }

  function handleColorChange(key: keyof Pick<CanvasTheme, "background" | "tileBorder" | "accent">, value: string) {
    onThemeChange({ [key]: value, preset: null });
  }

  const activePresetId = theme.preset as CanvasPresetId | null;

  return (
    <div className="canvas-theme-picker" ref={popoverRef} role="dialog" aria-label="Canvas theme picker">
      <div className="canvas-theme-picker-header">
        <span className="canvas-theme-picker-title">canvas_theme</span>
        <button
          type="button"
          className="canvas-theme-picker-close"
          onClick={onClose}
          aria-label="Close theme picker"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="canvas-theme-picker-section-label">// preset themes</div>

      <div className="canvas-theme-picker-presets">
        {CANVAS_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`canvas-theme-swatch${activePresetId === preset.id ? " active" : ""}`}
            onClick={() => handlePresetClick(preset)}
            aria-label={`Apply ${preset.label} theme`}
            aria-pressed={activePresetId === preset.id}
            style={
              {
                "--swatch-bg": preset.background,
                "--swatch-accent": preset.accent,
              } as React.CSSProperties
            }
          >
            <span
              className="canvas-theme-swatch-color"
              style={{ background: preset.background }}
            />
            <span className="canvas-theme-swatch-label">{preset.label}</span>
          </button>
        ))}
      </div>

      <div className="canvas-theme-picker-section-label">// customize</div>

      <div className="canvas-theme-picker-custom">
        <ColorRow
          label="background"
          value={theme.background}
          onChange={(v) => handleColorChange("background", v)}
        />
        <ColorRow
          label="tile_border"
          value={theme.tileBorder}
          onChange={(v) => handleColorChange("tileBorder", v)}
        />
        <ColorRow
          label="accent"
          value={theme.accent}
          onChange={(v) => handleColorChange("accent", v)}
          accentColor={theme.accent}
        />
      </div>
    </div>
  );
}

type ColorRowProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accentColor?: string;
};

function ColorRow({ label, value, onChange, accentColor }: ColorRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSwatchClick() {
    inputRef.current?.click();
  }

  return (
    <div className="canvas-theme-color-row">
      <button
        type="button"
        className="canvas-theme-color-swatch"
        onClick={handleSwatchClick}
        aria-label={`Change ${label} color`}
        style={{ background: value }}
      >
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="canvas-theme-color-input"
          aria-hidden="true"
          tabIndex={-1}
        />
      </button>
      <span className="canvas-theme-color-label">{label}</span>
      <span
        className="canvas-theme-color-hex"
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value.toLowerCase()}
      </span>
    </div>
  );
}
