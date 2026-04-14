import {
  DEFAULT_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderKind,
} from '@orxa-code/contracts'
import { ChevronDownIcon, InfoIcon } from 'lucide-react'
import { forwardRef, Fragment, useEffect, useMemo, useState } from 'react'

import {
  groupOpencodeModelsBySubprovider,
  stripOpencodeSubproviderPrefix,
} from '../../opencodeModelGroups'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../ui/dialog'
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from '../ui/menu'
import { Textarea } from '../ui/textarea'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { useOpencodePrimaryAgents } from './useOpencodePrimaryAgents'

export type HandoffProviderModelOption = { slug: string; name: string }

export interface HandoffDialogProps {
  open: boolean
  targetProvider: ProviderKind | null
  isSubmitting: boolean
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<HandoffProviderModelOption>>
  projectDefaultModelSelection: ModelSelection | null
  onCancel: () => void
  onConfirm: (args: { appendedPrompt: string | null; modelSelection: ModelSelection }) => void
}

function HandoffGuidanceLabel({ providerName }: { providerName: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="font-medium text-xs">Additional guidance (optional)</p>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="About additional guidance"
              className="inline-flex size-3.5 items-center justify-center text-muted-foreground hover:text-foreground"
            />
          }
        >
          <InfoIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup className="max-w-xs">
          <p className="px-1 py-0.5">
            Use this to tell {providerName || 'the target provider'} what their exact task is,
            unless it's already clear from the transcript messages.
          </p>
        </TooltipPopup>
      </Tooltip>
    </div>
  )
}

function resolveInitialModel(
  targetProvider: ProviderKind | null,
  projectDefault: ModelSelection | null,
  modelOptions: ReadonlyArray<HandoffProviderModelOption>
): string | null {
  if (!targetProvider) return null
  if (projectDefault && projectDefault.provider === targetProvider) {
    return projectDefault.model
  }
  const defaultSlug = DEFAULT_MODEL_BY_PROVIDER[targetProvider]
  if (modelOptions.some(o => o.slug === defaultSlug)) return defaultSlug
  return modelOptions[0]?.slug ?? defaultSlug
}

type ModelPickerTriggerProps = React.ComponentProps<typeof Button> & {
  label: string
}

const ModelPickerTrigger = forwardRef<HTMLButtonElement, ModelPickerTriggerProps>(
  function ModelPickerTrigger({ label, disabled, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        className="w-full justify-between"
        {...rest}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
      </Button>
    )
  }
)

function HandoffModelPicker(props: {
  targetProvider: ProviderKind
  modelOptions: ReadonlyArray<HandoffProviderModelOption>
  value: string | null
  onChange: (value: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = useMemo(() => {
    const match = props.modelOptions.find(o => o.slug === props.value)
    const raw = match?.name ?? props.value ?? 'Select model'
    return props.targetProvider === 'opencode' ? stripOpencodeSubproviderPrefix(raw) : raw
  }, [props.modelOptions, props.value, props.targetProvider])

  const groups = useMemo(
    () =>
      props.targetProvider === 'opencode'
        ? groupOpencodeModelsBySubprovider(props.modelOptions)
        : null,
    [props.modelOptions, props.targetProvider]
  )

  return (
    <div className="space-y-1">
      <p className="font-medium text-xs">Model</p>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={<ModelPickerTrigger label={selectedLabel} disabled={props.disabled} />}
        />
        <MenuPopup align="start" className="max-h-[min(24rem,60vh)]">
          {groups ? (
            groups.map((group, index) => (
              <Fragment key={group.providerId}>
                {index > 0 && <MenuDivider />}
                <MenuGroup>
                  <div className="px-2 pt-1.5 pb-1 font-medium text-caption text-muted-foreground/80 uppercase tracking-wide">
                    {group.label}
                  </div>
                  <MenuRadioGroup
                    value={props.value ?? ''}
                    onValueChange={value => {
                      props.onChange(value)
                      setOpen(false)
                    }}
                  >
                    {group.options.map(option => (
                      <MenuRadioItem key={option.slug} value={option.slug}>
                        {option.name}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </Fragment>
            ))
          ) : (
            <MenuRadioGroup
              value={props.value ?? ''}
              onValueChange={value => {
                props.onChange(value)
                setOpen(false)
              }}
            >
              {props.modelOptions.map(option => (
                <MenuRadioItem key={option.slug} value={option.slug}>
                  {option.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          )}
        </MenuPopup>
      </Menu>
    </div>
  )
}

function HandoffOpencodeAgentPicker(props: {
  value: string | null
  onChange: (value: string | null) => void
  disabled: boolean
}) {
  const { agents, isLoading } = useOpencodePrimaryAgents(true)
  const [open, setOpen] = useState(false)
  const usableAgents = useMemo(() => agents.filter(a => a.name.toLowerCase() !== 'plan'), [agents])
  const selected = usableAgents.find(a => a.id === props.value)
  const label = selected?.name ?? (isLoading ? 'Loading…' : 'Default')

  return (
    <div className="space-y-1">
      <p className="font-medium text-xs">Primary agent</p>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={<ModelPickerTrigger label={label} disabled={props.disabled || isLoading} />}
        />
        <MenuPopup align="start" className="max-h-[min(24rem,60vh)]">
          <MenuRadioGroup
            value={props.value ?? ''}
            onValueChange={value => {
              props.onChange(value.length > 0 ? value : null)
              setOpen(false)
            }}
          >
            <MenuRadioItem value="">Default</MenuRadioItem>
            {usableAgents.map(agent => (
              <MenuRadioItem key={agent.id} value={agent.id}>
                {agent.name}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    </div>
  )
}

function buildModelSelection(
  targetProvider: ProviderKind,
  model: string,
  agentId: string | null
): ModelSelection {
  if (targetProvider === 'opencode') {
    return {
      provider: 'opencode',
      model,
      ...(agentId ? { agentId } : {}),
    }
  }
  if (targetProvider === 'claudeAgent') {
    return { provider: 'claudeAgent', model }
  }
  return { provider: 'codex', model }
}

function HandoffDialogBody(props: {
  targetProvider: ProviderKind
  providerName: string
  modelOptions: ReadonlyArray<HandoffProviderModelOption>
  selectedModel: string | null
  selectedAgentId: string | null
  prompt: string
  isSubmitting: boolean
  onModelChange: (value: string) => void
  onAgentChange: (value: string | null) => void
  onPromptChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <DialogPanel className="space-y-3">
      <HandoffModelPicker
        targetProvider={props.targetProvider}
        modelOptions={props.modelOptions}
        value={props.selectedModel}
        onChange={props.onModelChange}
        disabled={props.isSubmitting}
      />
      {props.targetProvider === 'opencode' && (
        <HandoffOpencodeAgentPicker
          value={props.selectedAgentId}
          onChange={props.onAgentChange}
          disabled={props.isSubmitting}
        />
      )}
      <div className="space-y-1">
        <HandoffGuidanceLabel providerName={props.providerName} />
        <Textarea
          value={props.prompt}
          onChange={event => props.onPromptChange(event.target.value)}
          placeholder={`e.g. "Continue implementing the diff summary feature — focus on the server-side endpoint, not the UI."`}
          size="sm"
          disabled={props.isSubmitting}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              props.onSubmit()
            }
          }}
        />
      </div>
    </DialogPanel>
  )
}

function useHandoffDialogState(
  open: boolean,
  targetProvider: ProviderKind | null,
  projectDefault: ModelSelection | null,
  modelOptions: ReadonlyArray<HandoffProviderModelOption>
) {
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  useEffect(() => {
    if (open && targetProvider) {
      setPrompt('')
      setSelectedModel(resolveInitialModel(targetProvider, projectDefault, modelOptions))
      const defaultAgent =
        projectDefault?.provider === 'opencode' ? (projectDefault.agentId ?? null) : null
      setSelectedAgentId(targetProvider === 'opencode' ? defaultAgent : null)
    }
  }, [open, targetProvider, modelOptions, projectDefault])

  return {
    prompt,
    setPrompt,
    selectedModel,
    setSelectedModel,
    selectedAgentId,
    setSelectedAgentId,
  }
}

export function HandoffDialog(props: HandoffDialogProps) {
  const { open, targetProvider, isSubmitting, onCancel, onConfirm } = props
  const modelOptions = useMemo(
    () => (targetProvider ? (props.modelOptionsByProvider[targetProvider] ?? []) : []),
    [props.modelOptionsByProvider, targetProvider]
  )
  const state = useHandoffDialogState(
    open,
    targetProvider,
    props.projectDefaultModelSelection,
    modelOptions
  )
  const providerName = targetProvider ? PROVIDER_DISPLAY_NAMES[targetProvider] : ''

  function handleConfirm() {
    if (!targetProvider || !state.selectedModel) return
    const trimmed = state.prompt.trim()
    onConfirm({
      appendedPrompt: trimmed.length > 0 ? trimmed : null,
      modelSelection: buildModelSelection(
        targetProvider,
        state.selectedModel,
        state.selectedAgentId
      ),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !isSubmitting) onCancel()
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Hand off to {providerName}</DialogTitle>
          <DialogDescription>
            The transcript and thread context will be imported automatically. Pick the model (and
            agent for opencode) that {providerName || 'the target provider'} should use, then add
            optional guidance below.
          </DialogDescription>
        </DialogHeader>
        {targetProvider && (
          <HandoffDialogBody
            targetProvider={targetProvider}
            providerName={providerName}
            modelOptions={modelOptions}
            selectedModel={state.selectedModel}
            selectedAgentId={state.selectedAgentId}
            prompt={state.prompt}
            isSubmitting={isSubmitting}
            onModelChange={state.setSelectedModel}
            onAgentChange={state.setSelectedAgentId}
            onPromptChange={state.setPrompt}
            onSubmit={handleConfirm}
          />
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={isSubmitting || !targetProvider || !state.selectedModel}
          >
            {isSubmitting ? 'Starting...' : `Hand off to ${providerName}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
