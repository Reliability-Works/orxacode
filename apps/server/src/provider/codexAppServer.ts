import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from './codexAccount'
import { killChildProcessTree } from '../processTreeKill'

interface JsonRpcProbeResponse {
  readonly id?: unknown
  readonly result?: unknown
  readonly error?: {
    readonly message?: unknown
  }
}

function readErrorMessage(response: JsonRpcProbeResponse): string | undefined {
  return typeof response.error?.message === 'string' ? response.error.message : undefined
}

function createCodexProbeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(`Codex account probe failed: ${String(error)}.`)
}

function createCodexProbeEnv(homePath?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(homePath ? { CODEX_HOME: homePath } : {}),
  }
}

function writeProbeMessage(
  child: ChildProcessWithoutNullStreams,
  message: unknown,
  fail: (error: unknown) => void
): void {
  if (!child.stdin.writable) {
    fail(new Error('Cannot write to codex app-server stdin.'))
    return
  }
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

function handleProbeResponse(input: {
  fail: (error: unknown) => void
  finishWithResult: (result: CodexAccountSnapshot) => void
  line: string
  writeMessage: (message: unknown) => void
}): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.line)
  } catch {
    input.fail(new Error('Received invalid JSON from codex app-server during account probe.'))
    return
  }

  if (!parsed || typeof parsed !== 'object') {
    return
  }

  const response = parsed as JsonRpcProbeResponse
  if (response.id === 1) {
    const errorMessage = readErrorMessage(response)
    if (errorMessage) {
      input.fail(new Error(`initialize failed: ${errorMessage}`))
      return
    }

    input.writeMessage({ method: 'initialized' })
    input.writeMessage({ id: 2, method: 'account/read', params: {} })
    return
  }

  if (response.id === 2) {
    const errorMessage = readErrorMessage(response)
    if (errorMessage) {
      input.fail(new Error(`account/read failed: ${errorMessage}`))
      return
    }

    input.finishWithResult(resolveCodexAccountProbe(response))
  }
}

function resolveCodexAccountProbe(response: JsonRpcProbeResponse): CodexAccountSnapshot {
  return readCodexAccountSnapshot(response.result)
}

function registerAbortHandler(
  signal: AbortSignal | undefined,
  fail: (error: unknown) => void
): boolean {
  if (signal?.aborted) {
    fail(new Error('Codex account probe aborted.'))
    return true
  }
  signal?.addEventListener('abort', () => fail(new Error('Codex account probe aborted.')))
  return false
}

export function buildCodexInitializeParams() {
  return {
    clientInfo: {
      name: 'orxa_code_desktop',
      title: 'Orxa Code Desktop',
      version: '0.1.0',
    },
    capabilities: {
      experimentalApi: true,
    },
  } as const
}

export function killCodexChildProcess(child: ChildProcessWithoutNullStreams): void {
  killChildProcessTree(child)
}

export async function probeCodexAccount(input: {
  readonly binaryPath: string
  readonly homePath?: string
  readonly signal?: AbortSignal
}): Promise<CodexAccountSnapshot> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ['app-server'], {
      env: createCodexProbeEnv(input.homePath),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    const output = readline.createInterface({ input: child.stdout })

    let completed = false

    const cleanup = () => {
      output.removeAllListeners()
      output.close()
      child.removeAllListeners()
      if (!child.killed) {
        killCodexChildProcess(child)
      }
    }

    const finish = (callback: () => void) => {
      if (completed) return
      completed = true
      cleanup()
      callback()
    }

    const fail = (error: unknown) => finish(() => reject(createCodexProbeError(error)))
    const finishWithResult = (result: CodexAccountSnapshot) => finish(() => resolve(result))

    if (registerAbortHandler(input.signal, fail)) {
      return
    }
    const writeMessage = (message: unknown) => writeProbeMessage(child, message, fail)

    output.on('line', line => handleProbeResponse({ fail, finishWithResult, line, writeMessage }))

    child.once('error', fail)
    child.once('exit', (code, signal) => {
      if (completed) return
      fail(
        new Error(
          `codex app-server exited before probe completed (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`
        )
      )
    })

    writeMessage({
      id: 1,
      method: 'initialize',
      params: buildCodexInitializeParams(),
    })
  })
}
