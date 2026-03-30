import type { ClaudeChatEffort } from '@shared/ipc'

const CLAUDE_OPUS_4_6_MODEL = 'claude-opus-4-6'
const CLAUDE_SONNET_4_6_MODEL = 'claude-sonnet-4-6'
const CLAUDE_HAIKU_4_5_MODEL = 'claude-haiku-4-5'

export function supportsClaudeFastMode(model: string | null | undefined): boolean {
  return model?.trim() === CLAUDE_OPUS_4_6_MODEL
}

export function supportsClaudeAdaptiveReasoning(model: string | null | undefined): boolean {
  const normalized = model?.trim()
  return normalized === CLAUDE_OPUS_4_6_MODEL || normalized === CLAUDE_SONNET_4_6_MODEL
}

export function supportsClaudeMaxEffort(model: string | null | undefined): boolean {
  return model?.trim() === CLAUDE_OPUS_4_6_MODEL
}

export function supportsClaudeUltrathinkKeyword(model: string | null | undefined): boolean {
  return supportsClaudeAdaptiveReasoning(model)
}

export function supportsClaudeThinkingToggle(model: string | null | undefined): boolean {
  return model?.trim() === CLAUDE_HAIKU_4_5_MODEL
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === 'string' && /\bultrathink\b/i.test(text)
}

export function getClaudeReasoningEffortOptions(
  model: string | null | undefined
): ReadonlyArray<ClaudeChatEffort> {
  if (supportsClaudeMaxEffort(model)) {
    return ['low', 'medium', 'high', 'max', 'ultrathink']
  }
  if (supportsClaudeAdaptiveReasoning(model)) {
    return ['low', 'medium', 'high', 'ultrathink']
  }
  return []
}

export function getDefaultClaudeReasoningEffort(): Exclude<ClaudeChatEffort, 'ultrathink'> {
  return 'high'
}

export function normalizeClaudeModelOptions(
  model: string | null | undefined,
  options: { effort?: ClaudeChatEffort; fastMode?: boolean; thinking?: boolean } | null | undefined
) {
  const reasoningOptions = getClaudeReasoningEffortOptions(model)
  const defaultEffort = getDefaultClaudeReasoningEffort()
  const effort =
    options?.effort &&
    options.effort !== 'ultrathink' &&
    reasoningOptions.includes(options.effort) &&
    options.effort !== defaultEffort
      ? options.effort
      : undefined
  const thinking =
    supportsClaudeThinkingToggle(model) && options?.thinking === false ? false : undefined
  const fastMode = supportsClaudeFastMode(model) && options?.fastMode === true ? true : undefined
  return {
    ...(effort ? { effort } : {}),
    ...(thinking === false ? { thinking: false } : {}),
    ...(fastMode ? { fastMode: true } : {}),
  }
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeChatEffort | null | undefined
): string {
  const trimmed = text.trim()
  if (!trimmed || effort !== 'ultrathink') {
    return trimmed
  }
  if (trimmed.startsWith('Ultrathink:')) {
    return trimmed
  }
  return `Ultrathink:\n${trimmed}`
}
