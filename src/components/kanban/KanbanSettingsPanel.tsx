import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, WandSparkles } from 'lucide-react'
import type { KanbanSettings } from '@shared/ipc'
import { providerLabel } from './kanban-utils'
import { KanbanTaskProviderConfigFields } from './KanbanTaskProviderConfigFields'

type Props = {
  workspaceDir: string
}

export function KanbanSettingsPanel({ workspaceDir }: Props) {
  const [settings, setSettings] = useState<KanbanSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [presetProvider, setPresetProvider] =
    useState<KanbanSettings['defaultProvider']>('opencode')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.orxa.kanban.getSettings(workspaceDir)
      setSettings(next)
    } catch {
      /* ignore */
    }
    setLoading(false)
  }, [workspaceDir])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (settings) {
      setPresetProvider(settings.defaultProvider)
    }
  }, [settings])

  const update = useCallback(
    async (patch: Partial<KanbanSettings>) => {
      if (!settings) return
      try {
        const next = await window.orxa.kanban.updateSettings({ workspaceDir, ...patch })
        setSettings(next)
      } catch {
        /* ignore */
      }
    },
    [workspaceDir, settings]
  )

  if (loading || !settings) {
    return <KanbanSettingsLoadingState />
  }

  return (
    <section className="kanban-settings">
      <KanbanGeneralSettingsSection settings={settings} onUpdate={update} />
      <KanbanProviderDefaultsSection
        presetProvider={presetProvider}
        providerDefaults={settings.providerDefaults}
        setPresetProvider={setPresetProvider}
        workspaceDir={workspaceDir}
        onUpdate={update}
      />
      <KanbanScriptShortcutsSection
        scriptShortcuts={settings.scriptShortcuts}
        onUpdate={update}
      />
      <KanbanWorktreeIncludeSection
        setSettings={setSettings}
        settings={settings}
        workspaceDir={workspaceDir}
        onUpdate={update}
      />
    </section>
  )
}

function KanbanSettingsLoadingState() {
  return (
    <div
      className="kanban-empty-state"
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      Loading settings…
    </div>
  )
}

function KanbanGeneralSettingsSection({
  settings,
  onUpdate,
}: {
  settings: KanbanSettings
  onUpdate: (patch: Partial<KanbanSettings>) => Promise<void>
}) {
  return (
    <div className="kanban-settings-section">
      <h3>General</h3>
      <KanbanToggleRow
        checked={settings.autoCommit}
        label="Auto commit on completion"
        onClick={() => void onUpdate({ autoCommit: !settings.autoCommit })}
      />
      <KanbanToggleRow
        checked={settings.autoPr}
        label="Auto open PR on completion"
        onClick={() => void onUpdate({ autoPr: !settings.autoPr })}
      />
      <div className="kanban-field">
        <span>Default provider</span>
        <ProviderSegmentedControl
          activeProvider={settings.defaultProvider}
          onSelect={provider => void onUpdate({ defaultProvider: provider })}
        />
      </div>
    </div>
  )
}

function KanbanProviderDefaultsSection({
  presetProvider,
  providerDefaults,
  setPresetProvider,
  workspaceDir,
  onUpdate,
}: {
  presetProvider: KanbanSettings['defaultProvider']
  providerDefaults: KanbanSettings['providerDefaults']
  setPresetProvider: (value: KanbanSettings['defaultProvider']) => void
  workspaceDir: string
  onUpdate: (patch: Partial<KanbanSettings>) => Promise<void>
}) {
  return (
    <div className="kanban-settings-section">
      <div className="kanban-settings-section-header">
        <h3>Task provider defaults</h3>
      </div>
      <p className="kanban-settings-help">
        New tasks inherit these provider-specific defaults. You can still override them per task.
      </p>
      <div className="kanban-field">
        <span>Preset provider</span>
        <ProviderSegmentedControl
          activeProvider={presetProvider}
          onSelect={provider => setPresetProvider(provider)}
        />
      </div>
      <KanbanTaskProviderConfigFields
        workspaceDir={workspaceDir}
        provider={presetProvider}
        providerConfig={providerDefaults}
        onChange={nextProviderDefaults => void onUpdate({ providerDefaults: nextProviderDefaults ?? {} })}
      />
    </div>
  )
}

function KanbanScriptShortcutsSection({
  scriptShortcuts,
  onUpdate,
}: {
  scriptShortcuts: KanbanSettings['scriptShortcuts']
  onUpdate: (patch: Partial<KanbanSettings>) => Promise<void>
}) {
  const updateShortcut = (index: number, patch: Partial<KanbanSettings['scriptShortcuts'][number]>) => {
    const next = [...scriptShortcuts]
    next[index] = { ...next[index], ...patch }
    void onUpdate({ scriptShortcuts: next })
  }

  return (
    <div className="kanban-settings-section">
      <div className="kanban-settings-section-header">
        <h3>Script shortcuts</h3>
        <button
          type="button"
          className="kanban-icon-btn"
          title="Add shortcut"
          onClick={() => {
            const id = `sc_${Date.now()}`
            void onUpdate({ scriptShortcuts: [...scriptShortcuts, { id, name: '', command: '' }] })
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {scriptShortcuts.map((shortcut, index) => (
        <div key={shortcut.id} className="kanban-settings-shortcut-row">
          <input
            value={shortcut.name}
            placeholder="Name"
            onChange={e => updateShortcut(index, { name: e.target.value })}
          />
          <input
            value={shortcut.command}
            placeholder="Command"
            onChange={e => updateShortcut(index, { command: e.target.value })}
          />
          <button
            type="button"
            className="kanban-icon-btn"
            title="Remove"
            onClick={() => void onUpdate({ scriptShortcuts: scriptShortcuts.filter(s => s.id !== shortcut.id) })}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {scriptShortcuts.length === 0 ? <div className="kanban-empty-state">No shortcuts configured</div> : null}
    </div>
  )
}

function KanbanWorktreeIncludeSection({
  setSettings,
  settings,
  workspaceDir,
  onUpdate,
}: {
  setSettings: React.Dispatch<React.SetStateAction<KanbanSettings | null>>
  settings: KanbanSettings
  workspaceDir: string
  onUpdate: (patch: Partial<KanbanSettings>) => Promise<void>
}) {
  const { worktreeInclude } = settings
  return (
    <div className="kanban-settings-section">
      <div className="kanban-settings-section-header">
        <h3>.worktreeinclude</h3>
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() =>
            void window.orxa.kanban.createWorktreeIncludeFromGitignore(workspaceDir).then(setSettings)
          }
        >
          <WandSparkles size={12} /> Generate from `.gitignore`
        </button>
      </div>
      <div className="kanban-task-detail-runtime-grid">
        <span>Detected</span>
        <span>{worktreeInclude.detected ? 'Yes' : 'No'}</span>
        <span>Source</span>
        <span>{worktreeInclude.source}</span>
        <span>File</span>
        <span className="kanban-detail-mono">
          {worktreeInclude.filePath || `${workspaceDir}/.worktreeinclude`}
        </span>
      </div>
      <div className="kanban-settings-path-list">
        {worktreeInclude.entries.map((entry, index) => (
          <div key={index} className="kanban-settings-shortcut-row">
            <input
              value={entry}
              placeholder="node_modules"
              onChange={e => {
                const entries = [...worktreeInclude.entries]
                entries[index] = e.target.value
                void onUpdate({ worktreeInclude: { ...worktreeInclude, entries } })
              }}
            />
            <button
              type="button"
              className="kanban-icon-btn"
              title="Remove"
              onClick={() =>
                void onUpdate({
                  worktreeInclude: {
                    ...worktreeInclude,
                    entries: worktreeInclude.entries.filter((_, i) => i !== index),
                  },
                })
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() =>
            void onUpdate({
              worktreeInclude: { ...worktreeInclude, entries: [...worktreeInclude.entries, ''] },
            })
          }
        >
          <Plus size={12} /> Add include
        </button>
        {worktreeInclude.entries.length === 0 ? (
          <div className="kanban-empty-state">No `.worktreeinclude` entries configured</div>
        ) : null}
      </div>
    </div>
  )
}

function KanbanToggleRow({
  checked,
  label,
  onClick,
}: {
  checked: boolean
  label: string
  onClick: () => void
}) {
  return (
    <label className="kanban-toggle-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`kanban-switch${checked ? ' on' : ''}`}
        onClick={onClick}
      >
        <span className="kanban-switch-thumb" />
      </button>
    </label>
  )
}

function ProviderSegmentedControl({
  activeProvider,
  onSelect,
}: {
  activeProvider: 'opencode' | 'codex' | 'claude'
  onSelect: (provider: 'opencode' | 'codex' | 'claude') => void
}) {
  return (
    <div className="kanban-segmented-control">
      {(['opencode', 'codex', 'claude'] as const).map(provider => (
        <button
          key={provider}
          type="button"
          className={activeProvider === provider ? 'active' : ''}
          onClick={() => onSelect(provider)}
        >
          {providerLabel(provider)}
        </button>
      ))}
    </div>
  )
}
