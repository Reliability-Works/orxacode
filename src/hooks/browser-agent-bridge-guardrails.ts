import type { SessionMessageBundle } from '@shared/ipc'
import { isForbiddenToolNameInBrowserMode } from '../lib/browser-tool-guardrails'

const ORXA_BROWSER_RESULT_PREFIX = '[ORXA_BROWSER_RESULT]'
const FORBIDDEN_EXTERNAL_TOOL_PATTERN =
  /\bmcp__|mcp error|playwright|pencil app|websocket not connected to app|puppeteer|selenium/i
const CLAIMED_BROWSER_PROGRESS_PATTERN =
  /\b(i(?:'ve| have)|we(?:'ve| have)|just)\s+(opened|loaded|navigated|visited|searched|captured|extracted|clicked|typed|found)\b/i

function getBrowserTextGuardrailViolation(
  bundle: SessionMessageBundle,
  hasOrxaAction: boolean,
  seen: Set<string>
) {
  if (bundle.info.role !== 'assistant') {
    return undefined
  }
  for (const part of bundle.parts) {
    if (part.type !== 'text') {
      continue
    }
    const text = part.text.trim()
    if (!text) {
      continue
    }
    const containsOrxaTag = /<orxa_browser_action>/i.test(text)
    const containsOrxaResult = text.startsWith(ORXA_BROWSER_RESULT_PREFIX)
    if (containsOrxaTag || containsOrxaResult) {
      continue
    }

    const partID = 'id' in part && typeof part.id === 'string' ? part.id : `part-${text.slice(0, 32)}`
    const key = `${String(bundle.info.id ?? 'unknown')}:${partID}`
    if (seen.has(key)) {
      continue
    }

    if (FORBIDDEN_EXTERNAL_TOOL_PATTERN.test(text)) {
      seen.add(key)
      return 'Blocked forbidden external browsing/tool usage. Browser mode allows only <orxa_browser_action> actions in the in-app browser.'
    }

    if (!hasOrxaAction && CLAIMED_BROWSER_PROGRESS_PATTERN.test(text)) {
      seen.add(key)
      return 'Blocked browser-mode response: web progress was claimed without any <orxa_browser_action> tag. Browser automation was halted to enforce in-app browser-only automation.'
    }
  }

  return undefined
}

function getBrowserToolGuardrailViolation(bundle: SessionMessageBundle, seen: Set<string>) {
  if (bundle.info.role !== 'assistant') {
    return undefined
  }
  for (const part of bundle.parts) {
    if (part.type !== 'tool' || typeof part.tool !== 'string') {
      continue
    }
    const toolName = part.tool.trim()
    if (!toolName || !isForbiddenToolNameInBrowserMode(toolName)) {
      continue
    }
    const key = `${String(bundle.info.id ?? 'unknown')}:${part.id}:tool:${toolName.toLowerCase()}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    return `Blocked forbidden tool usage in Browser Mode ("${toolName}"). Only in-app <orxa_browser_action> automation is allowed.`
  }

  return undefined
}

export function getBrowserGuardrailViolation(
  bundle: SessionMessageBundle,
  hasOrxaAction: boolean,
  seen: Set<string>
) {
  const textViolation = getBrowserTextGuardrailViolation(bundle, hasOrxaAction, seen)
  if (textViolation) {
    return textViolation
  }
  return getBrowserToolGuardrailViolation(bundle, seen)
}
