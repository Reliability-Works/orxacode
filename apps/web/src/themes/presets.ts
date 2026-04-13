/**
 * Theme preset definitions.
 *
 * Each preset is a record of CSS custom property names → values.
 * These are applied directly on <html> at runtime, overriding the
 * base :root / @variant dark values from index.css.
 *
 * Atmospheric presets (glass: true) also define --glow-N vars that
 * control the radial gradient colors in the body::before backdrop.
 *
 * Convention: light presets omit `color-scheme` (inherits "light" from :root).
 * Dark presets set `color-scheme: dark`.
 */

export interface ThemePreset {
  readonly id: string
  readonly name: string
  readonly mode: 'light' | 'dark'
  /** Whether this preset uses atmospheric effects (gradient glows + noise texture). */
  readonly glass?: boolean
  readonly vars: Readonly<Record<string, string>>
}

export { LIGHT_PRESETS } from './lightPresets'
export { DARK_PRESETS } from './darkPresets'

// Re-import for use in utility functions
import { LIGHT_PRESETS } from './lightPresets'
import { DARK_PRESETS } from './darkPresets'

export function getPreset(mode: 'light' | 'dark', id: string): ThemePreset | undefined {
  const presets = mode === 'light' ? LIGHT_PRESETS : DARK_PRESETS
  return presets.find(p => p.id === id)
}

export function getPresetOrDefault(mode: 'light' | 'dark', id: string): ThemePreset {
  // Migration: old 'glass' id maps to 'aurora'
  const resolvedId = id === 'glass' ? 'aurora' : id
  const fallback = mode === 'light' ? LIGHT_PRESETS[0]! : DARK_PRESETS[0]!
  return getPreset(mode, resolvedId) ?? fallback
}
