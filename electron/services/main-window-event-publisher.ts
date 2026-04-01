import type { BrowserWindow } from 'electron'
import { IPC, type OrxaEvent } from '../../shared/ipc'
import type { PerformanceTelemetryService } from './performance-telemetry-service'

const PTY_OUTPUT_FLUSH_MS = 16
const STRUCTURED_EVENT_FLUSH_MS = 16

type PtyBufferedOutput = {
  directory: string
  ptyID: string
  chunks: string[]
}

function canSendToWindow(window: BrowserWindow | null): window is BrowserWindow {
  if (!window || window.isDestroyed()) {
    return false
  }
  const webContents = window.webContents as BrowserWindow['webContents'] & {
    isDestroyed?: () => boolean
    isCrashed?: () => boolean
  }
  if (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed()) {
    return false
  }
  if (typeof webContents.isCrashed === 'function' && webContents.isCrashed()) {
    return false
  }
  return true
}

function shouldIgnoreSendError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Render frame was disposed before WebFrameMain could be accessed') ||
    message.includes('Object has been destroyed') ||
    message.includes('WebContents was destroyed')
  )
}

function safeSend(window: BrowserWindow, channel: string, payload: OrxaEvent | OrxaEvent[]) {
  try {
    window.webContents.send(channel, payload)
  } catch (error) {
    if (shouldIgnoreSendError(error)) {
      return
    }
    throw error
  }
}

function isBatchableStructuredEvent(event: OrxaEvent) {
  return event.type === 'codex.notification' || event.type === 'claude-chat.notification'
}

function sendSingleEvent(getMainWindow: () => BrowserWindow | null, event: OrxaEvent) {
  const window = getMainWindow()
  if (!canSendToWindow(window)) {
    return
  }
  safeSend(window, IPC.events, event)
}

export function createMainWindowEventPublisher(getMainWindow: () => BrowserWindow | null) {
  const ptyOutputBuffer = new Map<string, PtyBufferedOutput>()
  const ptyOutputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let structuredEventBuffer: OrxaEvent[] = []
  let structuredEventFlushTimer: ReturnType<typeof setTimeout> | null = null
  let performanceTelemetryService: PerformanceTelemetryService | null = null

  const flushStructuredEvents = () => {
    const startedAt = performance.now()
    if (structuredEventFlushTimer) {
      clearTimeout(structuredEventFlushTimer)
      structuredEventFlushTimer = null
    }
    if (structuredEventBuffer.length === 0) {
      return
    }
    const window = getMainWindow()
    const payload = structuredEventBuffer
    structuredEventBuffer = []
    if (!canSendToWindow(window)) {
      return
    }
    safeSend(window, IPC.eventsBatch, payload)
    performanceTelemetryService?.record({
      surface: 'event_bus',
      metric: 'event.batch.flush_ms',
      kind: 'span',
      value: performance.now() - startedAt,
      unit: 'ms',
      process: 'main',
      component: 'main-window-event-publisher',
    })
    performanceTelemetryService?.record({
      surface: 'event_bus',
      metric: 'event.batch.size',
      kind: 'gauge',
      value: payload.length,
      unit: 'count',
      process: 'main',
      component: 'main-window-event-publisher',
    })
  }

  const queueStructuredEvent = (event: OrxaEvent) => {
    structuredEventBuffer.push(event)
    if (!structuredEventFlushTimer) {
      structuredEventFlushTimer = setTimeout(() => {
        flushStructuredEvents()
      }, STRUCTURED_EVENT_FLUSH_MS)
    }
  }

  const flushBufferedPtyOutput = (key: string) => {
    const timer = ptyOutputFlushTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      ptyOutputFlushTimers.delete(key)
    }
    const pending = ptyOutputBuffer.get(key)
    if (!pending) {
      return
    }
    ptyOutputBuffer.delete(key)
    const combinedChunk = pending.chunks.join('')
    sendSingleEvent(getMainWindow, {
      type: 'pty.output',
      payload: {
        directory: pending.directory,
        ptyID: pending.ptyID,
        chunk: combinedChunk,
      },
    })
    performanceTelemetryService?.record({
      surface: 'event_bus',
      metric: 'pty.output.batch_count',
      kind: 'counter',
      value: pending.chunks.length,
      unit: 'count',
      process: 'main',
      component: 'main-window-event-publisher',
      responseSizeBucket:
        combinedChunk.length === 0
          ? '0'
          : combinedChunk.length < 1_000
            ? '1k'
            : combinedChunk.length < 10_000
              ? '10k'
              : combinedChunk.length < 100_000
                ? '100k'
                : '1m_plus',
    })
    performanceTelemetryService?.record({
      surface: 'event_bus',
      metric: 'pty.output.batch_bytes_bucket',
      kind: 'counter',
      value: 1,
      unit: 'count',
      process: 'main',
      component: 'main-window-event-publisher',
      responseSizeBucket:
        combinedChunk.length === 0
          ? '0'
          : combinedChunk.length < 1_000
            ? '1k'
            : combinedChunk.length < 10_000
              ? '10k'
              : combinedChunk.length < 100_000
                ? '100k'
                : '1m_plus',
    })
  }

  const flushAllPtyOutput = () => {
    for (const key of [...ptyOutputBuffer.keys()]) {
      flushBufferedPtyOutput(key)
    }
  }

  const queuePtyOutput = (event: Extract<OrxaEvent, { type: 'pty.output' }>) => {
    const key = `${event.payload.directory}::${event.payload.ptyID}`
    const existing = ptyOutputBuffer.get(key)
    if (existing) {
      existing.chunks.push(event.payload.chunk)
    } else {
      ptyOutputBuffer.set(key, {
        directory: event.payload.directory,
        ptyID: event.payload.ptyID,
        chunks: [event.payload.chunk],
      })
    }

    if (!ptyOutputFlushTimers.has(key)) {
      const timer = setTimeout(() => {
        flushBufferedPtyOutput(key)
      }, PTY_OUTPUT_FLUSH_MS)
      ptyOutputFlushTimers.set(key, timer)
    }
  }

  return {
    setPerformanceTelemetryService(service: PerformanceTelemetryService | null) {
      performanceTelemetryService = service
    },
    publish(event: OrxaEvent) {
      const window = getMainWindow()
      if (!canSendToWindow(window)) {
        return
      }

      if (event.type === 'pty.output') {
        queuePtyOutput(event)
        return
      }

      if (isBatchableStructuredEvent(event)) {
        queueStructuredEvent(event)
        return
      }

      flushStructuredEvents()
      sendSingleEvent(getMainWindow, event)
    },
    flushAll() {
      flushStructuredEvents()
      flushAllPtyOutput()
    },
  }
}
