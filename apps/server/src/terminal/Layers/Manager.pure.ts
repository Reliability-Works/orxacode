import { Encoding } from 'effect'

import type { TerminalSessionSnapshot } from '@orxa-code/contracts'

import {
  TERMINAL_ENV_BLOCKLIST,
  type PendingProcessEvent,
  type TerminalSessionState,
} from './Manager.types'

export function snapshot(session: TerminalSessionState): TerminalSessionSnapshot {
  return {
    threadId: session.threadId,
    terminalId: session.terminalId,
    cwd: session.cwd,
    status: session.status,
    pid: session.pid,
    history: session.history,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    updatedAt: session.updatedAt,
  }
}

export function cleanupProcessHandles(session: TerminalSessionState): void {
  session.unsubscribeData?.()
  session.unsubscribeData = null
  session.unsubscribeExit?.()
  session.unsubscribeExit = null
}

export function enqueueProcessEvent(
  session: TerminalSessionState,
  expectedPid: number,
  event: PendingProcessEvent
): boolean {
  if (!session.process || session.status !== 'running' || session.pid !== expectedPid) {
    return false
  }

  session.pendingProcessEvents.push(event)
  if (session.processEventDrainRunning) {
    return false
  }

  session.processEventDrainRunning = true
  return true
}

export function capHistory(history: string, maxLines: number): string {
  if (history.length === 0) return history
  const hasTrailingNewline = history.endsWith('\n')
  const lines = history.split('\n')
  if (hasTrailingNewline) {
    lines.pop()
  }
  if (lines.length <= maxLines) return history
  const capped = lines.slice(lines.length - maxLines).join('\n')
  return hasTrailingNewline ? `${capped}\n` : capped
}

export function legacySafeThreadId(threadId: string): string {
  return threadId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function toSafeThreadId(threadId: string): string {
  return `terminal_${Encoding.encodeBase64Url(threadId)}`
}

export function toSafeTerminalId(terminalId: string): string {
  return Encoding.encodeBase64Url(terminalId)
}

export function toSessionKey(threadId: string, terminalId: string): string {
  return `${threadId}\u0000${terminalId}`
}

export function shouldExcludeTerminalEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase()
  if (normalizedKey.startsWith('ORXA_')) {
    return true
  }
  if (normalizedKey.startsWith('VITE_')) {
    return true
  }
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey)
}

export function createTerminalSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtimeEnv?: Record<string, string> | null
): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue
    if (shouldExcludeTerminalEnvKey(key)) continue
    spawnEnv[key] = value
  }
  if (runtimeEnv) {
    for (const [key, value] of Object.entries(runtimeEnv)) {
      spawnEnv[key] = value
    }
  }
  return spawnEnv
}

export function normalizedRuntimeEnv(
  env: Record<string, string> | undefined
): Record<string, string> | null {
  if (!env) return null
  const entries = Object.entries(env)
  if (entries.length === 0) return null
  return Object.fromEntries(entries.toSorted(([left], [right]) => left.localeCompare(right)))
}
