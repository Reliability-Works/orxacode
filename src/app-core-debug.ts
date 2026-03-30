import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { Event as OpencodeEvent } from '@opencode-ai/sdk/v2/client'
import type {
  AppDiagnosticEntry,
  AppDiagnosticInput,
  BrowserHistoryItem,
  BrowserState,
  McpDevToolsServerState,
  OrxaEvent,
  RuntimeState,
} from '@shared/ipc'
import { handleProjectRuntimeEvent } from './app-core-project-events'

export type DebugLogLevel = 'info' | 'warn' | 'error'

export type DebugLogInput = {
  level: DebugLogLevel
  eventType: string
  summary: string
  details?: string
}

type DiagnosticsContext = {
  appendDebugLog: (entry: DebugLogInput) => void
  reportRendererDiagnostic: (input: AppDiagnosticInput) => void
  setDebugLogs: Dispatch<SetStateAction<Array<{ id: string; time: number } & DebugLogInput>>>
  setRuntime: Dispatch<SetStateAction<RuntimeState>>
  setStatusLine: Dispatch<SetStateAction<string>>
  setBrowserRuntimeState: Dispatch<SetStateAction<BrowserState>>
  setBrowserHistoryItems: Dispatch<SetStateAction<BrowserHistoryItem[]>>
  setBrowserActionRunning: Dispatch<SetStateAction<boolean>>
  setMcpDevToolsState: Dispatch<SetStateAction<McpDevToolsServerState>>
  handleUpdaterTelemetry: (payload: Extract<OrxaEvent, { type: 'updater.telemetry' }>['payload']) => void
  bootstrap: () => Promise<void>
  applyOpencodeStreamEvent: (directory: string, event: OpencodeEvent) => void
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  addSessionFeedNotice: (
    directory: string,
    sessionID: string,
    notice: { label: string; detail: string; tone: 'info' | 'error' }
  ) => void
  buildSessionFeedNoticeKey: (directory: string, sessionID: string) => string
  getManualSessionStopState: (
    sessionKey: string | null
  ) => { requestedAt?: number; noticeEmitted?: boolean } | undefined
  markManualSessionStopNoticeEmitted: (sessionKey: string, at: number) => void
  pruneManualSessionStops: (now: number) => void
  pushToast: (message: string, tone: 'info' | 'warning' | 'error') => void
  queueRefresh: (message: string, delayMs: number, scope?: 'project' | 'messages' | 'both') => void
  scheduleGitRefresh: (delayMs: number) => void
  stopResponsePolling: () => void
  isRecoverableSessionError: (message: string, code: string) => boolean
}

function stringifyDetails(value: unknown) {
  if (value === undefined) {
    return undefined
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function toDebugLogEntryFromDiagnostic(entry: AppDiagnosticEntry): DebugLogInput {
  return {
    level: entry.level,
    eventType: entry.category,
    summary: entry.message,
    details: entry.details,
  }
}

function debugLogFromProjectEvent(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>
): DebugLogInput {
  const streamType = String(event.payload.event.type ?? 'project.event')
  const properties =
    event.payload.event.properties && typeof event.payload.event.properties === 'object'
      ? (event.payload.event.properties as Record<string, unknown>)
      : undefined

  if (streamType === 'session.error') {
    const errorRecord =
      properties?.error && typeof properties.error === 'object'
        ? (properties.error as Record<string, unknown>)
        : undefined
    return {
      level: 'error',
      eventType: streamType,
      summary: typeof errorRecord?.message === 'string' ? errorRecord.message : 'Session error',
      details: stringifyDetails(properties),
    }
  }

  if (streamType === 'session.status') {
    const status =
      properties?.status && typeof properties.status === 'object'
        ? (properties.status as Record<string, unknown>)
        : undefined
    const statusType = typeof status?.type === 'string' ? status.type : 'unknown'
    return {
      level: statusType === 'retry' ? 'warn' : 'info',
      eventType: streamType,
      summary: `Session status: ${statusType}`,
      details: stringifyDetails(properties),
    }
  }

  return {
    level: 'info',
    eventType: streamType,
    summary: `Project event: ${streamType}`,
    details: stringifyDetails(properties),
  }
}

function debugLogFromBrowserAgentAction(
  event: Extract<OrxaEvent, { type: 'browser.agent.action' }>
): DebugLogInput {
  return {
    level: event.payload.ok ? 'info' : 'error',
    eventType: `browser.${event.payload.action}`,
    summary: event.payload.ok
      ? `Browser action completed: ${event.payload.action}`
      : `Browser action failed: ${event.payload.action}${event.payload.error ? ` (${event.payload.error})` : ''}`,
    details: stringifyDetails(event.payload),
  }
}

export function toDebugLogFromEvent(event: OrxaEvent): DebugLogInput {
  if (event.type === 'runtime.error') {
    return {
      level: 'error',
      eventType: 'runtime.error',
      summary: event.payload.message || 'Runtime error',
      details: stringifyDetails(event.payload),
    }
  }

  if (event.type === 'app.diagnostic') {
    return {
      level: event.payload.level,
      eventType: event.payload.category,
      summary: event.payload.message,
      details: stringifyDetails({
        source: event.payload.source,
        details: event.payload.details,
      }),
    }
  }

  if (event.type === 'updater.telemetry') {
    const phase = event.payload.phase
    return {
      level: phase === 'check.error' ? 'error' : 'info',
      eventType: `updater.${phase}`,
      summary:
        phase === 'check.error'
          ? `Updater check failed${event.payload.message ? `: ${event.payload.message}` : ''}`
          : `Updater event: ${phase}`,
      details: stringifyDetails(event.payload),
    }
  }

  if (event.type === 'opencode.project') {
    return debugLogFromProjectEvent(event)
  }

  if (event.type === 'browser.agent.action') {
    return debugLogFromBrowserAgentAction(event)
  }

  return {
    level: 'info',
    eventType: event.type,
    summary: event.type,
    details: stringifyDetails(event.payload),
  }
}

function useExistingDiagnosticsLog(setDebugLogs: DiagnosticsContext['setDebugLogs']) {
  useEffect(() => {
    let cancelled = false
    const pending = window.orxa?.app?.listDiagnostics?.(300)
    void pending
      ?.then(entries => {
        if (cancelled || !entries?.length) {
          return
        }
        setDebugLogs(current => {
          const seen = new Set(current.map(entry => entry.id))
          const next = [...current]
          for (const entry of entries) {
            if (seen.has(entry.id)) {
              continue
            }
            next.push({
              id: entry.id,
              time: entry.timestamp,
              ...toDebugLogEntryFromDiagnostic(entry),
            })
            seen.add(entry.id)
          }
          return next.slice(-1200)
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [setDebugLogs])
}

function useRendererErrorDiagnostics(
  reportRendererDiagnostic: DiagnosticsContext['reportRendererDiagnostic']
) {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportRendererDiagnostic({
        level: 'error',
        source: 'renderer',
        category: 'renderer.error',
        message: event.message || 'Unhandled renderer error',
        details: JSON.stringify({
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error instanceof Error ? event.error.stack : undefined,
        }),
      })
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason)
      reportRendererDiagnostic({
        level: 'error',
        source: 'renderer',
        category: 'renderer.unhandledrejection',
        message,
        details: event.reason instanceof Error ? event.reason.stack : undefined,
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [reportRendererDiagnostic])
}

function useRendererPerformanceDiagnostics(
  reportRendererDiagnostic: DiagnosticsContext['reportRendererDiagnostic']
) {
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') {
      return
    }
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      return
    }
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        reportRendererDiagnostic({
          level: 'warn',
          source: 'renderer',
          category: 'renderer.longtask',
          message: `Long renderer task detected (${Math.round(entry.duration)}ms)`,
          details: JSON.stringify({
            name: entry.name,
            entryType: entry.entryType,
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
          }),
        })
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  }, [reportRendererDiagnostic])
}

function useRendererVisibilityDiagnostics(
  reportRendererDiagnostic: DiagnosticsContext['reportRendererDiagnostic']
) {
  useEffect(() => {
    let lastTick = performance.now()
    const onVisibilityChange = () => {
      reportRendererDiagnostic({
        level: 'info',
        source: 'renderer',
        category: 'renderer.visibility',
        message:
          document.visibilityState === 'visible'
            ? 'Renderer became visible'
            : 'Renderer became hidden',
      })
    }
    const onPageShow = () => {
      reportRendererDiagnostic({
        level: 'info',
        source: 'renderer',
        category: 'renderer.pageshow',
        message: 'Renderer page show fired',
      })
    }
    const onFocus = () => {
      const now = performance.now()
      const gapMs = now - lastTick
      if (gapMs > 10_000) {
        reportRendererDiagnostic({
          level: 'warn',
          source: 'renderer',
          category: 'renderer.resume-gap',
          message: `Renderer resumed after ${Math.round(gapMs)}ms gap`,
        })
      }
      lastTick = now
    }
    const timer = window.setInterval(() => {
      lastTick = performance.now()
    }, 2_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
    }
  }, [reportRendererDiagnostic])
}

function appendBrowserHistoryItem(
  setBrowserHistoryItems: DiagnosticsContext['setBrowserHistoryItems'],
  historyItem: BrowserHistoryItem
) {
  setBrowserHistoryItems(current => {
    const withoutMatch = current.filter(
      item => item.id !== historyItem.id && item.url !== historyItem.url
    )
    return [historyItem, ...withoutMatch].slice(0, 1_000)
  })
}

function useOrxaEventDiagnostics(context: DiagnosticsContext) {
  const {
    appendDebugLog,
    bootstrap,
    handleUpdaterTelemetry,
    setBrowserActionRunning,
    setBrowserHistoryItems,
    setBrowserRuntimeState,
    setMcpDevToolsState,
    setRuntime,
    setStatusLine,
  } = context

  useEffect(() => {
    const events = window.orxa?.events
    if (!events) {
      setStatusLine('Desktop bridge unavailable. Restart Orxa Code to reconnect.')
      return
    }

    const unsubscribe = events.subscribe(event => {
      appendDebugLog(toDebugLogFromEvent(event))

      if (event.type === 'runtime.status') {
        setRuntime(event.payload)
      } else if (event.type === 'runtime.error') {
        setStatusLine(event.payload.message)
      } else if (event.type === 'updater.telemetry') {
        handleUpdaterTelemetry(event.payload)
      } else if (event.type === 'browser.state') {
        setBrowserRuntimeState(event.payload)
      } else if (event.type === 'mcp.devtools.status') {
        setMcpDevToolsState(event.payload.state)
      } else if (event.type === 'browser.history.added') {
        appendBrowserHistoryItem(setBrowserHistoryItems, event.payload)
      } else if (event.type === 'browser.history.cleared') {
        setBrowserHistoryItems([])
      } else if (event.type === 'browser.agent.action') {
        setBrowserActionRunning(false)
      } else if (event.type === 'opencode.global') {
        if (
          event.payload.event.type === 'project.updated' ||
          event.payload.event.type === 'global.disposed' ||
          event.payload.event.type === 'server.connected'
        ) {
          void bootstrap()
        }
      } else if (event.type === 'opencode.project') {
        handleProjectRuntimeEvent(event, context)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [
    appendDebugLog,
    bootstrap,
    context,
    handleUpdaterTelemetry,
    setBrowserActionRunning,
    setBrowserHistoryItems,
    setBrowserRuntimeState,
    setMcpDevToolsState,
    setRuntime,
    setStatusLine,
  ])
}

export function useAppCoreDiagnostics(context: DiagnosticsContext) {
  useExistingDiagnosticsLog(context.setDebugLogs)
  useRendererErrorDiagnostics(context.reportRendererDiagnostic)
  useRendererPerformanceDiagnostics(context.reportRendererDiagnostic)
  useRendererVisibilityDiagnostics(context.reportRendererDiagnostic)
  useOrxaEventDiagnostics(context)
}
