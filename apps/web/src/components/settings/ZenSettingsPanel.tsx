import { useCallback } from 'react'
import { useZenMode } from '../../hooks/useZenMode'
import { TOPBAR_BUTTONS, isTopbarButtonId, type TopbarButtonId } from '../chat/topbarButtonRegistry'
import { Checkbox } from '../ui/checkbox'
import { SettingsPageContainer, SettingsRow, SettingsSection } from './settingsLayout'

export function ZenSettingsPanel() {
  const zen = useZenMode()

  const toggleButton = useCallback(
    (id: TopbarButtonId) => {
      const filtered = zen.allowlistArray.filter(isTopbarButtonId)
      const next = zen.allowlist.has(id) ? filtered.filter(x => x !== id) : [...filtered, id]
      zen.setAllowlist(next)
    },
    [zen]
  )

  return (
    <SettingsPageContainer>
      <SettingsSection title="Zen mode">
        <SettingsRow
          title="Zen mode"
          description="Hides sidebars and most of the topbar for a distraction-free workspace. Toggle with ⇧⌘Z or from the main sidebar footer."
          control={
            <Checkbox
              checked={zen.enabled}
              onCheckedChange={checked => {
                if (checked) zen.enterZen()
                else zen.exitZen()
              }}
              aria-label="Zen mode enabled"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Visible in zen">
        {TOPBAR_BUTTONS.map(button => {
          const checked = zen.allowlist.has(button.id)
          return (
            <SettingsRow
              key={button.id}
              title={button.label}
              description={button.description}
              control={
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleButton(button.id)}
                  aria-label={`${button.label} visible in zen`}
                />
              }
            />
          )
        })}
      </SettingsSection>
    </SettingsPageContainer>
  )
}
