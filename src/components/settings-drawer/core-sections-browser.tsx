import type { AppPreferences } from "~/types/app";

type BrowserSectionProps = {
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
};

export function BrowserSection({ appPreferences, onAppPreferencesChange }: BrowserSectionProps) {
  const enabled = appPreferences.orxaBrowserEnabled ?? true;

  return (
    <section className="settings-section-card settings-pad">
      <p className="settings-preferences-title">Orxa Browser</p>
      <p className="settings-preferences-desc">
        The built-in browser allows agents to navigate web pages, take screenshots, and interact with sites during sessions.
        Disabling it hides the browser toggle in the composer and the browser tab in the sidebar.
      </p>

      <label className="settings-toggle-row">
        <span>Enable Orxa Browser</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`settings-switch${enabled ? " on" : ""}`}
          onClick={() => onAppPreferencesChange({ ...appPreferences, orxaBrowserEnabled: !enabled })}
        >
          <span className="settings-switch-thumb" />
        </button>
      </label>
    </section>
  );
}
