import * as ChildProcess from 'node:child_process'
import * as FS from 'node:fs'

import { app } from 'electron'

import {
  backendChildEnv,
  captureBackendOutput,
  writeBackendSessionBoundary,
  type DesktopLoggingState,
} from './main.logging'

export interface BackendConfig {
  readonly baseDir: string
  readonly appRunId: string
}

export interface BackendHost {
  readonly config: BackendConfig
  readonly logging: DesktopLoggingState
  isQuitting(): boolean
  resolveBackendEntry(): string
  resolveBackendCwd(): string
  getBackendPort(): number
  getBackendAuthToken(): string
}

export interface BackendController {
  start(): void
  stop(): void
  stopAndWaitForExit(timeoutMs?: number): Promise<void>
}

interface BackendRuntime {
  host: BackendHost
  process: ChildProcess.ChildProcess | null
  restartTimer: ReturnType<typeof setTimeout> | null
  restartAttempt: number
}

function scheduleRestart(rt: BackendRuntime, reason: string): void {
  if (rt.host.isQuitting() || rt.restartTimer) return
  const delayMs = Math.min(500 * 2 ** rt.restartAttempt, 10_000)
  rt.restartAttempt += 1
  console.error(`[desktop] backend exited unexpectedly (${reason}); restarting in ${delayMs}ms`)
  rt.restartTimer = setTimeout(() => {
    rt.restartTimer = null
    start(rt)
  }, delayMs)
}

function writeBootstrapPayload(bootstrapStream: NodeJS.WritableStream, rt: BackendRuntime): void {
  bootstrapStream.write(
    `${JSON.stringify({
      mode: 'desktop',
      noBrowser: true,
      port: rt.host.getBackendPort(),
      orxaHome: rt.host.config.baseDir,
      authToken: rt.host.getBackendAuthToken(),
    })}\n`
  )
  bootstrapStream.end()
}

function attachChildHandlers(rt: BackendRuntime, child: ChildProcess.ChildProcess): void {
  let backendSessionClosed = false
  const closeBackendSession = (details: string): void => {
    if (backendSessionClosed) return
    backendSessionClosed = true
    writeBackendSessionBoundary(rt.host.logging, rt.host.config.appRunId, 'END', details)
  }
  writeBackendSessionBoundary(
    rt.host.logging,
    rt.host.config.appRunId,
    'START',
    `pid=${child.pid ?? 'unknown'} port=${rt.host.getBackendPort()} cwd=${rt.host.resolveBackendCwd()}`
  )
  captureBackendOutput(rt.host.logging, child)

  child.once('spawn', () => {
    rt.restartAttempt = 0
  })
  child.on('error', error => {
    if (rt.process === child) {
      rt.process = null
    }
    closeBackendSession(`pid=${child.pid ?? 'unknown'} error=${error.message}`)
    scheduleRestart(rt, error.message)
  })
  child.on('exit', (code, signal) => {
    if (rt.process === child) {
      rt.process = null
    }
    closeBackendSession(
      `pid=${child.pid ?? 'unknown'} code=${code ?? 'null'} signal=${signal ?? 'null'}`
    )
    if (rt.host.isQuitting()) return
    scheduleRestart(rt, `code=${code ?? 'null'} signal=${signal ?? 'null'}`)
  })
}

function start(rt: BackendRuntime): void {
  if (rt.host.isQuitting() || rt.process) return
  const backendEntry = rt.host.resolveBackendEntry()
  if (!FS.existsSync(backendEntry)) {
    scheduleRestart(rt, `missing server entry at ${backendEntry}`)
    return
  }
  const captureBackendLogs = app.isPackaged && rt.host.logging.backendLogSink !== null
  const child = ChildProcess.spawn(process.execPath, [backendEntry, '--bootstrap-fd', '3'], {
    cwd: rt.host.resolveBackendCwd(),
    env: { ...backendChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
    stdio: captureBackendLogs
      ? ['ignore', 'pipe', 'pipe', 'pipe']
      : ['ignore', 'inherit', 'inherit', 'pipe'],
  })
  const bootstrapStream = child.stdio[3]
  if (bootstrapStream && 'write' in bootstrapStream) {
    writeBootstrapPayload(bootstrapStream as NodeJS.WritableStream, rt)
  } else {
    child.kill('SIGTERM')
    scheduleRestart(rt, 'missing desktop bootstrap pipe')
    return
  }
  rt.process = child
  attachChildHandlers(rt, child)
}

function stop(rt: BackendRuntime): void {
  if (rt.restartTimer) {
    clearTimeout(rt.restartTimer)
    rt.restartTimer = null
  }
  const child = rt.process
  rt.process = null
  if (!child) return
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }, 2_000).unref()
  }
}

async function stopAndWaitForExit(rt: BackendRuntime, timeoutMs = 5_000): Promise<void> {
  if (rt.restartTimer) {
    clearTimeout(rt.restartTimer)
    rt.restartTimer = null
  }
  const child = rt.process
  rt.process = null
  if (!child) return
  if (child.exitCode !== null || child.signalCode !== null) return

  await new Promise<void>(resolve => {
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null
    let exitTimeoutTimer: ReturnType<typeof setTimeout> | null = null
    const settle = (): void => {
      if (settled) return
      settled = true
      child.off('exit', onExit)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (exitTimeoutTimer) clearTimeout(exitTimeoutTimer)
      resolve()
    }
    const onExit = (): void => settle()
    child.once('exit', onExit)
    child.kill('SIGTERM')
    forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }, 2_000)
    forceKillTimer.unref()
    exitTimeoutTimer = setTimeout(settle, timeoutMs)
    exitTimeoutTimer.unref()
  })
}

export function createBackendController(host: BackendHost): BackendController {
  const rt: BackendRuntime = {
    host,
    process: null,
    restartTimer: null,
    restartAttempt: 0,
  }
  return {
    start: () => start(rt),
    stop: () => stop(rt),
    stopAndWaitForExit: timeoutMs => stopAndWaitForExit(rt, timeoutMs),
  }
}
