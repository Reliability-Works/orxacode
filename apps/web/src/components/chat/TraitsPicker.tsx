import {
  type ClaudeModelOptions,
  type CodexModelOptions,
  type ProviderKind,
  type ProviderModelOptions,
  type ServerProviderModel,
  type ThreadId,
} from '@orxa-code/contracts'
import {
  applyClaudePromptEffortPrefix,
  isClaudeUltrathinkPrompt,
  trimOrNull,
  getDefaultEffort,
  getDefaultContextWindow,
  hasContextWindowOption,
  resolveEffort,
} from '@orxa-code/shared/model'
import { memo, useCallback, useState } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { buttonVariants } from '../ui/buttonVariants'
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from '../ui/menu'
import { useComposerDraftStore } from '../../composerDraftStore'
import { getProviderModelCapabilities } from '../../providerModels'
import { cn } from '~/lib/utils'

type ProviderOptions = ProviderModelOptions[ProviderKind]
type TraitsPersistence =
  | {
      threadId: ThreadId
      onModelOptionsChange?: never
    }
  | {
      threadId?: undefined
      onModelOptionsChange: (nextOptions: ProviderOptions | undefined) => void
    }

const ULTRATHINK_PROMPT_PREFIX = 'Ultrathink:\n'
type SelectedTraits = ReturnType<typeof getSelectedTraits>

function getRawEffort(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined
): string | null {
  if (provider === 'codex') {
    return trimOrNull((modelOptions as CodexModelOptions | undefined)?.reasoningEffort)
  }
  return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.effort)
}

function getRawContextWindow(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined
): string | null {
  if (provider === 'claudeAgent') {
    return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.contextWindow)
  }
  return null
}

function buildNextOptions(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>
): ProviderOptions {
  if (provider === 'codex') {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions
}

function getSelectedTraits(
  provider: ProviderKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean
) {
  const caps = getProviderModelCapabilities(models, model, provider)
  const effortLevels = allowPromptInjectedEffort
    ? caps.reasoningEffortLevels
    : caps.reasoningEffortLevels.filter(
        option => !caps.promptInjectedEffortLevels.includes(option.value)
      )

  // Resolve effort from options (provider-specific key)
  const rawEffort = getRawEffort(provider, modelOptions)
  const effort = resolveEffort(caps, rawEffort) ?? null

  // Thinking toggle (only for models that support it)
  const thinkingEnabled = caps.supportsThinkingToggle
    ? ((modelOptions as ClaudeModelOptions | undefined)?.thinking ?? true)
    : null

  // Fast mode
  const fastModeEnabled =
    caps.supportsFastMode && (modelOptions as { fastMode?: boolean } | undefined)?.fastMode === true

  // Context window
  const contextWindowOptions = caps.contextWindowOptions
  const rawContextWindow = getRawContextWindow(provider, modelOptions)
  const defaultContextWindow = getDefaultContextWindow(caps)
  const contextWindow =
    rawContextWindow && hasContextWindowOption(caps, rawContextWindow)
      ? rawContextWindow
      : defaultContextWindow

  // Prompt-controlled effort (e.g. ultrathink in prompt text)
  const ultrathinkPromptControlled =
    allowPromptInjectedEffort &&
    caps.promptInjectedEffortLevels.length > 0 &&
    isClaudeUltrathinkPrompt(prompt)

  // Check if "ultrathink" appears in the body text (not just our prefix)
  const ultrathinkInBodyText =
    ultrathinkPromptControlled && isClaudeUltrathinkPrompt(prompt.replace(/^Ultrathink:\s*/i, ''))

  return {
    caps,
    effort,
    effortLevels,
    thinkingEnabled,
    fastModeEnabled,
    contextWindowOptions,
    contextWindow,
    defaultContextWindow,
    ultrathinkPromptControlled,
    ultrathinkInBodyText,
  }
}

export interface TraitsMenuContentProps {
  provider: ProviderKind
  models: ReadonlyArray<ServerProviderModel>
  model: string | null | undefined
  prompt: string
  onPromptChange: (prompt: string) => void
  modelOptions?: ProviderOptions | null | undefined
  allowPromptInjectedEffort?: boolean
  triggerVariant?: VariantProps<typeof buttonVariants>['variant']
  triggerClassName?: string
}

function useTraitsModelOptionsUpdater(persistence: TraitsPersistence, provider: ProviderKind) {
  const setProviderModelOptions = useComposerDraftStore(store => store.setProviderModelOptions)
  return useCallback(
    (nextOptions: ProviderOptions | undefined) => {
      if ('onModelOptionsChange' in persistence) {
        persistence.onModelOptionsChange(nextOptions)
        return
      }
      setProviderModelOptions(persistence.threadId, provider, nextOptions, { persistSticky: true })
    },
    [persistence, provider, setProviderModelOptions]
  )
}

interface TraitsSectionProps {
  provider: ProviderKind
  prompt: string
  onPromptChange: (prompt: string) => void
  modelOptions?: ProviderOptions | null | undefined
  updateModelOptions: (nextOptions: ProviderOptions | undefined) => void
  traits: SelectedTraits
}

function TraitsEffortSection(props: TraitsSectionProps) {
  const {
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    updateModelOptions,
    traits: { caps, effort, effortLevels, ultrathinkInBodyText, ultrathinkPromptControlled },
  } = props
  if (!effort) {
    return null
  }

  const defaultEffort = getDefaultEffort(caps)
  const handleEffortChange = (value: string) => {
    if (!value) return
    const nextOption = effortLevels.find(option => option.value === value)
    if (!nextOption) return
    if (caps.promptInjectedEffortLevels.includes(nextOption.value)) {
      const nextPrompt =
        prompt.trim().length === 0
          ? ULTRATHINK_PROMPT_PREFIX
          : applyClaudePromptEffortPrefix(prompt, 'ultrathink')
      onPromptChange(nextPrompt)
      return
    }
    if (ultrathinkInBodyText) return
    if (ultrathinkPromptControlled) {
      onPromptChange(prompt.replace(/^Ultrathink:\s*/i, ''))
    }
    const effortKey = provider === 'codex' ? 'reasoningEffort' : 'effort'
    updateModelOptions(buildNextOptions(provider, modelOptions, { [effortKey]: nextOption.value }))
  }

  return (
    <MenuGroup>
      <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Effort</div>
      {ultrathinkInBodyText ? (
        <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
          Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change effort.
        </div>
      ) : null}
      <MenuRadioGroup
        value={ultrathinkPromptControlled ? 'ultrathink' : effort}
        onValueChange={handleEffortChange}
      >
        {effortLevels.map(option => (
          <MenuRadioItem key={option.value} value={option.value} disabled={ultrathinkInBodyText}>
            {option.label}
            {option.value === defaultEffort ? ' (default)' : ''}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuGroup>
  )
}

function TraitsThinkingSection(props: {
  provider: ProviderKind
  modelOptions?: ProviderOptions | null | undefined
  updateModelOptions: (nextOptions: ProviderOptions | undefined) => void
  thinkingEnabled: boolean | null
}) {
  const { provider, modelOptions, updateModelOptions, thinkingEnabled } = props
  if (thinkingEnabled === null) {
    return null
  }

  return (
    <MenuGroup>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Thinking</div>
      <MenuRadioGroup
        value={thinkingEnabled ? 'on' : 'off'}
        onValueChange={value => {
          updateModelOptions(buildNextOptions(provider, modelOptions, { thinking: value === 'on' }))
        }}
      >
        <MenuRadioItem value="on">On (default)</MenuRadioItem>
        <MenuRadioItem value="off">Off</MenuRadioItem>
      </MenuRadioGroup>
    </MenuGroup>
  )
}

function TraitsFastModeSection(props: {
  provider: ProviderKind
  modelOptions?: ProviderOptions | null | undefined
  updateModelOptions: (nextOptions: ProviderOptions | undefined) => void
}) {
  const { provider, modelOptions, updateModelOptions } = props
  return (
    <>
      <MenuDivider />
      <MenuGroup>
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Fast Mode</div>
        <MenuRadioGroup
          value={(modelOptions as { fastMode?: boolean } | undefined)?.fastMode ? 'on' : 'off'}
          onValueChange={value => {
            updateModelOptions(
              buildNextOptions(provider, modelOptions, { fastMode: value === 'on' })
            )
          }}
        >
          <MenuRadioItem value="off">off</MenuRadioItem>
          <MenuRadioItem value="on">on</MenuRadioItem>
        </MenuRadioGroup>
      </MenuGroup>
    </>
  )
}

function TraitsContextWindowSection(props: {
  provider: ProviderKind
  modelOptions?: ProviderOptions | null | undefined
  updateModelOptions: (nextOptions: ProviderOptions | undefined) => void
  contextWindow: string | null
  contextWindowOptions: SelectedTraits['contextWindowOptions']
  defaultContextWindow: string | null
}) {
  const {
    provider,
    modelOptions,
    updateModelOptions,
    contextWindow,
    contextWindowOptions,
    defaultContextWindow,
  } = props
  if (contextWindowOptions.length <= 1) {
    return null
  }

  return (
    <>
      <MenuDivider />
      <MenuGroup>
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Context Window</div>
        <MenuRadioGroup
          value={contextWindow ?? defaultContextWindow ?? ''}
          onValueChange={value => {
            updateModelOptions(buildNextOptions(provider, modelOptions, { contextWindow: value }))
          }}
        >
          {contextWindowOptions.map(option => (
            <MenuRadioItem key={option.value} value={option.value}>
              {option.label}
              {option.value === defaultContextWindow ? ' (default)' : ''}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </>
  )
}

function TraitsMenuSections(props: TraitsSectionProps) {
  const { provider, prompt, onPromptChange, modelOptions, updateModelOptions, traits } = props
  if (
    traits.effort === null &&
    traits.thinkingEnabled === null &&
    traits.contextWindowOptions.length <= 1
  ) {
    return null
  }

  return (
    <>
      <TraitsEffortSection
        provider={provider}
        prompt={prompt}
        onPromptChange={onPromptChange}
        modelOptions={modelOptions}
        updateModelOptions={updateModelOptions}
        traits={traits}
      />
      {!traits.effort ? (
        <TraitsThinkingSection
          provider={provider}
          modelOptions={modelOptions}
          updateModelOptions={updateModelOptions}
          thinkingEnabled={traits.thinkingEnabled}
        />
      ) : null}
      {traits.caps.supportsFastMode ? (
        <TraitsFastModeSection
          provider={provider}
          modelOptions={modelOptions}
          updateModelOptions={updateModelOptions}
        />
      ) : null}
      <TraitsContextWindowSection
        provider={provider}
        modelOptions={modelOptions}
        updateModelOptions={updateModelOptions}
        contextWindow={traits.contextWindow}
        contextWindowOptions={traits.contextWindowOptions}
        defaultContextWindow={traits.defaultContextWindow}
      />
    </>
  )
}

export const TraitsMenuContent = memo(function TraitsMenuContentImpl({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const updateModelOptions = useTraitsModelOptionsUpdater(persistence, provider)
  const traits = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort
  )
  return (
    <TraitsMenuSections
      provider={provider}
      prompt={prompt}
      onPromptChange={onPromptChange}
      modelOptions={modelOptions}
      updateModelOptions={updateModelOptions}
      traits={traits}
    />
  )
})

function getTraitsTriggerLabel(traits: SelectedTraits) {
  const effortLabel = traits.effort
    ? (traits.effortLevels.find(option => option.value === traits.effort)?.label ?? traits.effort)
    : null
  const contextWindowLabel =
    traits.contextWindowOptions.length > 1 && traits.contextWindow !== traits.defaultContextWindow
      ? (traits.contextWindowOptions.find(option => option.value === traits.contextWindow)?.label ??
        null)
      : null

  return [
    traits.ultrathinkPromptControlled
      ? 'Ultrathink'
      : effortLabel
        ? effortLabel
        : traits.thinkingEnabled === null
          ? null
          : `Thinking ${traits.thinkingEnabled ? 'On' : 'Off'}`,
    ...(traits.caps.supportsFastMode && traits.fastModeEnabled ? ['Fast'] : []),
    ...(contextWindowLabel ? [contextWindowLabel] : []),
  ]
    .filter(Boolean)
    .join(' · ')
}

function TraitsPickerTriggerContent(props: { isCodexStyle: boolean; triggerLabel: string }) {
  const { isCodexStyle, triggerLabel } = props
  if (isCodexStyle) {
    return (
      <span className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
        {triggerLabel}
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
      </span>
    )
  }

  return (
    <>
      <span>{triggerLabel}</span>
      <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
    </>
  )
}

export const TraitsPicker = memo(function TraitsPicker({
  provider,
  models,
  model,
  prompt,
  onPromptChange,
  modelOptions,
  allowPromptInjectedEffort = true,
  triggerVariant,
  triggerClassName,
  ...persistence
}: TraitsMenuContentProps & TraitsPersistence) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const traits = getSelectedTraits(
    provider,
    models,
    model,
    prompt,
    modelOptions,
    allowPromptInjectedEffort
  )
  const triggerLabel = getTraitsTriggerLabel(traits)
  const isCodexStyle = provider === 'codex'
  const triggerButtonClassName = cn(
    isCodexStyle
      ? 'min-w-0 max-w-40 shrink justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0'
      : 'shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3',
    triggerClassName
  )

  return (
    <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={triggerVariant ?? 'ghost'}
            className={triggerButtonClassName}
          />
        }
      >
        <TraitsPickerTriggerContent isCodexStyle={isCodexStyle} triggerLabel={triggerLabel} />
      </MenuTrigger>
      <MenuPopup align="start">
        <TraitsMenuContent
          provider={provider}
          models={models}
          model={model}
          prompt={prompt}
          onPromptChange={onPromptChange}
          modelOptions={modelOptions}
          allowPromptInjectedEffort={allowPromptInjectedEffort}
          {...persistence}
        />
      </MenuPopup>
    </Menu>
  )
})
