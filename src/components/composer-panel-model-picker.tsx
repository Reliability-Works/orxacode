import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Cpu, Search as SearchIcon } from 'lucide-react'
import type { ModelOption } from '../lib/models'

type ModelPickerProps = {
  modelSelectOptions: ModelOption[]
  selectedModel: string | undefined
  setSelectedModel: (value: string | undefined) => void
  selectedVariant: string | undefined
  setSelectedVariant: (value: string | undefined) => void
  variantOptions: string[]
  variantLabel?: string
  variantEmptyLabel?: string
}

type ModelGroup = { id: string; name: string; models: ModelOption[] }

function buildProviderGroups(modelSelectOptions: ModelOption[], query: string): ModelGroup[] {
  const filtered = query.trim()
    ? modelSelectOptions.filter(
        model =>
          model.modelName.toLowerCase().includes(query.toLowerCase()) ||
          model.providerName.toLowerCase().includes(query.toLowerCase())
      )
    : modelSelectOptions

  const groups = new Map<string, ModelGroup>()
  for (const model of filtered) {
    const existing = groups.get(model.providerID)
    if (existing) {
      existing.models.push(model)
      continue
    }
    groups.set(model.providerID, {
      id: model.providerID,
      name: model.providerName,
      models: [model],
    })
  }
  return [...groups.values()]
}

function ModelPickerOverlay({
  open,
  query,
  setQuery,
  providerGroups,
  selectedModel,
  setSelectedModel,
  onClose,
}: {
  open: boolean
  query: string
  setQuery: (value: string) => void
  providerGroups: ModelGroup[]
  selectedModel: string | undefined
  setSelectedModel: (value: string | undefined) => void
  onClose: () => void
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, open])

  useEffect(() => {
    if (!open) {
      return
    }
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div
      className="model-modal-overlay"
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="model-modal">
        <div className="model-modal-header">
          <h3>Select Model</h3>
          <div className="model-modal-search">
            <SearchIcon size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search models..."
            />
          </div>
          <button type="button" className="model-modal-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="model-modal-body">
          {providerGroups.length === 0 ? (
            <p className="model-picker-empty">No models found</p>
          ) : (
            <div className="model-modal-columns">
              {providerGroups.map(group => (
                <div key={group.id} className="model-modal-column">
                  <div className="model-modal-provider">{group.name}</div>
                  {group.models.map(model => (
                    <button
                      key={model.key}
                      type="button"
                      className={`model-modal-item${selectedModel === model.key ? ' active' : ''}`}
                      onClick={() => setSelectedModel(model.key)}
                    >
                      {selectedModel === model.key ? <Check size={12} aria-hidden="true" /> : null}
                      <span>{model.modelName}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function ModelPicker({
  modelSelectOptions,
  selectedModel,
  setSelectedModel,
  selectedVariant,
  setSelectedVariant,
  variantOptions,
  variantLabel,
  variantEmptyLabel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedOption = useMemo(
    () => modelSelectOptions.find(model => model.key === selectedModel),
    [modelSelectOptions, selectedModel]
  )
  const providerGroups = useMemo(
    () => buildProviderGroups(modelSelectOptions, query),
    [modelSelectOptions, query]
  )
  const displayLabel = selectedOption
    ? `${selectedOption.providerName}/${selectedOption.modelName}`
    : 'Select model'
  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  return (
    <div className="model-picker-wrap">
      <button
        type="button"
        className="composer-select composer-model-btn"
        onClick={() => setOpen(value => !value)}
        aria-label="Select model"
        title={displayLabel}
      >
        <Cpu size={11} aria-hidden="true" />
        <span className="composer-pill-label">{displayLabel}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {variantOptions.length > 0 ? (
        <select
          className="composer-select composer-variant-select"
          aria-label={variantLabel ?? 'Variant'}
          value={selectedVariant ?? ''}
          onChange={event => setSelectedVariant(event.target.value || undefined)}
        >
          <option value="">{variantEmptyLabel ?? '(default)'}</option>
          {variantOptions.map(variant => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      ) : null}

      <ModelPickerOverlay
        open={open}
        query={query}
        setQuery={setQuery}
        providerGroups={providerGroups}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        onClose={close}
      />
    </div>
  )
}
