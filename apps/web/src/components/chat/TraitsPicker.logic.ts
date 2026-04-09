/**
 * Pure selectors and option builders for TraitsPicker.
 * Split from TraitsPicker.tsx to respect max-lines.
 */
import type {
  ClaudeModelOptions,
  CodexModelOptions,
  ProviderKind,
  ProviderModelOptions,
  ServerProviderModel,
} from '@orxa-code/contracts'
import {
  getDefaultContextWindow,
  hasContextWindowOption,
  isClaudeUltrathinkPrompt,
  resolveEffort,
  trimOrNull,
} from '@orxa-code/shared/model'
import {
  findProviderModel,
  getProviderModelCapabilities,
  modelSupportsReasoning,
} from '../../providerModels'

export type ProviderOptions = ProviderModelOptions[ProviderKind]

export function getRawEffort(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined
): string | null {
  if (provider === 'codex') {
    return trimOrNull((modelOptions as CodexModelOptions | undefined)?.reasoningEffort)
  }
  return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.effort)
}

export function getRawContextWindow(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined
): string | null {
  if (provider === 'claudeAgent') {
    return trimOrNull((modelOptions as ClaudeModelOptions | undefined)?.contextWindow)
  }
  return null
}

export function buildNextOptions(
  provider: ProviderKind,
  modelOptions: ProviderOptions | null | undefined,
  patch: Record<string, unknown>
): ProviderOptions {
  if (provider === 'codex') {
    return { ...(modelOptions as CodexModelOptions | undefined), ...patch } as CodexModelOptions
  }
  return { ...(modelOptions as ClaudeModelOptions | undefined), ...patch } as ClaudeModelOptions
}

export function getSelectedTraits(
  provider: ProviderKind,
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  prompt: string,
  modelOptions: ProviderOptions | null | undefined,
  allowPromptInjectedEffort: boolean
) {
  const caps = getProviderModelCapabilities(models, model, provider)
  const supportsReasoning = modelSupportsReasoning(findProviderModel(models, model, provider))
  // Gate reasoning UI on the server-declared `supportsReasoning` flag
  // rather than provider kind, so opencode models without reasoning (and
  // any claude model) hide the effort selector cleanly.
  const effortLevels = supportsReasoning
    ? allowPromptInjectedEffort
      ? caps.reasoningEffortLevels
      : caps.reasoningEffortLevels.filter(
          option => !caps.promptInjectedEffortLevels.includes(option.value)
        )
    : []

  // Resolve effort from options (provider-specific key)
  const rawEffort = getRawEffort(provider, modelOptions)
  const effort = supportsReasoning ? (resolveEffort(caps, rawEffort) ?? null) : null

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

export type SelectedTraits = ReturnType<typeof getSelectedTraits>

export function getModelVariants(
  models: ReadonlyArray<ServerProviderModel>,
  provider: ProviderKind,
  model: string | null | undefined
): ReadonlyArray<string> {
  if (provider !== 'opencode' || !model) return []
  const found = findProviderModel(models, model, provider)
  return found?.variants ?? []
}

export function getTraitsTriggerLabel(
  traits: SelectedTraits,
  provider: ProviderKind,
  opencodeFallbackLabel?: string
) {
  const effortLabel = traits.effort
    ? (traits.effortLevels.find(option => option.value === traits.effort)?.label ?? traits.effort)
    : null
  const contextWindowLabel =
    traits.contextWindowOptions.length > 1 && traits.contextWindow !== traits.defaultContextWindow
      ? (traits.contextWindowOptions.find(option => option.value === traits.contextWindow)?.label ??
        null)
      : null

  const parts = [
    traits.ultrathinkPromptControlled
      ? 'Ultrathink'
      : effortLabel
        ? effortLabel
        : traits.thinkingEnabled === null
          ? null
          : `Thinking ${traits.thinkingEnabled ? 'On' : 'Off'}`,
    ...(traits.caps.supportsFastMode && traits.fastModeEnabled ? ['Fast'] : []),
    ...(contextWindowLabel ? [contextWindowLabel] : []),
  ].filter(Boolean)
  if (parts.length === 0 && provider === 'opencode') {
    return opencodeFallbackLabel ?? 'Agent'
  }
  return parts.join(' · ')
}
