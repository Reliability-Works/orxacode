import type { DesktopTheme } from '@orxa-code/contracts'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { getPresetOrDefault, type ThemePreset } from '../themes/presets'

export type Theme = 'light' | 'dark' | 'system'

type ThemeSnapshot = {
  theme: Theme
  systemDark: boolean
  lightPresetId: string
  darkPresetId: string
  uiFont: string
  codeFont: string
}

const STORAGE_KEY = 'orxa:theme'
const LIGHT_PRESET_KEY = 'orxa:light-preset'
const DARK_PRESET_KEY = 'orxa:dark-preset'
const UI_FONT_KEY = 'orxa:ui-font'
const CODE_FONT_KEY = 'orxa:code-font'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

// ── Font options ────────────────────────────────────────────────

export interface FontOption {
  readonly id: string
  readonly name: string
  /** CSS font-family value. Includes fallbacks. */
  readonly stack: string
}

const SYSTEM_SANS_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const SYSTEM_MONO_STACK =
  "'SF Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"

export const UI_FONT_OPTIONS: readonly FontOption[] = [
  { id: 'system', name: 'System', stack: SYSTEM_SANS_STACK },
  { id: 'inter', name: 'Inter', stack: `'Inter', ${SYSTEM_SANS_STACK}` },
  { id: 'geist', name: 'Geist Sans', stack: `'Geist', ${SYSTEM_SANS_STACK}` },
  {
    id: 'helvetica-neue',
    name: 'Helvetica Neue',
    stack: `'Helvetica Neue', Helvetica, ${SYSTEM_SANS_STACK}`,
  },
]

export const CODE_FONT_OPTIONS: readonly FontOption[] = [
  { id: 'system', name: 'System', stack: SYSTEM_MONO_STACK },
  { id: 'jetbrains-mono', name: 'JetBrains Mono', stack: `'JetBrains Mono', ${SYSTEM_MONO_STACK}` },
  { id: 'fira-code', name: 'Fira Code', stack: `'Fira Code', ${SYSTEM_MONO_STACK}` },
  { id: 'cascadia-code', name: 'Cascadia Code', stack: `'Cascadia Code', ${SYSTEM_MONO_STACK}` },
  {
    id: 'source-code-pro',
    name: 'Source Code Pro',
    stack: `'Source Code Pro', ${SYSTEM_MONO_STACK}`,
  },
  { id: 'ibm-plex-mono', name: 'IBM Plex Mono', stack: `'IBM Plex Mono', ${SYSTEM_MONO_STACK}` },
]

// ── Internal state ──────────────────────────────────────────────

let listeners: Array<() => void> = []
let lastSnapshot: ThemeSnapshot | null = null
let lastDesktopTheme: DesktopTheme | null = null
/** Track which CSS custom properties we've set so we can clean them up on preset change. */
let appliedPresetVarKeys: string[] = []

function emitChange() {
  for (const listener of listeners) listener()
}

function getSystemDark(): boolean {
  return window.matchMedia(MEDIA_QUERY).matches
}

function getStored(): Theme {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  // Migration: 'glass' was the old value for the glass theme — map it to 'dark'
  // and set the dark preset to 'aurora' so users keep the atmospheric look
  if (raw === 'glass') {
    localStorage.setItem(STORAGE_KEY, 'dark')
    localStorage.setItem(DARK_PRESET_KEY, 'aurora')
    return 'dark'
  }
  return 'dark'
}

function getStoredPresetId(mode: 'light' | 'dark'): string {
  const key = mode === 'light' ? LIGHT_PRESET_KEY : DARK_PRESET_KEY
  return localStorage.getItem(key) ?? 'default'
}

function getStoredFont(key: string): string {
  return localStorage.getItem(key) ?? 'system'
}

function resolveMode(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return getSystemDark() ? 'dark' : 'light'
  return theme
}

function resolveFontStack(options: readonly FontOption[], id: string): string | null {
  const opt = options.find(o => o.id === id)
  // Return null for 'system' — let the CSS fallback handle it
  if (!opt || opt.id === 'system') return null
  return opt.stack
}

/** Apply the full theme state to the DOM: dark class, glass class, preset CSS vars, fonts. */
function applyTheme(theme: Theme, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add('no-transitions')
  }

  const mode = resolveMode(theme)
  const presetId = getStoredPresetId(mode)
  const preset = getPresetOrDefault(mode, presetId)

  // Glass presets are always visually dark, even when selected under light mode
  const isDark = mode === 'dark' || preset.glass === true
  document.documentElement.classList.toggle('dark', isDark)

  // Toggle glass class based on preset flag
  document.documentElement.classList.toggle('glass', preset.glass === true)

  // Clear previously applied preset CSS vars
  for (const key of appliedPresetVarKeys) {
    document.documentElement.style.removeProperty(key)
  }

  // Apply new preset CSS vars (keys are used as-is: --foo for custom props, color-scheme etc. for standard)
  const newKeys: string[] = []
  for (const [key, value] of Object.entries(preset.vars)) {
    document.documentElement.style.setProperty(key, value)
    newKeys.push(key)
  }

  // Apply font selections
  const uiFontStack = resolveFontStack(UI_FONT_OPTIONS, getStoredFont(UI_FONT_KEY))
  const codeFontStack = resolveFontStack(CODE_FONT_OPTIONS, getStoredFont(CODE_FONT_KEY))

  if (uiFontStack) {
    document.documentElement.style.setProperty('--font-sans', uiFontStack)
    newKeys.push('--font-sans')
  }
  if (codeFontStack) {
    document.documentElement.style.setProperty('--font-mono', codeFontStack)
    newKeys.push('--font-mono')
  }

  appliedPresetVarKeys = newKeys

  // Desktop bridge only understands light/dark/system
  const desktopTheme: DesktopTheme = theme === 'system' ? 'system' : isDark ? 'dark' : mode
  syncDesktopTheme(desktopTheme)

  if (suppressTransitions) {
    void document.documentElement.offsetHeight
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('no-transitions')
    })
  }
}

function syncDesktopTheme(theme: DesktopTheme) {
  const bridge = window.desktopBridge
  if (!bridge || lastDesktopTheme === theme) {
    return
  }

  lastDesktopTheme = theme
  void bridge.setTheme(theme).catch(() => {
    if (lastDesktopTheme === theme) {
      lastDesktopTheme = null
    }
  })
}

// Apply immediately on module load to prevent flash
applyTheme(getStored())

const WATCHED_KEYS = new Set([
  STORAGE_KEY,
  LIGHT_PRESET_KEY,
  DARK_PRESET_KEY,
  UI_FONT_KEY,
  CODE_FONT_KEY,
])

function getSnapshot(): ThemeSnapshot {
  const theme = getStored()
  const systemDark = theme === 'system' ? getSystemDark() : false
  const lightPresetId = getStoredPresetId('light')
  const darkPresetId = getStoredPresetId('dark')
  const uiFont = getStoredFont(UI_FONT_KEY)
  const codeFont = getStoredFont(CODE_FONT_KEY)

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.lightPresetId === lightPresetId &&
    lastSnapshot.darkPresetId === darkPresetId &&
    lastSnapshot.uiFont === uiFont &&
    lastSnapshot.codeFont === codeFont
  ) {
    return lastSnapshot
  }

  lastSnapshot = { theme, systemDark, lightPresetId, darkPresetId, uiFont, codeFont }
  return lastSnapshot
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener)

  const mq = window.matchMedia(MEDIA_QUERY)
  const handleChange = () => {
    if (getStored() === 'system') applyTheme('system', true)
    emitChange()
  }
  mq.addEventListener('change', handleChange)

  const handleStorage = (e: StorageEvent) => {
    if (e.key && WATCHED_KEYS.has(e.key)) {
      applyTheme(getStored(), true)
      emitChange()
    }
  }
  window.addEventListener('storage', handleStorage)

  return () => {
    listeners = listeners.filter(l => l !== listener)
    mq.removeEventListener('change', handleChange)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const { theme, lightPresetId, darkPresetId, uiFont, codeFont } = snapshot

  const mode = resolveMode(theme)
  const activePresetId = mode === 'light' ? lightPresetId : darkPresetId
  const activePreset: ThemePreset = getPresetOrDefault(mode, activePresetId)
  // Glass presets are always visually dark, so resolvedTheme reflects what's actually rendered
  const resolvedTheme: 'light' | 'dark' = activePreset.glass ? 'dark' : mode

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next, true)
    emitChange()
  }, [])

  const setPreset = useCallback((mode: 'light' | 'dark', presetId: string) => {
    const key = mode === 'light' ? LIGHT_PRESET_KEY : DARK_PRESET_KEY
    localStorage.setItem(key, presetId)
    // Re-apply if this mode is currently active
    const currentMode = resolveMode(getStored())
    if (currentMode === mode) {
      applyTheme(getStored(), true)
    }
    emitChange()
  }, [])

  const setUiFont = useCallback((fontId: string) => {
    localStorage.setItem(UI_FONT_KEY, fontId)
    applyTheme(getStored(), false)
    emitChange()
  }, [])

  const setCodeFont = useCallback((fontId: string) => {
    localStorage.setItem(CODE_FONT_KEY, fontId)
    applyTheme(getStored(), false)
    emitChange()
  }, [])

  const resetPresets = useCallback(() => {
    localStorage.removeItem(LIGHT_PRESET_KEY)
    localStorage.removeItem(DARK_PRESET_KEY)
    localStorage.removeItem(UI_FONT_KEY)
    localStorage.removeItem(CODE_FONT_KEY)
    applyTheme(getStored(), true)
    emitChange()
  }, [])

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme)
  }, [theme, lightPresetId, darkPresetId, uiFont, codeFont])

  return {
    theme,
    setTheme,
    resolvedTheme,
    lightPresetId,
    darkPresetId,
    activePreset,
    setPreset,
    uiFont,
    codeFont,
    setUiFont,
    setCodeFont,
    resetPresets,
  } as const
}
