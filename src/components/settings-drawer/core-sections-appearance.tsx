import { ChevronRight } from "lucide-react";
import type { AppPreferences, ThemeId } from "~/types/app";
import { UI_FONT_OPTIONS } from "~/types/app";

type AppearanceSectionProps = {
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
};

type ThemeDescriptor = {
  id: ThemeId;
  label: string;
  description: string;
  swatches: [string, string, string, string];
};

const THEMES: ThemeDescriptor[] = [
  {
    id: "glass",
    label: "Glass",
    description: "Translucent, blurred surfaces",
    swatches: ["#1C2030", "#60A5FA", "#34D399", "#94A3C0"],
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Classic opaque dark",
    swatches: ["#111111", "#3B82F6", "#22C55E", "#A3A3A3"],
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy with purple accents",
    swatches: ["#0B0E1A", "#818CF8", "#34D399", "#9BA4C0"],
  },
  {
    id: "ember",
    label: "Ember",
    description: "Warm dark with amber accents",
    swatches: ["#141110", "#F97316", "#F59E0B", "#B8A899"],
  },
  {
    id: "arctic",
    label: "Arctic",
    description: "Clean light mode",
    swatches: ["#F4F6FA", "#2563EB", "#16A34A", "#4B5068"],
  },
];

export function AppearanceSection({ appPreferences, onAppPreferencesChange }: AppearanceSectionProps) {
  return (
    <section className="settings-section-card settings-pad">
      <p className="settings-preferences-title">appearance</p>

      <p className="settings-preferences-desc">theme</p>
      <div className="settings-theme-grid">
        {THEMES.map((theme) => {
          const isActive = appPreferences.theme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              className={`settings-theme-card${isActive ? " active" : ""}`}
              onClick={() => onAppPreferencesChange({ ...appPreferences, theme: theme.id })}
            >
              <div className="settings-theme-swatch">
                {theme.swatches.map((color, i) => (
                  <span key={i} className="settings-theme-dot" style={{ background: color }} />
                ))}
              </div>
              <div className="settings-theme-info">
                <span className="settings-theme-label">
                  {isActive ? (
                    <ChevronRight size={12} className="settings-font-option-check" style={{ color: "var(--accent-interactive)" }} />
                  ) : null}
                  {theme.label}
                </span>
                <span className="settings-theme-desc">{theme.description}</span>
              </div>
            </button>
          );
        })}
      </div>

      <p className="settings-preferences-desc" style={{ marginTop: 20 }}>
        ui font — used for interface text, labels, and controls.
      </p>
      <select
        className="settings-ui-font-select"
        value={appPreferences.uiFont}
        onChange={(e) => onAppPreferencesChange({ ...appPreferences, uiFont: e.target.value })}
      >
        {UI_FONT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </section>
  );
}
