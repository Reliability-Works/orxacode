import { ChevronRight } from 'lucide-react'
import type { AppPreferences } from '~/types/app'
import { CODE_FONT_OPTIONS } from '~/types/app'

type PreferencesSectionProps = {
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
}

export function PreferencesSection({
  appPreferences,
  onAppPreferencesChange,
}: PreferencesSectionProps) {
  return (
    <section className="settings-section-card settings-pad">
      <p className="settings-preferences-title">preferences</p>
      <p className="settings-preferences-desc">
        code font — used in the diff viewer, file tree, and file preview.
      </p>
      <div className="settings-font-list">
        {CODE_FONT_OPTIONS.map(opt => {
          const isSelected = appPreferences.codeFont === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              className={`settings-font-option${isSelected ? ' active' : ''}`}
              onClick={() => onAppPreferencesChange({ ...appPreferences, codeFont: opt.value })}
            >
              <div className="settings-font-option-header">
                {isSelected ? (
                  <ChevronRight
                    size={12}
                    className="settings-font-option-check"
                    style={{ color: 'var(--accent-green)' }}
                  />
                ) : null}
                <span className="settings-font-option-name">{opt.label}</span>
              </div>
              <span className="settings-font-option-preview" style={{ fontFamily: opt.stack }}>
                {`const greet = (name) => \`Hello, \${name}!\`;`}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
