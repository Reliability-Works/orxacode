import type { Attachment } from '../hooks/useComposerState'
import type { ModelOption } from '../lib/models'

const CODEX_PROVIDER_ID = 'codex'
const CODEX_PROVIDER_NAME = 'Codex'

export function codexModelsToOptions(
  models: { id: string; model: string; name: string; isDefault: boolean }[]
): ModelOption[] {
  return models.map(m => ({
    key: `${CODEX_PROVIDER_ID}/${m.model}`,
    providerID: CODEX_PROVIDER_ID,
    modelID: m.model,
    providerName: CODEX_PROVIDER_NAME,
    modelName: m.name,
    variants: [],
  }))
}

const MAX_AUTO_TITLE_PROMPT_CHARS = 1200

export function cleanPromptForAutoTitle(prompt: string) {
  if (!prompt) {
    return ''
  }
  const withoutImages = prompt.replace(/\[image(?: x\d+)?\]/gi, ' ')
  const withoutSkills = withoutImages.replace(/(^|\s)\$[A-Za-z0-9_-]+(?=\s|$)/g, ' ')
  const normalized = withoutSkills.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_AUTO_TITLE_PROMPT_CHARS
    ? normalized.slice(0, MAX_AUTO_TITLE_PROMPT_CHARS)
    : normalized
}

export function normalizeGeneratedTitle(title: string | undefined) {
  const cleaned = title?.replace(/\s+/g, ' ').trim() ?? ''
  return cleaned || null
}

export function addCodexComposerAttachments(current: Attachment[], attachments: Attachment[]) {
  if (attachments.length === 0) {
    return current
  }
  const seen = new Set(current.map(item => item.url))
  const next: Attachment[] = []
  for (const attachment of attachments) {
    if (!attachment.url || seen.has(attachment.url)) {
      continue
    }
    seen.add(attachment.url)
    next.push(attachment)
  }
  return next.length > 0 ? [...current, ...next] : current
}

export function buildCodexDisplayPrompt(prompt: string, attachmentCount: number) {
  if (attachmentCount <= 0) {
    return prompt
  }
  const imageLabel = attachmentCount === 1 ? '[image]' : `[image x${attachmentCount}]`
  return prompt.trim().length > 0 ? `${imageLabel} ${prompt}` : imageLabel
}

export type CodexUsageAlert = {
  title: string
  body: string
}

export function getCodexUsageAlert(lastError: string | undefined): CodexUsageAlert | null {
  const raw = lastError?.trim()
  if (!raw) {
    return null
  }
  const normalized = raw.toLowerCase()
  const quotaSignals = [
    'insufficient quota',
    'quota exceeded',
    'out of credits',
    'no credits',
    'usage limit',
    'billing',
    'payment required',
    'credits remaining',
    'reached your current usage limit',
  ]
  if (!quotaSignals.some(signal => normalized.includes(signal))) {
    return null
  }
  return {
    title: 'Codex usage unavailable',
    body: 'This account appears to have no remaining Codex credits or usage. Add credits or switch account, then retry the session.',
  }
}

