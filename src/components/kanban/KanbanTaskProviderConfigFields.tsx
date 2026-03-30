import { useEffect, useMemo, useState, useCallback } from 'react'
import type { Agent } from '@opencode-ai/sdk/v2/client'
import type {
  ClaudeChatModelEntry,
  CodexModelEntry,
  KanbanProvider,
  KanbanTaskProviderConfig,
} from '@shared/ipc'
import { listAgentOptions, listModelOptions, type ModelOption } from '../../lib/models'
import { KanbanDropdown } from './KanbanDropdown'

type Props = {
  workspaceDir: string
  provider: KanbanProvider
  providerConfig: KanbanTaskProviderConfig | undefined
  onChange: (next: KanbanTaskProviderConfig | undefined) => void
}

function normalizeProviderConfig(config: KanbanTaskProviderConfig | undefined) {
  if (!config) {
    return undefined
  }
  const next: KanbanTaskProviderConfig = {}
  if (
    config.opencode &&
    (config.opencode.agent || config.opencode.model || config.opencode.variant)
  ) {
    next.opencode = config.opencode
  }
  if (config.codex && (config.codex.model || config.codex.reasoningEffort)) {
    next.codex = config.codex
  }
  if (config.claude && (config.claude.model || config.claude.effort)) {
    next.claude = config.claude
  }
  return Object.keys(next).length > 0 ? next : undefined
}

// Sub-component: OpenCode provider config
function OpenCodeConfigFields({
  providerConfig,
  opencodeModels,
  opencodeAgents,
  onUpdate,
}: {
  providerConfig: KanbanTaskProviderConfig | undefined
  opencodeModels: ModelOption[]
  opencodeAgents: ReturnType<typeof listAgentOptions>
  onUpdate: (next: KanbanTaskProviderConfig) => void
}) {
  const selectedKey = providerConfig?.opencode?.model
    ? `${providerConfig.opencode.model.providerID}/${providerConfig.opencode.model.modelID}`
    : ''
  const selectedModel = useMemo(
    () => opencodeModels.find(entry => entry.key === selectedKey),
    [opencodeModels, selectedKey]
  )

  return (
    <div className="kanban-provider-config-grid">
      <div className="kanban-field">
        <span>Primary agent</span>
        <KanbanDropdown
          value={providerConfig?.opencode?.agent ?? ''}
          options={[
            { value: '', label: 'Default agent' },
            ...opencodeAgents.map(agent => ({ value: agent.name, label: agent.name })),
          ]}
          onChange={agent => {
            onUpdate({
              ...providerConfig,
              opencode: {
                ...providerConfig?.opencode,
                agent: agent || undefined,
              },
            })
          }}
        />
      </div>
      <div className="kanban-field">
        <span>Model</span>
        <KanbanDropdown
          value={selectedKey}
          options={[
            { value: '', label: 'Default model' },
            ...opencodeModels.map(model => ({
              value: model.key,
              label: `${model.providerName} / ${model.modelName}`,
            })),
          ]}
          onChange={value => {
            const model = opencodeModels.find(entry => entry.key === value)
            onUpdate({
              ...providerConfig,
              opencode: {
                ...providerConfig?.opencode,
                model: model
                  ? { providerID: model.providerID, modelID: model.modelID }
                  : undefined,
                variant: model?.variants.includes(providerConfig?.opencode?.variant ?? '')
                  ? providerConfig?.opencode?.variant
                  : undefined,
              },
            })
          }}
        />
      </div>
      {selectedModel?.variants.length ? (
        <div className="kanban-field">
          <span>Variant</span>
          <KanbanDropdown
            value={providerConfig?.opencode?.variant ?? ''}
            options={[
              { value: '', label: 'Default variant' },
              ...selectedModel.variants.map(variant => ({
                value: variant,
                label: variant,
              })),
            ]}
            onChange={variant => {
              onUpdate({
                ...providerConfig,
                opencode: {
                  ...providerConfig?.opencode,
                  variant: variant || undefined,
                },
              })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

// Sub-component: Codex provider config
function CodexConfigFields({
  providerConfig,
  codexModels,
  onUpdate,
}: {
  providerConfig: KanbanTaskProviderConfig | undefined
  codexModels: CodexModelEntry[]
  onUpdate: (next: KanbanTaskProviderConfig) => void
}) {
  const selectedModel = useMemo(
    () =>
      codexModels.find(
        entry =>
          entry.model === providerConfig?.codex?.model ||
          entry.id === providerConfig?.codex?.model
      ),
    [codexModels, providerConfig?.codex?.model]
  )

  return (
    <div className="kanban-provider-config-grid">
      <div className="kanban-field">
        <span>Model</span>
        <KanbanDropdown
          value={providerConfig?.codex?.model ?? ''}
          options={[
            { value: '', label: 'Default model' },
            ...codexModels.map(model => ({ value: model.model || model.id, label: model.name })),
          ]}
          onChange={model => {
            const selected = codexModels.find(entry => (entry.model || entry.id) === model)
            onUpdate({
              ...providerConfig,
              codex: {
                ...providerConfig?.codex,
                model: model || undefined,
                reasoningEffort: selected?.supportedReasoningEfforts.includes(
                  providerConfig?.codex?.reasoningEffort ?? ''
                )
                  ? providerConfig?.codex?.reasoningEffort
                  : (selected?.defaultReasoningEffort ?? undefined),
              },
            })
          }}
        />
      </div>
      <div className="kanban-field">
        <span>Reasoning</span>
        <KanbanDropdown
          value={providerConfig?.codex?.reasoningEffort ?? ''}
          options={[
            { value: '', label: 'Default reasoning' },
            ...(selectedModel?.supportedReasoningEfforts ?? []).map(effort => ({
              value: effort,
              label: effort,
            })),
          ]}
          onChange={reasoningEffort => {
            onUpdate({
              ...providerConfig,
              codex: {
                ...providerConfig?.codex,
                model: providerConfig?.codex?.model,
                reasoningEffort: reasoningEffort || undefined,
              },
            })
          }}
        />
      </div>
    </div>
  )
}

// Sub-component: Claude provider config
function ClaudeConfigFields({
  providerConfig,
  claudeModels,
  onUpdate,
}: {
  providerConfig: KanbanTaskProviderConfig | undefined
  claudeModels: ClaudeChatModelEntry[]
  onUpdate: (next: KanbanTaskProviderConfig) => void
}) {
  const selectedModel = useMemo(
    () => claudeModels.find(entry => entry.id === providerConfig?.claude?.model),
    [claudeModels, providerConfig?.claude?.model]
  )

  return (
    <div className="kanban-provider-config-grid">
      <div className="kanban-field">
        <span>Model</span>
        <KanbanDropdown
          value={providerConfig?.claude?.model ?? ''}
          options={[
            { value: '', label: 'Default model' },
            ...claudeModels.map(model => ({ value: model.id, label: model.name })),
          ]}
          onChange={model => {
            const selected = claudeModels.find(entry => entry.id === model)
            onUpdate({
              ...providerConfig,
              claude: {
                ...providerConfig?.claude,
                model: model || undefined,
                effort: selected?.supportedReasoningEfforts.includes(
                  providerConfig?.claude?.effort ?? 'medium'
                )
                  ? providerConfig?.claude?.effort
                  : (selected?.defaultReasoningEffort ?? undefined),
              },
            })
          }}
        />
      </div>
      <div className="kanban-field">
        <span>Reasoning</span>
        <KanbanDropdown
          value={providerConfig?.claude?.effort ?? ''}
          options={[
            { value: '', label: 'Default reasoning' },
            ...(selectedModel?.supportedReasoningEfforts ?? []).map(effort => ({
              value: effort,
              label: effort,
            })),
          ]}
          onChange={effort => {
            onUpdate({
              ...providerConfig,
              claude: {
                ...providerConfig?.claude,
                model: providerConfig?.claude?.model,
                effort: effort || undefined,
              },
            })
          }}
        />
      </div>
    </div>
  )
}

export function KanbanTaskProviderConfigFields({
  workspaceDir,
  provider,
  providerConfig,
  onChange,
}: Props) {
  const [opencodeModels, setOpencodeModels] = useState<ModelOption[]>([])
  const [opencodeAgents, setOpencodeAgents] = useState<ReturnType<typeof listAgentOptions>>([])
  const [codexModels, setCodexModels] = useState<CodexModelEntry[]>([])
  const [claudeModels, setClaudeModels] = useState<ClaudeChatModelEntry[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (provider === 'opencode') {
        const [providers, agents] = await Promise.all([
          window.orxa.opencode.listProviders(workspaceDir).catch(() => null),
          window.orxa.opencode.listAgents(workspaceDir).catch(() => [] as Agent[]),
        ])
        if (cancelled) return
        setOpencodeModels(providers ? listModelOptions(providers) : [])
        setOpencodeAgents(listAgentOptions(agents))
        return
      }
      if (provider === 'codex') {
        const models = await window.orxa.codex.listModels().catch(() => [] as CodexModelEntry[])
        if (cancelled) return
        setCodexModels(models)
        return
      }
      const models = await window.orxa.claudeChat
        .listModels()
        .catch(() => [] as ClaudeChatModelEntry[])
      if (cancelled) return
      setClaudeModels(models)
    })()
    return () => {
      cancelled = true
    }
  }, [provider, workspaceDir])

  const updateConfig = useCallback(
    (next: KanbanTaskProviderConfig) => {
      onChange(normalizeProviderConfig(next))
    },
    [onChange]
  )

  if (provider === 'opencode') {
    return (
      <OpenCodeConfigFields
        providerConfig={providerConfig}
        opencodeModels={opencodeModels}
        opencodeAgents={opencodeAgents}
        onUpdate={updateConfig}
      />
    )
  }

  if (provider === 'codex') {
    return (
      <CodexConfigFields
        providerConfig={providerConfig}
        codexModels={codexModels}
        onUpdate={updateConfig}
      />
    )
  }

  return (
    <ClaudeConfigFields
      providerConfig={providerConfig}
      claudeModels={claudeModels}
      onUpdate={updateConfig}
    />
  )
}
