import type { Rectangle } from 'electron'
import type { BrowserBounds, BrowserLocator } from '../../shared/ipc'

const DEFAULT_BROWSER_PARTITION = 'persist:orxa-browser'
const DEFAULT_NEW_TAB_URL = 'about:blank'
const DEFAULT_ACTION_TIMEOUT_MS = 12_000
const DEFAULT_MAX_ATTEMPTS = 3
const SCHEMES_ALLOWLIST = new Set(['http:', 'https:'])

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Unknown browser error'
}

export function isAllowedBrowserUrl(rawUrl: string): boolean {
  if (rawUrl === DEFAULT_NEW_TAB_URL) {
    return true
  }
  try {
    const parsed = new URL(rawUrl)
    return SCHEMES_ALLOWLIST.has(parsed.protocol)
  } catch {
    return false
  }
}

export function toSafeBrowserUrl(rawUrl?: string): string {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return DEFAULT_NEW_TAB_URL
  }
  const value = rawUrl.trim()
  if (!isAllowedBrowserUrl(value)) {
    throw new Error('URL scheme is not allowed')
  }
  return value === DEFAULT_NEW_TAB_URL ? value : new URL(value).toString()
}

export function clampJpegQuality(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 80
  }
  return Math.max(1, Math.min(100, Math.floor(value)))
}

export function clampTimeoutMs(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ACTION_TIMEOUT_MS
  }
  return Math.max(100, Math.min(120_000, Math.floor(value)))
}

export function clampAttempts(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_ATTEMPTS
  }
  return Math.max(1, Math.min(8, Math.floor(value)))
}

export function delay(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  })
}

export function toLocatorFromRequest(request: {
  selector?: string
  locator?: BrowserLocator
}): BrowserLocator {
  const locator = request.locator ?? {}
  if (request.selector && !locator.selector) {
    return {
      ...locator,
      selector: request.selector,
    }
  }
  return locator
}

export function toRectFromBounds(bounds?: Partial<BrowserBounds>): Rectangle | undefined {
  if (!bounds) {
    return undefined
  }
  const x = typeof bounds.x === 'number' ? bounds.x : undefined
  const y = typeof bounds.y === 'number' ? bounds.y : undefined
  const width = typeof bounds.width === 'number' ? bounds.width : undefined
  const height = typeof bounds.height === 'number' ? bounds.height : undefined
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.floor(width),
    height: Math.floor(height),
  }
}

export { DEFAULT_BROWSER_PARTITION, DEFAULT_NEW_TAB_URL }
