import { ArrowLeft } from 'lucide-react'
import type { SettingsSection } from './types'

type SettingsNavGroupItem = {
  label: string
  value: SettingsSection
}

type SettingsNavGroupKey = 'orxa' | 'opencode' | 'claude' | 'codex'

type SettingsNavGroupConfig = {
  key: SettingsNavGroupKey
  label: string
  items: SettingsNavGroupItem[]
}

const NAV_GROUPS: SettingsNavGroupConfig[] = [
  {
    key: 'orxa',
    label: 'ORXA CODE',
    items: [
      { label: 'App', value: 'app' },
      { label: 'Appearance', value: 'appearance' },
      { label: 'Preferences', value: 'preferences' },
      { label: 'Git', value: 'git' },
    ],
  },
  {
    key: 'opencode',
    label: 'OPENCODE',
    items: [
      { label: 'Config Files', value: 'config' },
      { label: 'Provider Models', value: 'provider-models' },
      { label: 'Agents', value: 'opencode-agents' },
      { label: 'Personalization', value: 'personalization' },
      { label: 'Server', value: 'server' },
    ],
  },
  {
    key: 'claude',
    label: 'CLAUDE',
    items: [
      { label: 'Config', value: 'claude-config' },
      { label: 'Personalization', value: 'claude-personalization' },
      { label: 'Permissions', value: 'claude-permissions' },
      { label: 'Directories', value: 'claude-dirs' },
    ],
  },
  {
    key: 'codex',
    label: 'CODEX',
    items: [
      { label: 'General', value: 'codex-general' },
      { label: 'Models', value: 'codex-models' },
      { label: 'Access', value: 'codex-access' },
      { label: 'Config', value: 'codex-config' },
      { label: 'Personalization', value: 'codex-personalization' },
      { label: 'Directories', value: 'codex-dirs' },
    ],
  },
]

function SettingsNavItem({
  item,
  activeSection,
  onSelect,
}: {
  item: SettingsNavGroupItem
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}) {
  const isActive = activeSection === item.value

  return (
    <button type="button" className={isActive ? 'active' : ''} onClick={() => onSelect(item.value)}>
      {isActive ? (
        <span className="settings-nav-chevron" aria-hidden="true">
          &gt;
        </span>
      ) : null}
      {item.label}
    </button>
  )
}

function SettingsNavGroup({
  group,
  activeSection,
  collapsedGroups,
  setCollapsedGroups,
  onSelect,
}: {
  group: SettingsNavGroupConfig
  activeSection: SettingsSection
  collapsedGroups: Record<string, boolean>
  setCollapsedGroups: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>
  ) => void
  onSelect: (section: SettingsSection) => void
}) {
  const collapsed = Boolean(collapsedGroups[group.key])

  return (
    <>
      <span
        className={`settings-nav-group-label${collapsed ? ' collapsed' : ''}`}
        onClick={() => setCollapsedGroups(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
      >
        {group.label}
      </span>
      {collapsed
        ? null
        : group.items.map(item => (
            <SettingsNavItem
              key={item.value}
              item={item}
              activeSection={activeSection}
              onSelect={onSelect}
            />
          ))}
    </>
  )
}

export function SettingsDrawerNavigation({
  section,
  onClose,
  setSection,
  collapsedGroups,
  setCollapsedGroups,
}: {
  section: SettingsSection
  onClose: () => void
  setSection: (section: SettingsSection) => void
  collapsedGroups: Record<string, boolean>
  setCollapsedGroups: (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>
  ) => void
}) {
  return (
    <aside className="settings-sidebar-nav">
      <div className="settings-nav-header">
        <button type="button" className="settings-back-button" onClick={onClose}>
          <ArrowLeft size={14} aria-hidden="true" />
          <span>Back to app</span>
        </button>
      </div>
      <div className="settings-nav-list">
        {NAV_GROUPS.map(group => (
          <SettingsNavGroup
            key={group.key}
            group={group}
            activeSection={section}
            collapsedGroups={collapsedGroups}
            setCollapsedGroups={setCollapsedGroups}
            onSelect={setSection}
          />
        ))}
      </div>
    </aside>
  )
}
