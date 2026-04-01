import type { Part } from '@opencode-ai/sdk/v2/client'

const ORXA_BROWSER_RESULT_PREFIX = '[ORXA_BROWSER_RESULT]'
const SUPERMEMORY_INTERNAL_PREFIX = '[SUPERMEMORY]'
const INTERNAL_USER_TEXT_PREFIXES = [ORXA_BROWSER_RESULT_PREFIX, SUPERMEMORY_INTERNAL_PREFIX]
const ORXA_BROWSER_ACTION_TAG_PATTERN =
  /<orxa_browser_action>\s*([\s\S]*?)\s*<\/orxa_browser_action>/gi

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function parseOrxaBrowserActionsFromText(
  text: string
): Array<{ id?: string; action?: string }> {
  const actions: Array<{ id?: string; action?: string }> = []
  let match: RegExpExecArray | null
  ORXA_BROWSER_ACTION_TAG_PATTERN.lastIndex = 0
  while ((match = ORXA_BROWSER_ACTION_TAG_PATTERN.exec(text)) !== null) {
    const payload = parseJsonObject((match[1] ?? '').trim())
    if (!payload) {
      continue
    }
    const action = typeof payload.action === 'string' ? payload.action.trim() : undefined
    const id = typeof payload.id === 'string' ? payload.id.trim() : undefined
    if (!action && !id) {
      continue
    }
    actions.push({
      action: action && action.length > 0 ? action : undefined,
      id: id && id.length > 0 ? id : undefined,
    })
  }
  return actions
}

export function summarizeOrxaBrowserActionText(text: string) {
  const actions = parseOrxaBrowserActionsFromText(text)
  if (actions.length === 0) {
    return null
  }
  if (actions.length === 1) {
    const first = actions[0]!
    const actionLabel = first.action ?? 'action'
    return `Queued browser action: ${actionLabel}`
  }
  return `Queued ${actions.length} browser actions`
}

export function countOrxaMemoryLines(text: string) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('[ORXA_MEMORY]')).length
}

export function parseOrxaBrowserResultText(text: string) {
  if (!text.startsWith(ORXA_BROWSER_RESULT_PREFIX)) {
    return null
  }
  const payload = parseJsonObject(text.slice(ORXA_BROWSER_RESULT_PREFIX.length).trim())
  if (!payload) {
    return { action: 'action', ok: true } as const
  }
  const action = typeof payload.action === 'string' ? payload.action.trim() : 'action'
  const ok = payload.ok !== false
  const error = typeof payload.error === 'string' ? payload.error.trim() : undefined
  const blockedReason =
    typeof payload.blockedReason === 'string' ? payload.blockedReason.trim() : undefined
  return {
    action,
    ok,
    error,
    blockedReason,
  }
}

export function parseSupermemoryInternalText(text: string) {
  if (!text.startsWith(SUPERMEMORY_INTERNAL_PREFIX)) {
    return null
  }
  const payload = text.slice(SUPERMEMORY_INTERNAL_PREFIX.length).trim()
  const firstLine = payload.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!/^injected\s+\d+\s+items?\b/i.test(firstLine)) {
    return null
  }
  return firstLine
}

export function isLikelyTelemetryJson(value: string) {
  const parsed = parseJsonObject(value)
  if (!parsed) {
    return false
  }
  const type = typeof parsed.type === 'string' ? parsed.type : undefined
  if (type === 'step-start' || type === 'step-finish') {
    return true
  }
  return typeof parsed.sessionID === 'string' && typeof parsed.messageID === 'string'
}

export function isProgressUpdateText(text: string) {
  if (!text.endsWith(':')) {
    return false
  }
  if (text.length > 240 || text.includes('\n')) {
    return false
  }
  return /^(i(?:'ll| will| need to| am going to| can)|let me|now i|first|next|then|before)/i.test(
    text
  )
}

const THINKING_HEDGE_PATTERN =
  /\b(maybe|actually|wait|need to|could be|but if|probably|perhaps|hmm|let me think|i think|should i|not sure|might be|would be)\b/gi

/**
 * Detects chain-of-thought / internal reasoning text that some models emit as
 * regular `type: "text"` parts instead of `type: "reasoning"` parts.
 *
 * These blocks are characterised by:
 *  - Long, unstructured text with no paragraph breaks
 *  - High density of hedging / self-questioning phrases
 *  - Multiple rhetorical question marks in quick succession
 *  - Missing sentence structure (no capitalisation after periods)
 */
export function isLikelyThinkingText(value: string): boolean {
  const text = value.trim()

  // Short text is almost certainly not thinking bleed
  if (text.length < 200) {
    return false
  }

  // If the text contains markdown structure (headers, lists, code fences) it's
  // intentional output, not thinking.
  if (/^#{1,3}\s|^\s*[-*]\s|```/m.test(text)) {
    return false
  }

  // Count hedging phrases — thinking text is dense with them
  THINKING_HEDGE_PATTERN.lastIndex = 0
  const hedgeMatches = text.match(THINKING_HEDGE_PATTERN)
  const hedgeCount = hedgeMatches?.length ?? 0
  const hedgeDensity = hedgeCount / (text.length / 100) // per 100 chars

  // Count question marks — thinking text has many rhetorical questions
  const questionMarks = (text.match(/\?/g) ?? []).length
  const questionDensity = questionMarks / (text.length / 100)

  // No paragraph breaks in a long block is a strong signal
  const hasParagraphs = /\n\s*\n/.test(text)

  // Scoring: need multiple signals to trigger
  let score = 0
  if (hedgeDensity > 1.5) score += 2
  else if (hedgeDensity > 0.8) score += 1

  if (questionDensity > 0.5) score += 2
  else if (questionDensity > 0.25) score += 1

  if (!hasParagraphs && text.length > 400) score += 1

  // Sentences that don't start with capitals after periods (stream-of-consciousness)
  const lowercaseAfterPeriod = (text.match(/\.\s+[a-z]/g) ?? []).length
  if (lowercaseAfterPeriod > 3) score += 1

  return score >= 3
}

export function shouldHideAssistantText(value: string) {
  const text = value.trim()
  if (text.length === 0) {
    return true
  }
  if (parseOrxaBrowserActionsFromText(text).length > 0) {
    return true
  }
  if (countOrxaMemoryLines(text) > 0) {
    return true
  }
  if (isLikelyTelemetryJson(text)) {
    return true
  }
  if (text.includes('Prioritizing mandatory TODO creation')) {
    return true
  }
  if (isProgressUpdateText(text)) {
    return true
  }
  if (isLikelyThinkingText(text)) {
    return true
  }
  return false
}

export function getVisibleParts(role: string, parts: Part[]) {
  if (role !== 'user') {
    return parts.filter(part => part.type === 'text' || part.type === 'file')
  }

  const visibleUserTextParts = parts.filter(part => {
    if (part.type !== 'text') {
      return false
    }
    const text = part.text.trim()
    if (text.length === 0 || text.startsWith('[SUPERMEMORY]')) {
      return false
    }
    if (INTERNAL_USER_TEXT_PREFIXES.some(prefix => text.startsWith(prefix))) {
      return false
    }
    if ('ignored' in part && part.ignored) {
      return false
    }
    if ('synthetic' in part && part.synthetic) {
      return false
    }
    return true
  })

  if (visibleUserTextParts.length === 0) {
    return []
  }

  const fileParts = parts.filter(part => part.type === 'file')
  const filtered = [...visibleUserTextParts, ...fileParts]

  if (filtered.length > 0) {
    return filtered
  }
  return []
}

export function extractVisibleText(parts: Part[]): string {
  const segments: string[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text.length > 0) {
        segments.push(text)
      }
    } else if (part.type === 'file') {
      const label = part.filename ?? part.url ?? 'file'
      segments.push(`[Attached file: ${label}]`)
    }
  }
  return segments.join('\n\n')
}
