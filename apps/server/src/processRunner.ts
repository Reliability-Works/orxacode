import { type ChildProcess as ChildProcessHandle, spawn } from 'node:child_process'

import { killChildProcessTree } from './processTreeKill'

export interface ProcessRunOptions {
  cwd?: string | undefined
  timeoutMs?: number | undefined
  env?: NodeJS.ProcessEnv | undefined
  stdin?: string | undefined
  allowNonZeroExit?: boolean | undefined
  maxBufferBytes?: number | undefined
  outputMode?: 'error' | 'truncate' | undefined
}

export interface ProcessRunResult {
  stdout: string
  stderr: string
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stdoutTruncated?: boolean | undefined
  stderrTruncated?: boolean | undefined
}

interface ProcessRunState {
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
  timedOut: boolean
  settled: boolean
  forceKillTimer: ReturnType<typeof setTimeout> | null
}

function commandLabel(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ')
}

function normalizeSpawnError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to run ${commandLabel(command, args)}.`)
  }

  const maybeCode = (error as NodeJS.ErrnoException).code
  if (maybeCode === 'ENOENT') {
    return new Error(`Command not found: ${command}`)
  }

  return new Error(`Failed to run ${commandLabel(command, args)}: ${error.message}`)
}

export function isWindowsCommandNotFound(code: number | null, stderr: string): boolean {
  if (process.platform !== 'win32') return false
  if (code === 9009) return true
  return /is not recognized as an internal or external command/i.test(stderr)
}

function normalizeExitError(
  command: string,
  args: readonly string[],
  result: ProcessRunResult
): Error {
  if (isWindowsCommandNotFound(result.code, result.stderr)) {
    return new Error(`Command not found: ${command}`)
  }

  const reason = result.timedOut
    ? 'timed out'
    : `failed (code=${result.code ?? 'null'}, signal=${result.signal ?? 'null'})`
  const stderr = result.stderr.trim()
  const detail = stderr.length > 0 ? ` ${stderr}` : ''
  return new Error(`${commandLabel(command, args)} ${reason}.${detail}`)
}

function normalizeStdinError(command: string, args: readonly string[], error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Failed to write stdin for ${commandLabel(command, args)}.`)
  }
  return new Error(`Failed to write stdin for ${commandLabel(command, args)}: ${error.message}`)
}

function normalizeBufferError(
  command: string,
  args: readonly string[],
  stream: 'stdout' | 'stderr',
  maxBufferBytes: number
): Error {
  return new Error(
    `${commandLabel(command, args)} exceeded ${stream} buffer limit (${maxBufferBytes} bytes).`
  )
}

const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024

function killChild(child: ChildProcessHandle, signal: NodeJS.Signals = 'SIGTERM'): void {
  killChildProcessTree(child, signal)
}

function appendChunkWithinLimit(
  target: string,
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number
): {
  next: string
  nextBytes: number
  truncated: boolean
} {
  const remaining = maxBytes - currentBytes
  if (remaining <= 0) {
    return { next: target, nextBytes: currentBytes, truncated: true }
  }
  if (chunk.length <= remaining) {
    return {
      next: `${target}${chunk.toString()}`,
      nextBytes: currentBytes + chunk.length,
      truncated: false,
    }
  }
  return {
    next: `${target}${chunk.subarray(0, remaining).toString()}`,
    nextBytes: currentBytes + remaining,
    truncated: true,
  }
}

function requireChildOutputStream(
  child: ChildProcessHandle,
  stream: 'stdout' | 'stderr'
): NodeJS.ReadableStream {
  const target = stream === 'stdout' ? child.stdout : child.stderr
  if (!target) {
    throw new Error(`Expected child ${stream} pipe to be available.`)
  }
  return target
}

function requireChildInputStream(child: ChildProcessHandle): NodeJS.WritableStream {
  if (!child.stdin) {
    throw new Error('Expected child stdin pipe to be available.')
  }
  return child.stdin
}

function createProcessRunState(): ProcessRunState {
  return {
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    settled: false,
    forceKillTimer: null,
  }
}

function clearProcessRunTimers(
  timeoutTimer: ReturnType<typeof setTimeout>,
  state: ProcessRunState
): void {
  clearTimeout(timeoutTimer)
  if (state.forceKillTimer) {
    clearTimeout(state.forceKillTimer)
  }
}

function finalizeProcessRun(
  state: ProcessRunState,
  timeoutTimer: ReturnType<typeof setTimeout>,
  callback: () => void
): void {
  if (state.settled) return
  state.settled = true
  clearProcessRunTimers(timeoutTimer, state)
  callback()
}

function failProcessRun(
  child: ChildProcessHandle,
  state: ProcessRunState,
  timeoutTimer: ReturnType<typeof setTimeout>,
  reject: (reason?: unknown) => void,
  error: Error
): void {
  killChild(child, 'SIGTERM')
  finalizeProcessRun(state, timeoutTimer, () => {
    reject(error)
  })
}

function appendProcessOutput(input: {
  state: ProcessRunState
  command: string
  args: readonly string[]
  stream: 'stdout' | 'stderr'
  chunk: Buffer | string
  maxBufferBytes: number
  outputMode: 'error' | 'truncate'
}): Error | null {
  const chunkBuffer = typeof input.chunk === 'string' ? Buffer.from(input.chunk) : input.chunk
  const text = chunkBuffer.toString()
  const byteLength = chunkBuffer.length

  if (input.stream === 'stdout') {
    if (input.outputMode === 'truncate') {
      const appended = appendChunkWithinLimit(
        input.state.stdout,
        input.state.stdoutBytes,
        chunkBuffer,
        input.maxBufferBytes
      )
      input.state.stdout = appended.next
      input.state.stdoutBytes = appended.nextBytes
      input.state.stdoutTruncated = input.state.stdoutTruncated || appended.truncated
      return null
    }
    input.state.stdout += text
    input.state.stdoutBytes += byteLength
    if (input.state.stdoutBytes > input.maxBufferBytes) {
      return normalizeBufferError(input.command, input.args, 'stdout', input.maxBufferBytes)
    }
    return null
  }

  if (input.outputMode === 'truncate') {
    const appended = appendChunkWithinLimit(
      input.state.stderr,
      input.state.stderrBytes,
      chunkBuffer,
      input.maxBufferBytes
    )
    input.state.stderr = appended.next
    input.state.stderrBytes = appended.nextBytes
    input.state.stderrTruncated = input.state.stderrTruncated || appended.truncated
    return null
  }
  input.state.stderr += text
  input.state.stderrBytes += byteLength
  if (input.state.stderrBytes > input.maxBufferBytes) {
    return normalizeBufferError(input.command, input.args, 'stderr', input.maxBufferBytes)
  }
  return null
}

function toProcessRunResult(
  state: ProcessRunState,
  code: number | null,
  signal: NodeJS.Signals | null
): ProcessRunResult {
  return {
    stdout: state.stdout,
    stderr: state.stderr,
    code,
    signal,
    timedOut: state.timedOut,
    stdoutTruncated: state.stdoutTruncated,
    stderrTruncated: state.stderrTruncated,
  }
}

function attachProcessOutputListener(input: {
  child: ChildProcessHandle
  stream: 'stdout' | 'stderr'
  state: ProcessRunState
  command: string
  args: readonly string[]
  maxBufferBytes: number
  outputMode: 'error' | 'truncate'
  timeoutTimer: ReturnType<typeof setTimeout>
  reject: (reason?: unknown) => void
}): void {
  const target = requireChildOutputStream(input.child, input.stream)
  target.on('data', (chunk: Buffer | string) => {
    const error = appendProcessOutput({
      state: input.state,
      command: input.command,
      args: input.args,
      stream: input.stream,
      chunk,
      maxBufferBytes: input.maxBufferBytes,
      outputMode: input.outputMode,
    })
    if (error) {
      failProcessRun(input.child, input.state, input.timeoutTimer, input.reject, error)
    }
  })
}

function attachProcessLifecycleListeners(input: {
  child: ChildProcessHandle
  state: ProcessRunState
  command: string
  args: readonly string[]
  options: ProcessRunOptions
  timeoutTimer: ReturnType<typeof setTimeout>
  resolve: (value: ProcessRunResult) => void
  reject: (reason?: unknown) => void
}): void {
  input.child.once('error', error => {
    finalizeProcessRun(input.state, input.timeoutTimer, () => {
      input.reject(normalizeSpawnError(input.command, input.args, error))
    })
  })

  input.child.once('close', (code, signal) => {
    const result = toProcessRunResult(input.state, code, signal)
    finalizeProcessRun(input.state, input.timeoutTimer, () => {
      if (
        !input.options.allowNonZeroExit &&
        (input.state.timedOut || (code !== null && code !== 0))
      ) {
        input.reject(normalizeExitError(input.command, input.args, result))
        return
      }
      input.resolve(result)
    })
  })

  const stdin = requireChildInputStream(input.child)
  stdin.once('error', error => {
    failProcessRun(
      input.child,
      input.state,
      input.timeoutTimer,
      input.reject,
      normalizeStdinError(input.command, input.args, error)
    )
  })
}

function writeProcessStdin(input: {
  child: ChildProcessHandle
  command: string
  args: readonly string[]
  options: ProcessRunOptions
  state: ProcessRunState
  timeoutTimer: ReturnType<typeof setTimeout>
  reject: (reason?: unknown) => void
}): void {
  const stdin = requireChildInputStream(input.child)
  if (input.options.stdin !== undefined) {
    stdin.write(input.options.stdin, error => {
      if (error) {
        failProcessRun(
          input.child,
          input.state,
          input.timeoutTimer,
          input.reject,
          normalizeStdinError(input.command, input.args, error)
        )
        return
      }
      stdin.end()
    })
    return
  }
  stdin.end()
}

function createTimeoutTimer(
  child: ChildProcessHandle,
  state: ProcessRunState,
  timeoutMs: number
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    state.timedOut = true
    killChild(child, 'SIGTERM')
    state.forceKillTimer = setTimeout(() => {
      killChild(child, 'SIGKILL')
    }, 1_000)
  }, timeoutMs)
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessRunOptions = {}
): Promise<ProcessRunResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
  const outputMode = options.outputMode ?? 'error'

  return new Promise<ProcessRunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    })
    const state = createProcessRunState()
    const timeoutTimer = createTimeoutTimer(child, state, timeoutMs)

    attachProcessOutputListener({
      child,
      stream: 'stdout',
      state,
      command,
      args,
      maxBufferBytes,
      outputMode,
      timeoutTimer,
      reject,
    })
    attachProcessOutputListener({
      child,
      stream: 'stderr',
      state,
      command,
      args,
      maxBufferBytes,
      outputMode,
      timeoutTimer,
      reject,
    })
    attachProcessLifecycleListeners({
      child,
      state,
      command,
      args,
      options,
      timeoutTimer,
      resolve,
      reject,
    })
    writeProcessStdin({
      child,
      command,
      args,
      options,
      state,
      timeoutTimer,
      reject,
    })
  })
}
