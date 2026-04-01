import type { AppPreferences } from '~/types/app'

type GitSettingsSectionProps = {
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
}

export function GitSettingsSection({
  appPreferences,
  onAppPreferencesChange,
}: GitSettingsSectionProps) {
  return (
    <section className="settings-section-card settings-pad">
      <p className="settings-git-textarea-label">commit message guidance prompt</p>
      <textarea
        className="settings-git-textarea"
        value={appPreferences.commitGuidancePrompt}
        onChange={event =>
          onAppPreferencesChange({ ...appPreferences, commitGuidancePrompt: event.target.value })
        }
      />
      <label className="settings-update-channel" style={{ marginTop: '16px' }}>
        git command agent
        <select
          value={appPreferences.gitAgent}
          onChange={event =>
            onAppPreferencesChange({
              ...appPreferences,
              gitAgent: event.target.value as 'opencode' | 'claude' | 'codex',
            })
          }
        >
          <option value="opencode">opencode</option>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>
      <p className="settings-codex-help">
        // which ai agent handles git commits, pushes, and PR creation
      </p>
    </section>
  )
}
