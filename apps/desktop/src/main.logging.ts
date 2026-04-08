import * as ChildProcess from 'node:child_process'
import * as Path from 'node:path'

import { app } from 'electron'
import { RotatingFileSink } from '@orxa-code/shared/logging'

export interface DesktopLoggingState {
  desktopLogSink: RotatingFileSink | null
  backendLogSink: RotatingFileSink | null
  restoreStdIoCapture: (() => void) | null
}

export interface DesktopLoggingConfig {
  readonly logDir: string
  readonly logFileMaxBytes: number
  readonly logFileMaxFiles: number
  readonly appRunId: string
}

export function createDesktopLoggingState(): DesktopLoggingState {
  return { desktopLogSink: null, backendLogSink: null, restoreStdIoCapture: null }
}

export function logTimestamp(): string {
  return new Date().toISOString()
}

export function logScope(scope: string, appRunId: string): string {
  return `${scope} run=${appRunId}`
}

export function sanitizeLogValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function writeDesktopLogHeader(
  state: DesktopLoggingState,
  appRunId: string,
  message: string
): void {
  if (!state.desktopLogSink) return
  state.desktopLogSink.write(`[${logTimestamp()}] [${logScope('desktop', appRunId)}] ${message}\n`)
}

export function writeBackendSessionBoundary(
  state: DesktopLoggingState,
  appRunId: string,
  phase: 'START' | 'END',
  details: string
): void {
  if (!state.backendLogSink) return
  const normalizedDetails = sanitizeLogValue(details)
  state.backendLogSink.write(
    `[${logTimestamp()}] ---- APP SESSION ${phase} run=${appRunId} ${normalizedDetails} ----\n`
  )
}

export function writeDesktopStreamChunk(
  state: DesktopLoggingState,
  appRunId: string,
  streamName: 'stdout' | 'stderr',
  chunk: unknown,
  encoding: BufferEncoding | undefined
): void {
  if (!state.desktopLogSink) return
  const buffer = Buffer.isBuffer(chunk)
    ? chunk
    : Buffer.from(String(chunk), typeof chunk === 'string' ? encoding : undefined)
  state.desktopLogSink.write(`[${logTimestamp()}] [${logScope(streamName, appRunId)}] `)
  state.desktopLogSink.write(buffer)
  if (buffer.length === 0 || buffer[buffer.length - 1] !== 0x0a) {
    state.desktopLogSink.write('\n')
  }
}

export function installStdIoCapture(state: DesktopLoggingState, appRunId: string): void {
  if (!app.isPackaged || state.desktopLogSink === null || state.restoreStdIoCapture !== null) {
    return
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  const patchWrite =
    (streamName: 'stdout' | 'stderr', originalWrite: typeof process.stdout.write) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean => {
      const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
      writeDesktopStreamChunk(state, appRunId, streamName, chunk, encoding)
      if (typeof encodingOrCallback === 'function') {
        return originalWrite(chunk, encodingOrCallback)
      }
      if (callback !== undefined) {
        return originalWrite(chunk, encoding, callback)
      }
      if (encoding !== undefined) {
        return originalWrite(chunk, encoding)
      }
      return originalWrite(chunk)
    }

  process.stdout.write = patchWrite('stdout', originalStdoutWrite)
  process.stderr.write = patchWrite('stderr', originalStderrWrite)

  state.restoreStdIoCapture = () => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    state.restoreStdIoCapture = null
  }
}

export function initializePackagedLogging(
  state: DesktopLoggingState,
  config: DesktopLoggingConfig
): void {
  if (!app.isPackaged) return
  try {
    state.desktopLogSink = new RotatingFileSink({
      filePath: Path.join(config.logDir, 'desktop-main.log'),
      maxBytes: config.logFileMaxBytes,
      maxFiles: config.logFileMaxFiles,
    })
    state.backendLogSink = new RotatingFileSink({
      filePath: Path.join(config.logDir, 'server-child.log'),
      maxBytes: config.logFileMaxBytes,
      maxFiles: config.logFileMaxFiles,
    })
    installStdIoCapture(state, config.appRunId)
    writeDesktopLogHeader(
      state,
      config.appRunId,
      `runtime log capture enabled logDir=${config.logDir}`
    )
  } catch (error) {
    // Logging setup should never block app startup.
    console.error('[desktop] failed to initialize packaged logging', error)
  }
}

export function captureBackendOutput(
  state: DesktopLoggingState,
  child: ChildProcess.ChildProcess
): void {
  if (!app.isPackaged || state.backendLogSink === null) return
  const writeChunk = (chunk: unknown): void => {
    if (!state.backendLogSink) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
    state.backendLogSink.write(buffer)
  }
  child.stdout?.on('data', writeChunk)
  child.stderr?.on('data', writeChunk)
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function getSafeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return null
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return null
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return null
  }

  return parsedUrl.toString()
}

export function getSafeTheme(rawTheme: unknown): 'light' | 'dark' | 'system' | null {
  if (rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system') {
    return rawTheme
  }

  return null
}

export function backendChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ORXA_PORT
  delete env.ORXA_AUTH_TOKEN
  delete env.ORXA_MODE
  delete env.ORXA_NO_BROWSER
  delete env.ORXA_HOST
  delete env.ORXA_DESKTOP_WS_URL
  return env
}
