import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ModelOption } from '~/lib/models'
import type { AppPreferences } from '~/types/app'

type ProviderGroup = {
  providerID: string
  name: string
  models: { key: string; modelName: string }[]
}

type ProviderModelsSectionProps = {
  allModelOptions: ModelOption[]
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
  collapsedProviders: Record<string, boolean>
  setCollapsedProviders: Dispatch<SetStateAction<Record<string, boolean>>>
}

function ProviderGroupRow({
  group,
  providerID,
  hidden,
  isCollapsed,
  onToggleModel,
  onEnableAll,
  onDisableAll,
  onToggleCollapse,
}: {
  group: ProviderGroup
  providerID: string
  hidden: Set<string>
  isCollapsed: boolean
  onToggleModel: (key: string) => void
  onEnableAll: (keys: string[]) => void
  onDisableAll: (keys: string[]) => void
  onToggleCollapse: (id: string) => void
}) {
  const allKeys = group.models.map(m => m.key)
  const visibleCount = allKeys.filter(k => !hidden.has(k)).length

  return (
    <div key={providerID} className="provider-models-group">
      <div className="provider-models-header">
        <button
          type="button"
          className="provider-models-chevron"
          onClick={() => onToggleCollapse(providerID)}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <strong onClick={() => onToggleCollapse(providerID)} className="provider-models-name">
          {group.name}
        </strong>
        <small>
          {visibleCount}/{allKeys.length} enabled
        </small>
        <button
          type="button"
          className="provider-models-enable-link"
          onClick={() => onEnableAll(allKeys)}
        >
          enable all
        </button>
        <button
          type="button"
          className="provider-models-disable-link"
          onClick={() => onDisableAll(allKeys)}
        >
          disable all
        </button>
      </div>
      {!isCollapsed ? (
        <div className="provider-models-items">
          {group.models.map(m => (
            <label key={m.key} className="provider-models-item">
              <input
                type="checkbox"
                checked={!hidden.has(m.key)}
                onChange={() => onToggleModel(m.key)}
              />
              <span>{m.modelName}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ProviderModelsSection({
  allModelOptions,
  appPreferences,
  onAppPreferencesChange,
  collapsedProviders,
  setCollapsedProviders,
}: ProviderModelsSectionProps) {
  const providerMap = new Map<
    string,
    { name: string; models: { key: string; modelName: string }[] }
  >()
  for (const m of allModelOptions) {
    if (!providerMap.has(m.providerID)) {
      providerMap.set(m.providerID, { name: m.providerName, models: [] })
    }
    providerMap.get(m.providerID)!.models.push({ key: m.key, modelName: m.modelName })
  }
  const providers = [...providerMap.entries()]
  const hidden = new Set(appPreferences.hiddenModels)

  const toggleModel = (key: string) => {
    const next = new Set(hidden)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] })
  }

  const enableAll = (allKeys: string[]) => {
    const next = new Set(hidden)
    for (const k of allKeys) {
      next.delete(k)
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] })
  }

  const disableAll = (allKeys: string[]) => {
    const next = new Set(hidden)
    for (const k of allKeys) {
      next.add(k)
    }
    onAppPreferencesChange({ ...appPreferences, hiddenModels: [...next] })
  }

  const toggleCollapse = (providerID: string) => {
    setCollapsedProviders(prev => ({
      ...prev,
      [providerID]: prev[providerID] === false ? true : false,
    }))
  }

  return (
    <section className="settings-section-card settings-pad">
      <p
        className="raw-path"
        style={{
          marginBottom: 0,
          color: 'var(--text-secondary)',
          fontSize: '13px',
          lineHeight: '1.6',
          fontFamily: 'var(--font-mono)',
        }}
      >
        // toggle which models appear in the model selector. unticked models will be hidden.
      </p>
      <div className="provider-models-list">
        {providers.map(([providerID, group]) => (
          <ProviderGroupRow
            key={providerID}
            group={{ providerID, ...group }}
            providerID={providerID}
            hidden={hidden}
            isCollapsed={collapsedProviders[providerID] !== false}
            onToggleModel={toggleModel}
            onEnableAll={enableAll}
            onDisableAll={disableAll}
            onToggleCollapse={toggleCollapse}
          />
        ))}
      </div>
    </section>
  )
}
