import { useSyncExternalStore } from 'react'
import { relayMobileSyncLogEntry } from './mobileSyncLogRelay'

export interface MobileSyncDebugEntry {
  readonly id: number
  readonly level: 'info' | 'warn' | 'error'
  readonly text: string
  readonly timestamp: string
}

export type MobileSyncDebugFilter = 'all' | 'key' | 'errors' | 'pair' | 'socket' | 'data'

const MAX_ENTRIES = 250
const listeners = new Set<() => void>()
const originalConsoleMethods = {
  info: console.info,
  warn: console.warn,
  error: console.error,
}

let entries: MobileSyncDebugEntry[] = []
let installed = false
let nextEntryId = 1

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function normalizeValueForLog(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
    }
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (ancestors.has(value)) {
    return '[Circular]'
  }

  ancestors.add(value)

  if (Array.isArray(value)) {
    const normalizedArray = value.map(item => normalizeValueForLog(item, ancestors))
    ancestors.delete(value)
    return normalizedArray
  }

  const normalizedObject = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeValueForLog(child, ancestors)])
  )
  ancestors.delete(value)
  return normalizedObject
}

function formatValue(value: unknown, ancestors: WeakSet<object>): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(normalizeValueForLog(value, ancestors))
    } catch {
      return String(value)
    }
  }
  if (value instanceof Error) {
    return value.stack ?? value.message
  }
  return String(value)
}

function formatArgs(args: unknown[]): string {
  return args.map(value => formatValue(value, new WeakSet<object>())).join(' ')
}

function shouldCapture(args: unknown[]): boolean {
  return args.some(
    value => typeof value === 'string' && value.toLowerCase().includes('[mobile-sync]')
  )
}

function appendEntry(level: MobileSyncDebugEntry['level'], args: unknown[]) {
  const text = formatArgs(args)
  const entry: MobileSyncDebugEntry = {
    id: nextEntryId++,
    level,
    text,
    timestamp: new Date().toISOString(),
  }
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry]
  relayMobileSyncLogEntry({
    level,
    text,
    timestamp: entry.timestamp,
  })
  emit()
}

function wrapConsoleMethod(level: MobileSyncDebugEntry['level']) {
  const original = originalConsoleMethods[level]
  return (...args: unknown[]) => {
    if (shouldCapture(args)) {
      appendEntry(level, args)
    }
    original(...args)
  }
}

export function installMobileSyncDebugBuffer() {
  if (installed || typeof window === 'undefined') {
    return
  }
  installed = true
  console.info = wrapConsoleMethod('info')
  console.warn = wrapConsoleMethod('warn')
  console.error = wrapConsoleMethod('error')
}

export function subscribeMobileSyncDebugEntries(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getMobileSyncDebugEntries(): readonly MobileSyncDebugEntry[] {
  return entries
}

function matchesAnyPattern(text: string, patterns: readonly string[]) {
  return patterns.some(pattern => text.includes(pattern))
}

function isKeyMobileSyncEntry(entry: MobileSyncDebugEntry) {
  return (
    entry.level === 'error' ||
    matchesAnyPattern(entry.text, [
      '[mobile-sync] pair auto bootstrap start',
      '[mobile-sync] pair auto bootstrap saved environment added',
      '[mobile-sync] pair auto bootstrap runtime initialized',
      '[mobile-sync] pair auto bootstrap error',
      '[mobile-sync] pair manual submit start',
      '[mobile-sync] pair manual submit saved environment added',
      '[mobile-sync] pair manual submit runtime initialized',
      '[mobile-sync] pair manual submit error',
      '[mobile-sync] root boot strategy',
      '[mobile-sync] root boot ready',
      '[mobile-sync] root boot error',
      '"event":"connect-saved-environment"',
      '"event":"reuse-saved-environment-connection"',
      '"event":"connect-primary-environment"',
      '"event":"create-connection-start"',
      '"event":"create-connection-done"',
      '"event":"create-connection-error"',
      '[mobile-sync] serverState fetch config resolved',
      '[mobile-sync] serverState fetch config error',
      '[mobile-sync] reconcile resolved',
      '[mobile-sync] reconcile error',
      '[mobile-sync] reconcile apply done',
      '[mobile-sync] snapshot recovery apply done',
      '[mobile-sync] sync ready',
    ])
  )
}

export function filterMobileSyncDebugEntries(
  sourceEntries: readonly MobileSyncDebugEntry[],
  filter: MobileSyncDebugFilter
): readonly MobileSyncDebugEntry[] {
  switch (filter) {
    case 'all':
      return sourceEntries
    case 'key':
      return sourceEntries.filter(isKeyMobileSyncEntry)
    case 'errors':
      return sourceEntries.filter(
        entry => entry.level === 'error' || /\berror\b/i.test(entry.text)
      )
    case 'pair':
      return sourceEntries.filter(entry =>
        matchesAnyPattern(entry.text, [
          '[mobile-sync] pair auto bootstrap',
          '[mobile-sync] pair manual submit',
          '[mobile-sync] root boot strategy',
          '[mobile-sync] root boot ready',
          '"event":"initialize-saved-start"',
          '"event":"initialize-saved-done"',
          '"event":"connect-saved-environment"',
          '"event":"replace-saved-environment-state"',
        ])
      )
    case 'socket':
      return sourceEntries.filter(entry =>
        matchesAnyPattern(entry.text, [
          '[mobile-sync] transport',
          '[mobile-sync] remote api',
          '[mobile-sync] ws route',
          '[mobile-sync] ws auth',
          '[mobile-sync] serverState fetch config',
        ])
      )
    case 'data':
      return sourceEntries.filter(entry =>
        matchesAnyPattern(entry.text, [
          '[mobile-sync] reconcile',
          '[mobile-sync] snapshot recovery',
          '[mobile-sync] sync ready',
          '[mobile-sync] welcome handler',
          '[mobile-sync] serverState emitWelcome',
          '[mobile-sync] orchestration.getSnapshot',
          '[mobile-sync] store ',
        ])
      )
  }
}

export function useMobileSyncDebugEntries() {
  return useSyncExternalStore(subscribeMobileSyncDebugEntries, getMobileSyncDebugEntries)
}

export function clearMobileSyncDebugEntries() {
  entries = []
  emit()
}

export function buildMobileSyncDebugLogText(filter: MobileSyncDebugFilter = 'all') {
  return filterMobileSyncDebugEntries(entries, filter)
    .map(entry => `${entry.timestamp} [${entry.level}] ${entry.text}`)
    .join('\n')
}

export function resetMobileSyncDebugBufferForTests() {
  console.info = originalConsoleMethods.info
  console.warn = originalConsoleMethods.warn
  console.error = originalConsoleMethods.error
  entries = []
  nextEntryId = 1
  installed = false
  listeners.clear()
}
