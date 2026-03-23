import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { CanvasTheme } from "../types/canvas";

export const CANVAS_PRESETS = [
  { id: "glass", label: "glass", background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 100%), #141418", tileBorder: "rgba(255,255,255,0.08)", accent: "#22C55E" },
  { id: "midnight", label: "midnight", background: "#0C0C0C", tileBorder: "#1F1F1F", accent: "#22C55E" },
  { id: "charcoal", label: "charcoal", background: "#2A2A2A", tileBorder: "#3A3A3A", accent: "#22C55E" },
  { id: "deep_navy", label: "deep navy", background: "#0D1B2A", tileBorder: "#1B3A5C", accent: "#3B82F6" },
  { id: "forest", label: "forest", background: "#0D1F0D", tileBorder: "#1A3A1A", accent: "#22C55E" },
  { id: "obsidian", label: "obsidian", background: "#1A0A2E", tileBorder: "#2D1B4E", accent: "#A78BFA" },
  { id: "slate", label: "slate", background: "#2C3E50", tileBorder: "#3D5166", accent: "#3B82F6" },
  { id: "frost", label: "frost", background: "linear-gradient(160deg, #667eea 0%, #764ba2 100%)", tileBorder: "rgba(255,255,255,0.12)", accent: "#E879F9" },
  { id: "aurora", label: "aurora", background: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)", tileBorder: "rgba(255,255,255,0.1)", accent: "#34D399" },
] as const;

type CanvasPresetId = (typeof CANVAS_PRESETS)[number]["id"];

type CanvasThemePickerProps = {
  theme: CanvasTheme;
  onThemeChange: (theme: Partial<CanvasTheme>) => void;
  onClose: () => void;
};

export function CanvasThemePicker({ theme, onThemeChange, onClose }: CanvasThemePickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hexInput, setHexInput] = useState(theme.background.startsWith("#") ? theme.background : "#0C0C0C");

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
      backgroundImage: undefined,
      tileBorder: preset.tileBorder,
      accent: preset.accent,
    });
  }

  function handleColorChange(key: keyof Pick<CanvasTheme, "background" | "tileBorder" | "accent">, value: string) {
    onThemeChange({ [key]: value, preset: null, backgroundImage: key === "background" ? undefined : theme.backgroundImage });
  }

  function handleHexSubmit() {
    const cleaned = hexInput.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(cleaned)) {
      onThemeChange({ background: cleaned, preset: null, backgroundImage: undefined });
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onThemeChange({
        backgroundImage: dataUrl,
        preset: null,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function clearBackgroundImage() {
    onThemeChange({ backgroundImage: undefined });
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

      <div className="canvas-theme-picker-section-label">// hex color</div>

      <div className="canvas-theme-hex-row">
        <input
          type="text"
          className="canvas-theme-hex-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleHexSubmit(); }}
          placeholder="#000000"
          spellCheck={false}
          aria-label="Hex color code"
        />
        <button type="button" className="canvas-theme-hex-apply" onClick={handleHexSubmit}>
          Apply
        </button>
      </div>

      <div className="canvas-theme-picker-section-label">// background image</div>

      <div className="canvas-theme-image-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          hidden
          aria-hidden="true"
        />
        <button
          type="button"
          className="canvas-theme-image-upload"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={13} aria-hidden="true" />
          <span>{theme.backgroundImage ? "Change image" : "Upload image"}</span>
        </button>
        {theme.backgroundImage ? (
          <button
            type="button"
            className="canvas-theme-image-clear"
            onClick={clearBackgroundImage}
            aria-label="Remove background image"
          >
            <X size={11} aria-hidden="true" />
            <span>Remove</span>
          </button>
        ) : null}
      </div>

      {theme.backgroundImage ? (
        <div className="canvas-theme-image-preview">
          <img src={theme.backgroundImage} alt="Background preview" />
        </div>
      ) : null}
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
  const isGradient = value.includes("gradient") || value.includes("rgba");
  const colorValue = isGradient ? "#000000" : value;

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
          value={colorValue}
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
        {isGradient ? "gradient" : value.toLowerCase()}
      </span>
    </div>
  );
}
