import { type ProviderKind, type ServerProviderModel, type ThreadId } from '@orxa-code/contracts'
import { applyClaudePromptEffortPrefix, getDefaultEffort } from '@orxa-code/shared/model'
import { memo, useCallback, useState } from 'react'
import {
  buildNextOptions,
  getModelVariants,
  getSelectedTraits,
  getTraitsTriggerLabel,
  type ProviderOptions,
  type SelectedTraits,
} from './TraitsPicker.logic'
import type { VariantProps } from 'class-variance-authority'
import { ChevronDownIcon, EllipsisIcon } from 'lucide-react'
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
import { useComposerDraftStore, useComposerThreadDraft } from '../../composerDraftStore'
import { TraitsOpencodeAgentSection, TraitsOpencodeVariantSection } from './TraitsPicker.opencode'
import { useOpencodePrimaryAgents } from './useOpencodePrimaryAgents'
import { cn } from '~/lib/utils'
import { useIsMobile } from '../../hooks/useMediaQuery'

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
  threadId?: ThreadId | undefined
  modelVariants?: ReadonlyArray<string>
  isOpencodePlanMode?: boolean
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
  const {
    provider,
    prompt,
    onPromptChange,
    modelOptions,
    updateModelOptions,
    traits,
    threadId,
    modelVariants,
    isOpencodePlanMode,
  } = props
  const showOpencodeSections = provider === 'opencode' && threadId !== undefined
  const variants = modelVariants ?? []
  if (
    traits.effort === null &&
    traits.thinkingEnabled === null &&
    traits.contextWindowOptions.length <= 1 &&
    !traits.caps.supportsFastMode &&
    !showOpencodeSections
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
      {showOpencodeSections && threadId ? (
        <>
          <TraitsOpencodeAgentSection
            threadId={threadId}
            modelVariants={variants}
            disabled={isOpencodePlanMode ?? false}
          />
          <TraitsOpencodeVariantSection threadId={threadId} modelVariants={variants} />
        </>
      ) : null}
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
  const threadId =
    'onModelOptionsChange' in persistence ? undefined : (persistence.threadId ?? undefined)
  const modelVariants = getModelVariants(models, provider, model)
  const isOpencodePlanMode = useIsOpencodePlanMode(provider, threadId)
  return (
    <TraitsMenuSections
      provider={provider}
      prompt={prompt}
      onPromptChange={onPromptChange}
      modelOptions={modelOptions}
      updateModelOptions={updateModelOptions}
      traits={traits}
      threadId={threadId}
      modelVariants={modelVariants}
      isOpencodePlanMode={isOpencodePlanMode}
    />
  )
})

function useIsOpencodePlanMode(provider: ProviderKind, threadId: ThreadId | undefined): boolean {
  const fallbackThreadId = '' as ThreadId
  const draft = useComposerThreadDraft(threadId ?? fallbackThreadId)
  if (provider !== 'opencode' || !threadId) return false
  return draft.interactionMode === 'plan'
}

function useOpencodeAgentFallbackLabel(
  provider: ProviderKind,
  threadId: ThreadId | undefined,
  isPlanMode: boolean
): string | undefined {
  const fallbackThreadId = '' as ThreadId
  const draft = useComposerThreadDraft(threadId ?? fallbackThreadId)
  const { agents } = useOpencodePrimaryAgents(provider === 'opencode' && !!threadId)
  if (provider !== 'opencode' || !threadId) return undefined
  if (isPlanMode) return 'Agent'
  const selection = draft.modelSelectionByProvider?.opencode
  const agentId = selection?.provider === 'opencode' && selection.agentId ? selection.agentId : null
  if (!agentId) return undefined
  return agents.find(a => a.id === agentId)?.name ?? undefined
}

function TraitsPickerTriggerContent(props: { isCodexStyle: boolean; triggerLabel: string }) {
  const { isCodexStyle, triggerLabel } = props
  const isMobile = useIsMobile()
  if (isMobile) {
    return <EllipsisIcon aria-hidden="true" className="size-4 opacity-70" />
  }
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
  const triggerThreadId =
    'onModelOptionsChange' in persistence ? undefined : (persistence.threadId ?? undefined)
  const isPlanMode = useIsOpencodePlanMode(provider, triggerThreadId)
  const opencodeFallback = useOpencodeAgentFallbackLabel(provider, triggerThreadId, isPlanMode)
  const triggerLabel = getTraitsTriggerLabel(traits, provider, opencodeFallback)
  const isCodexStyle = provider === 'codex'
  const isMobile = useIsMobile()
  const triggerButtonClassName = cn(
    isMobile ? 'min-w-0 shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80' : '',
    isCodexStyle
      ? 'min-w-0 max-w-[11rem] shrink justify-start overflow-hidden whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:max-w-48 sm:px-3 [&_svg]:mx-0'
      : 'min-w-[5.75rem] shrink-0 whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:px-3',
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
