import type { ReactNode } from 'react'
import { SettingsDrawerNavigation } from './navigation'
import type { SettingsSection } from './types'

export function SettingsDrawerLayout({
  section,
  onClose,
  setSection,
  collapsedGroups,
  setCollapsedGroups,
  feedback,
  children,
}: {
  section: SettingsSection
  onClose: () => void
  setSection: (section: SettingsSection) => void
  collapsedGroups: Record<string, boolean>
  setCollapsedGroups: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>
  ) => void
  feedback: string | null
  children: ReactNode
}) {
  return (
    <div className="settings-overlay">
      <section className="settings-center">
        <div className="settings-layout">
          <SettingsDrawerNavigation
            section={section}
            onClose={onClose}
            setSection={setSection}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
          />
          <div className="settings-center-body">
            {children}
            {feedback ? <p className="settings-feedback-inline">{feedback}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
