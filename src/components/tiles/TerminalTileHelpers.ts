import type { ITerminalOptions } from 'xterm'
import { SerializeAddon } from 'xterm-addon-serialize'
import type { MutableRefObject } from 'react'
import type { OrxaTerminalSession } from '@shared/ipc'
import type { CanvasTileComponentProps } from './tile-shared'
import { consumeClaudeStartupChunk } from '../../lib/claude-terminal-startup'
import { createManagedTerminal, type ManagedTerminal } from '../../lib/xterm-terminal'

const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#E5E5E5',
  cursor: '#22C55E',
  cursorAccent: '#000000',
  selectionBackground: '#22C55E33',
  black: '#000000',
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#F59E0B',
  blue: '#3B82F6',
  magenta: '#A78BFA',
  cyan: '#06B6D4',
  white: '#E5E5E5',
  brightBlack: '#525252',
  brightRed: '#F87171',
  brightGreen: '#4ADE80',
  brightYellow: '#FBBF24',
  brightBlue: '#60A5FA',
  brightMagenta: '#C4B5FD',
  brightCyan: '#22D3EE',
  brightWhite: '#FFFFFF',
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 12,
  fontWeight: 'normal',
  fontWeightBold: 'bold',
  lineHeight: 1.4,
  cursorBlink: true,
  theme: TERMINAL_THEME,
}

export function getTileLabel(type: string): string {
  if (type === 'claude_code') return 'claude code'
  if (type === 'codex_cli') return 'codex cli'
  if (type === 'opencode_cli') return 'opencode'
  return 'terminal'
}

export function getIconColor(type: string): string {
  if (type === 'claude_code') return '#D97706'
  if (type === 'codex_cli') return '#6C7BFF'
  if (type === 'opencode_cli') return '#22D3EE'
  return '#22C55E'
}

export function filterDisplayChunk(
  chunk: string,
  startupFilter: string | null,
  startupBufferRef: MutableRefObject<string[]>,
  startupReadyRef: MutableRefObject<boolean>
): string {
  if (startupFilter === 'claude') {
    const next = consumeClaudeStartupChunk(startupBufferRef.current, chunk, startupReadyRef.current)
    startupReadyRef.current = next.startupReady
    startupBufferRef.current = next.startupBuffer
    return next.displayChunk ?? ''
  }
  return chunk
}

export type TerminalSetupDeps = {
  container: HTMLDivElement
  directory: string
  serializedOutput: string
  startupCommand: string
  startupFilter: string | null
  setLoadState: (state: 'connecting' | 'ready' | 'error') => void
  setErrorMessage: (msg: string | null) => void
  terminalRef: MutableRefObject<ManagedTerminal | null>
  serializeAddonRef: MutableRefObject<SerializeAddon | null>
  ptyIdRef: MutableRefObject<string | null>
  cleanupRef: MutableRefObject<Array<() => void>>
  startupBufferRef: MutableRefObject<string[]>
  startupReadyRef: MutableRefObject<boolean>
  scheduleSnapshotPersist: () => void
  tile: CanvasTileComponentProps['tile']
  onUpdate: CanvasTileComponentProps['onUpdate']
}

export function initTerminalInstance(
  container: HTMLDivElement,
  serializedOutput: string,
  terminalRef: MutableRefObject<ManagedTerminal | null>,
  serializeAddonRef: MutableRefObject<SerializeAddon | null>,
  cleanupRef: MutableRefObject<Array<() => void>>,
  directory: string,
  ptyIdRef: MutableRefObject<string | null>
) {
  const managed = createManagedTerminal(container, TERMINAL_OPTIONS)
  const terminal = managed.terminal
  const serializeAddon = new SerializeAddon()
  terminal.loadAddon(serializeAddon)
  if (serializedOutput) {
    terminal.write(serializedOutput)
  }

  terminalRef.current = managed
  serializeAddonRef.current = serializeAddon

  const cleanups: Array<() => void> = []
  cleanupRef.current = cleanups

  const disposeInput = terminal.onData(data => {
    if (!ptyIdRef.current) return
    void window.orxa.terminal.write(directory, ptyIdRef.current, data)
  })
  cleanups.push(() => disposeInput.dispose())

  return { managed, terminal, cleanups }
}

export async function setupTerminalConnection(deps: TerminalSetupDeps, cancelledRef: { current: boolean }) {
  const {
    container,
    directory,
    serializedOutput,
    startupCommand,
    startupFilter,
    setLoadState,
    setErrorMessage,
    terminalRef,
    serializeAddonRef,
    ptyIdRef,
    cleanupRef,
    startupBufferRef,
    startupReadyRef,
    scheduleSnapshotPersist,
    tile,
    onUpdate,
  } = deps

  setLoadState('connecting')
  setErrorMessage(null)

  const managed = createManagedTerminal(container, TERMINAL_OPTIONS)
  const terminal = managed.terminal
  const serializeAddon = new SerializeAddon()
  terminal.loadAddon(serializeAddon)
  if (serializedOutput) {
    terminal.write(serializedOutput)
  }

  terminalRef.current = managed
  serializeAddonRef.current = serializeAddon

  const cleanups: Array<() => void> = []
  cleanupRef.current = cleanups

  const resizeTerminal = () => {
    managed.refit()
    if (ptyIdRef.current) {
      void window.orxa.terminal.resize(directory, ptyIdRef.current, terminal.cols, terminal.rows)
    }
  }

  const disposeInput = terminal.onData(data => {
    if (!ptyIdRef.current) return
    void window.orxa.terminal.write(directory, ptyIdRef.current, data)
  })
  cleanups.push(() => disposeInput.dispose())

  const pty = await resolveCanvasPty(tile, onUpdate)
  if (cancelledRef.current) return

  ptyIdRef.current = pty.session.id
  await connectTerminalWithRetry(directory, pty.session.id)
  if (cancelledRef.current) return

  if (pty.created && startupCommand) {
    await window.orxa.terminal.write(directory, pty.session.id, startupCommand)
  }

  const unsubscribe = window.orxa.events.subscribe(event => {
    if (event.type === 'pty.output' && event.payload.ptyID === pty.session.id && event.payload.directory === directory) {
      const sanitizedChunk = sanitizeTerminalChunk(event.payload.chunk)
      if (sanitizedChunk) {
        const displayChunk = filterDisplayChunk(sanitizedChunk, startupFilter, startupBufferRef, startupReadyRef)
        if (displayChunk) {
          managed.writeBuffered(displayChunk)
          scheduleSnapshotPersist()
        }
      }
    }
    if (event.type === 'pty.closed' && event.payload.ptyID === pty.session.id && event.payload.directory === directory) {
      terminal.writeln('\r\n\u001b[33m[terminal closed]\u001b[0m')
    }
  })
  cleanups.push(unsubscribe)

  setLoadState('ready')
  requestAnimationFrame(() => {
    resizeTerminal()
    terminal.focus()
  })
  setTimeout(() => {
    if (!cancelledRef.current) {
      resizeTerminal()
    }
  }, 80)
}

export function handleTerminalError(
  error: unknown,
  cancelled: boolean,
  terminal: ManagedTerminal['terminal'],
  setLoadState: (state: 'connecting' | 'ready' | 'error') => void,
  setErrorMessage: (msg: string | null) => void
) {
  if (cancelled) return
  const message = error instanceof Error ? error.message : 'Terminal failed to connect.'
  setLoadState('error')
  setErrorMessage(message)
  terminal.writeln('\r\n\u001b[31m[failed to connect terminal]\u001b[0m')
  terminal.writeln(`\u001b[90m${message}\u001b[0m`)
}

export function getCanvasTerminalMeta(tile: CanvasTileComponentProps['tile']) {
  const directory = typeof tile.meta.directory === 'string' ? tile.meta.directory : ''
  const cwd = typeof tile.meta.cwd === 'string' ? tile.meta.cwd : directory
  const ptyId = typeof tile.meta.ptyId === 'string' ? tile.meta.ptyId : null
  const serializedOutput = typeof tile.meta.serializedOutput === 'string' ? tile.meta.serializedOutput : ''
  const startupCommand = typeof tile.meta.startupCommand === 'string' ? tile.meta.startupCommand : ''
  const startupFilter = tile.meta.startupFilter === 'claude' ? 'claude' : null
  return { directory, cwd, ptyId, serializedOutput, startupCommand, startupFilter }
}

export function sanitizeTerminalChunk(chunk: string) {
  const sanitized = chunk.replace(/\{"cursor":\d+\}/g, '')
  return sanitized.trim() === '%' ? '' : sanitized
}

function isRetryableTerminalConnectError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /Unexpected server response:\s*(500|502|503|504)/i.test(message)
}

export async function connectTerminalWithRetry(directory: string, ptyID: string, maxAttempts = 5, baseDelayMs = 120) {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await window.orxa.terminal.connect(directory, ptyID)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !isRetryableTerminalConnectError(error)) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt))
    }
  }
  throw lastError ?? new Error('Failed to connect terminal')
}

export async function resolveCanvasPty(
  tile: CanvasTileComponentProps['tile'],
  onUpdate: CanvasTileComponentProps['onUpdate']
): Promise<{ session: OrxaTerminalSession; created: boolean }> {
  const { directory, cwd, ptyId } = getCanvasTerminalMeta(tile)
  if (!directory) {
    throw new Error('Terminal tile is missing a working directory.')
  }

  const list = await window.orxa.terminal.list(directory, 'canvas')
  const existing = ptyId ? list.find(entry => entry.id === ptyId) : undefined
  if (existing && existing.status === 'running') {
    return { session: existing, created: false }
  }

  const nextPty = await window.orxa.terminal.create(directory, cwd, undefined, 'canvas')
  onUpdate(tile.id, { meta: { ...tile.meta, directory, cwd, ptyId: nextPty.id } })
  return { session: nextPty, created: true }
}

export function createScheduleSnapshotPersist(
  snapshotTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  serializeAddonRef: MutableRefObject<SerializeAddon | null>,
  lastSerializedOutputRef: MutableRefObject<string>,
  tile: CanvasTileComponentProps['tile'],
  onUpdate: CanvasTileComponentProps['onUpdate'],
  directory: string,
  ptyIdRef: MutableRefObject<string | null>
) {
  return () => {
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null
      const serializeAddon = serializeAddonRef.current
      if (!serializeAddon) return
      const nextSerializedOutput = serializeAddon.serialize()
      if (!nextSerializedOutput || nextSerializedOutput === lastSerializedOutputRef.current) {
        return
      }
      lastSerializedOutputRef.current = nextSerializedOutput
      onUpdate(tile.id, {
        meta: {
          ...tile.meta,
          directory,
          cwd: typeof tile.meta.cwd === 'string' ? tile.meta.cwd : directory,
          ptyId: typeof tile.meta.ptyId === 'string' ? tile.meta.ptyId : ptyIdRef.current,
          serializedOutput: nextSerializedOutput,
        },
      })
    }, 120)
  }
}

export function createTerminalCleanup(
  cancelledRef: { current: boolean },
  cleanupRef: MutableRefObject<Array<() => void>>,
  snapshotTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  managed: { dispose: () => void },
  terminalRef: MutableRefObject<ManagedTerminal | null>,
  serializeAddonRef: MutableRefObject<SerializeAddon | null>,
  ptyIdRef: MutableRefObject<string | null>
) {
  return () => {
    cancelledRef.current = true
    for (const cleanup of cleanupRef.current) cleanup()
    cleanupRef.current = []
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current)
      snapshotTimerRef.current = null
    }
    managed.dispose()
    terminalRef.current = null
    serializeAddonRef.current = null
    ptyIdRef.current = null
  }
}

export function useTerminalRemoveHandler(
  tile: CanvasTileComponentProps['tile'],
  directory: string,
  ptyIdRef: MutableRefObject<string | null>,
  onRemove: CanvasTileComponentProps['onRemove']
) {
  return () => {
    const ptyId = typeof tile.meta.ptyId === 'string' ? tile.meta.ptyId : ptyIdRef.current
    if (ptyId && window.orxa?.terminal && directory) {
      void window.orxa.terminal.close(directory, ptyId).catch(() => undefined)
    }
    onRemove(tile.id)
  }
}
