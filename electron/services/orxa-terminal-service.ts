import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import type {
  OrxaEvent,
  OrxaTerminalOwner,
  OrxaTerminalSession,
  TerminalConnectResult,
} from '../../shared/ipc'
import type { PerformanceTelemetryService } from './performance-telemetry-service'
import { spawnNativePty, type NativePtyProcess } from './native-pty'

type TerminalProcess = {
  pid: number
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  onData: (listener: (chunk: string) => void) => void
  onExit: (listener: (event: { exitCode: number | null }) => void) => void
}

type TerminalRecord = {
  session: OrxaTerminalSession
  process: TerminalProcess
  connected: boolean
  bufferedOutput: string[]
  firstOutputRecorded: boolean
}

function resolveTerminalDirectory(input: string) {
  const normalized = path.resolve(input)
  if (!existsSync(normalized)) {
    throw new Error(`Terminal directory does not exist: ${normalized}`)
  }
  return normalized
}

function resolveShellCandidates() {
  const rawCandidates = [
    process.platform === 'win32' ? process.env.ComSpec : undefined,
    process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh',
    process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    process.platform === 'win32' ? undefined : '/bin/sh',
    process.env.SHELL,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)

  const deduped = [...new Set(rawCandidates.map(entry => entry.trim()))]
  return deduped.filter(entry => {
    if (!path.isAbsolute(entry)) {
      return true
    }
    return existsSync(entry)
  })
}

function resolveArgs(shell: string) {
  if (process.platform === 'win32') {
    return shell.toLowerCase().includes('powershell') ? ['-NoLogo'] : []
  }
  return ['-l']
}

function wrapNativePtyProcess(processHandle: NativePtyProcess): TerminalProcess {
  return {
    pid: processHandle.pid,
    write: data => processHandle.write(data),
    resize: (cols, rows) => processHandle.resize(Math.max(1, cols), Math.max(1, rows)),
    kill: () => processHandle.kill(),
    onData: listener => {
      processHandle.onData(listener)
    },
    onExit: listener => {
      processHandle.onExit(({ exitCode }) => listener({ exitCode: exitCode ?? null }))
    },
  }
}

function wrapScriptProcess(processHandle: ChildProcessWithoutNullStreams): TerminalProcess {
  return {
    pid: processHandle.pid ?? -1,
    write: data => {
      processHandle.stdin.write(data)
    },
    resize: () => {
      // BSD script does not expose a clean resize hook. Keep this as a no-op
      // for now; shells still function, but full-screen TUIs may not track size.
    },
    kill: () => {
      processHandle.kill('SIGTERM')
    },
    onData: listener => {
      processHandle.stdout.on('data', chunk => listener(chunk.toString()))
      processHandle.stderr.on('data', chunk => listener(chunk.toString()))
    },
    onExit: listener => {
      processHandle.on('exit', exitCode => listener({ exitCode: exitCode ?? null }))
    },
  }
}

function spawnFallbackScriptPty(
  shell: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
) {
  if (process.platform !== 'darwin') {
    throw new Error('script PTY fallback is only available on macOS')
  }
  const scriptBinary = '/usr/bin/script'
  const processHandle = spawn(scriptBinary, ['-q', '/dev/null', shell, ...args], {
    cwd,
    env,
    stdio: 'pipe',
  })
  return wrapScriptProcess(processHandle)
}

function createTerminalSession(
  directory: string,
  cwd: string,
  title: string | undefined,
  owner: OrxaTerminalOwner,
  processHandle: TerminalProcess
): OrxaTerminalSession {
  return {
    id: crypto.randomUUID(),
    directory,
    cwd,
    title: title?.trim() || 'Terminal',
    owner,
    status: 'running',
    pid: processHandle.pid,
    exitCode: null,
    createdAt: Date.now(),
  }
}

export class OrxaTerminalService {
  private sessions = new Map<string, TerminalRecord>()

  onEvent?: (event: OrxaEvent) => void
  performanceTelemetryService?: PerformanceTelemetryService

  private recordPerf(
    metric:
      | 'terminal.service.create_ms'
      | 'terminal.service.connect_ms'
      | 'terminal.service.resize_ms'
      | 'terminal.service.close_ms'
      | 'terminal.write_ms'
      | 'terminal.write_count'
      | 'terminal.create_to_first_output_ms',
    value: number,
    unit: 'ms' | 'count',
    outcome: 'ok' | 'error' = 'ok'
  ) {
    this.performanceTelemetryService?.record({
      surface: 'terminal',
      metric,
      kind: unit === 'count' ? 'counter' : 'span',
      value,
      unit,
      outcome,
      process: 'main',
      component: 'orxa-terminal-service',
    })
  }

  listPtys(directory: string, owner: OrxaTerminalOwner = 'workspace') {
    const normalizedDirectory = resolveTerminalDirectory(directory)
    return [...this.sessions.values()]
      .map(entry => entry.session)
      .filter(entry => entry.directory === normalizedDirectory && entry.owner === owner)
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  createPty(
    directory: string,
    cwd?: string,
    title?: string,
    owner: OrxaTerminalOwner = 'workspace'
  ) {
    const startedAt = performance.now()
    const normalizedDirectory = resolveTerminalDirectory(directory)
    const normalizedCwd = resolveTerminalDirectory(cwd ?? normalizedDirectory)
    const shells = resolveShellCandidates()
    const attemptedShells: string[] = []
    const env = {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
      COLORTERM: process.env.COLORTERM || 'truecolor',
      HOME: process.env.HOME || homedir(),
    }

    let processHandle: TerminalProcess | null = null
    let lastError: unknown
    for (const shell of shells) {
      attemptedShells.push(shell)
      try {
        const shellArgs = resolveArgs(shell)
        try {
          processHandle = wrapNativePtyProcess(
            spawnNativePty(shell, shellArgs, {
              name: 'xterm-256color',
              cols: 80,
              rows: 24,
              cwd: normalizedCwd,
              env,
            })
          )
        } catch (nativeError) {
          lastError = nativeError
          processHandle = spawnFallbackScriptPty(shell, shellArgs, normalizedCwd, env)
        }
        break
      } catch (error) {
        lastError = error
      }
    }

    if (!processHandle) {
      const attempted = attemptedShells.join(', ') || '(none)'
      const message =
        lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')
      throw new Error(
        `Failed to start terminal shell in ${normalizedCwd}. Tried: ${attempted}. Last error: ${message}`
      )
    }

    const session = createTerminalSession(
      normalizedDirectory,
      normalizedCwd,
      title,
      owner,
      processHandle
    )
    const { id } = session

    const record: TerminalRecord = {
      session,
      process: processHandle,
      connected: false,
      bufferedOutput: [],
      firstOutputRecorded: false,
    }

    processHandle.onData(chunk => {
      if (!record.firstOutputRecorded) {
        record.firstOutputRecorded = true
        this.recordPerf(
          'terminal.create_to_first_output_ms',
          Math.max(0, Date.now() - record.session.createdAt),
          'ms'
        )
      }
      if (record.connected) {
        this.emit({
          type: 'pty.output',
          payload: {
            ptyID: id,
            directory: normalizedDirectory,
            chunk,
          },
        })
        return
      }
      record.bufferedOutput.push(chunk)
    })

    processHandle.onExit(({ exitCode }) => {
      const current = this.sessions.get(id)
      if (!current) {
        return
      }
      current.session = {
        ...current.session,
        status: 'exited',
        exitCode: exitCode ?? null,
      }
      this.emit({
        type: 'pty.closed',
        payload: {
          ptyID: id,
          directory: normalizedDirectory,
        },
      })
    })

    this.sessions.set(id, record)
    this.recordPerf('terminal.service.create_ms', performance.now() - startedAt, 'ms')
    return session
  }

  connectPty(directory: string, ptyID: string): TerminalConnectResult {
    const startedAt = performance.now()
    const normalizedDirectory = resolveTerminalDirectory(directory)
    const record = this.getRecord(normalizedDirectory, ptyID)
    if (record.connected) {
      const result = {
        ptyID,
        directory: normalizedDirectory,
        connected: true,
      }
      this.recordPerf('terminal.service.connect_ms', performance.now() - startedAt, 'ms')
      return result
    }

    record.connected = true
    const buffered = record.bufferedOutput.join('')
    record.bufferedOutput = []
    if (buffered.length > 0) {
      setTimeout(() => {
        const current = this.sessions.get(ptyID)
        if (!current || !current.connected || current.session.directory !== normalizedDirectory) {
          return
        }
        this.emit({
          type: 'pty.output',
          payload: {
            ptyID,
            directory: normalizedDirectory,
            chunk: buffered,
          },
        })
      }, 0)
    }

    const result = {
      ptyID,
      directory: normalizedDirectory,
      connected: true,
    }
    this.recordPerf('terminal.service.connect_ms', performance.now() - startedAt, 'ms')
    return result
  }

  writePty(directory: string, ptyID: string, data: string) {
    const startedAt = performance.now()
    const normalizedDirectory = resolveTerminalDirectory(directory)
    const record = this.getRecord(normalizedDirectory, ptyID)
    if (record.session.status !== 'running') {
      return false
    }
    record.process.write(data)
    this.recordPerf('terminal.write_ms', performance.now() - startedAt, 'ms')
    this.recordPerf('terminal.write_count', 1, 'count')
    return true
  }

  resizePty(directory: string, ptyID: string, cols: number, rows: number) {
    const startedAt = performance.now()
    const normalizedDirectory = resolveTerminalDirectory(directory)
    const record = this.getRecord(normalizedDirectory, ptyID)
    if (record.session.status !== 'running') {
      return false
    }
    record.process.resize(Math.max(1, cols), Math.max(1, rows))
    this.recordPerf('terminal.service.resize_ms', performance.now() - startedAt, 'ms')
    return true
  }

  closePty(directory: string, ptyID: string) {
    const startedAt = performance.now()
    const normalizedDirectory = resolveTerminalDirectory(directory)
    const record = this.getRecord(normalizedDirectory, ptyID)
    this.sessions.delete(ptyID)
    if (record.session.status === 'running') {
      record.process.kill()
    }
    this.recordPerf('terminal.service.close_ms', performance.now() - startedAt, 'ms')
    return true
  }

  private getRecord(directory: string, ptyID: string) {
    const record = this.sessions.get(ptyID)
    if (!record || record.session.directory !== directory) {
      throw new Error(`Terminal not found: ${ptyID}`)
    }
    return record
  }

  private emit(event: OrxaEvent) {
    this.onEvent?.(event)
  }
}
