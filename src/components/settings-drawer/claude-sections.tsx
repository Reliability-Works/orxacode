import type { AppPreferences } from "~/types/app";

type ClaudeConfigSectionProps = {
  claudeLoading: boolean;
  claudeSettingsJson: string;
  setClaudeSettingsJson: (value: string) => void;
  setFeedback: (message: string) => void;
};

export function ClaudeConfigSection({
  claudeLoading,
  claudeSettingsJson,
  setClaudeSettingsJson,
  setFeedback,
}: ClaudeConfigSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">claude / config</p>

      <p className="settings-server-subtitle">// settings.json</p>
      <p className="raw-path">~/.claude/settings.json</p>
      {claudeLoading ? (
        <p className="settings-memory-desc">loading...</p>
      ) : (
        <textarea
          className="settings-personalization-textarea"
          value={claudeSettingsJson}
          onChange={(e) => setClaudeSettingsJson(e.target.value)}
          placeholder="(file not found or empty)"
          style={{ minHeight: "160px" }}
        />
      )}
      <div className="settings-codex-field-row">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app.writeTextFile("~/.claude/settings.json", claudeSettingsJson)
              .then(() => setFeedback("settings.json saved"))
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
          }}
        >
          save
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app.readTextFile("~/.claude/settings.json")
              .then((content) => { setClaudeSettingsJson(content); setFeedback("settings.json refreshed"); })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
          }}
        >
          refresh
        </button>
      </div>
    </section>
  );
}

type ClaudePersonalizationSectionProps = {
  claudeLoading: boolean;
  claudeMd: string;
  setClaudeMd: (value: string) => void;
  setFeedback: (message: string) => void;
};

export function ClaudePersonalizationSection({
  claudeLoading,
  claudeMd,
  setClaudeMd,
  setFeedback,
}: ClaudePersonalizationSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">claude / personalization</p>

      <p className="settings-server-subtitle">// global instructions (CLAUDE.md)</p>
      <p className="raw-path">~/.claude/CLAUDE.md</p>
      {claudeLoading ? (
        <p className="settings-memory-desc">loading...</p>
      ) : (
        <textarea
          className="settings-personalization-textarea"
          value={claudeMd}
          onChange={(e) => setClaudeMd(e.target.value)}
          placeholder="(file not found or empty)"
          style={{ minHeight: "280px" }}
        />
      )}
      <div className="settings-codex-field-row">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app.writeTextFile("~/.claude/CLAUDE.md", claudeMd)
              .then(() => setFeedback("CLAUDE.md saved"))
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
          }}
        >
          save
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app.readTextFile("~/.claude/CLAUDE.md")
              .then((content) => { setClaudeMd(content); setFeedback("CLAUDE.md refreshed"); })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
          }}
        >
          refresh
        </button>
      </div>
    </section>
  );
}

type ClaudePermissionsSectionProps = {
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
};

export function ClaudePermissionsSection({
  appPreferences,
  onAppPreferencesChange,
}: ClaudePermissionsSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">claude / permissions</p>

      <p className="settings-server-subtitle">// default permission mode</p>
      <div className="settings-server-status-card">
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">default permission mode</span>
          <span className="settings-server-status-value">{appPreferences.permissionMode ?? "ask-write"}</span>
        </div>
      </div>

      <p className="settings-server-subtitle" style={{ marginTop: "16px" }}>// permission mode</p>
      <select
        className="settings-codex-input"
        value={appPreferences.permissionMode}
        onChange={(e) =>
          onAppPreferencesChange({ ...appPreferences, permissionMode: e.target.value as "ask-write" | "yolo-write" })
        }
      >
        <option value="ask-write">ask-write (prompt before writing)</option>
        <option value="yolo-write">yolo-write (auto-approve writes)</option>
      </select>
    </section>
  );
}

export function ClaudeDirsSection() {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">claude / directories</p>

      <p className="settings-server-subtitle">// claude directories</p>
      <div className="settings-claude-dirs">
        <div className="settings-dir-row">
          <span className="settings-server-status-key">~/.claude/agents/</span>
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void window.orxa.app.revealInFinder("~/.claude/agents")}
          >
            open in finder
          </button>
        </div>
        <div className="settings-dir-row">
          <span className="settings-server-status-key">~/.claude/skills/</span>
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void window.orxa.app.revealInFinder("~/.claude/skills")}
          >
            open in finder
          </button>
        </div>
        <div className="settings-dir-row">
          <span className="settings-server-status-key">~/.claude/plugins/</span>
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void window.orxa.app.revealInFinder("~/.claude/plugins")}
          >
            open in finder
          </button>
        </div>
      </div>
    </section>
  );
}
