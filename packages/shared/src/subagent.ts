export const DELEGATED_PROMPT_FALLBACK_TEXT =
  'Delegated task from parent thread. Exact provider prompt was not exposed.'

export function formatSubagentLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  return trimmed
    .split(/[\s_-]+/)
    .filter(part => part.length > 0)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function buildSubagentThreadTitle(
  agentLabel: string | null | undefined,
  fallbackTitle: string
): string {
  return formatSubagentLabel(agentLabel) ?? fallbackTitle
}

export function buildDelegatedPromptSeedText(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return DELEGATED_PROMPT_FALLBACK_TEXT
}
