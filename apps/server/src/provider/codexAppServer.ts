import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { readCodexAccountSnapshot, type CodexAccountSnapshot } from './codexAccount'
import { killChildProcessTree } from '../processTreeKill'

export interface CodexListedModel {
  readonly id: string
  readonly displayName: string
  readonly hidden: boolean
  readonly supportedReasoningEfforts: ReadonlyArray<{
    readonly reasoningEffort: string
    readonly description: string | null
  }>
  readonly defaultReasoningEffort: string | null
}

export interface CodexCatalogSnapshot {
  readonly account: CodexAccountSnapshot
  readonly models: ReadonlyArray<CodexListedModel>
}

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

function resolveCodexAccountProbe(response: JsonRpcProbeResponse): CodexAccountSnapshot {
  return readCodexAccountSnapshot(response.result)
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readCodexModelList(response: JsonRpcProbeResponse): ReadonlyArray<CodexListedModel> {
  const record = asObject(response.result)
  const data = Array.isArray(record?.data) ? record.data : []

  return data.flatMap(entry => {
    const model = asObject(entry)
    const id = asString(model?.id)
    if (!id) {
      return []
    }

    const displayName = asString(model?.displayName) ?? id
    const hidden = model?.hidden === true
    const defaultReasoningEffort = asString(model?.defaultReasoningEffort) ?? null
    const supportedReasoningEfforts = Array.isArray(model?.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.flatMap(option => {
          const record = asObject(option)
          const reasoningEffort = asString(record?.reasoningEffort)
          if (!reasoningEffort) {
            return []
          }
          return [
            {
              reasoningEffort,
              description: asString(record?.description) ?? null,
            },
          ]
        })
      : []

    return [
      {
        id,
        displayName,
        hidden,
        supportedReasoningEfforts,
        defaultReasoningEffort,
      } satisfies CodexListedModel,
    ]
  })
}

function handleCatalogProbeLine(input: {
  line: string
  fail: (error: unknown) => void
  writeMessage: (message: unknown) => void
  finishWithResult: () => void
  setAccount: (account: CodexAccountSnapshot) => void
  setModels: (models: ReadonlyArray<CodexListedModel>) => void
}): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(input.line)
  } catch {
    input.fail(new Error('Received invalid JSON from codex app-server during capability probe.'))
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
    input.writeMessage({ id: 3, method: 'model/list', params: { limit: 200 } })
    return
  }

  if (response.id === 2) {
    const errorMessage = readErrorMessage(response)
    if (errorMessage) {
      input.fail(new Error(`account/read failed: ${errorMessage}`))
      return
    }

    input.setAccount(resolveCodexAccountProbe(response))
    input.finishWithResult()
    return
  }

  if (response.id === 3) {
    const errorMessage = readErrorMessage(response)
    if (errorMessage) {
      input.fail(new Error(`model/list failed: ${errorMessage}`))
      return
    }

    input.setModels(readCodexModelList(response))
    input.finishWithResult()
  }
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

export async function probeCodexCatalog(input: {
  readonly binaryPath: string
  readonly homePath?: string
  readonly signal?: AbortSignal
}): Promise<CodexCatalogSnapshot> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.binaryPath, ['app-server'], {
      env: createCodexProbeEnv(input.homePath),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    const output = readline.createInterface({ input: child.stdout })

    let completed = false
    let account: CodexAccountSnapshot | undefined
    let models: ReadonlyArray<CodexListedModel> | undefined

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
    const finishWithResult = () => {
      if (!account || !models) {
        return
      }
      const resolvedAccount = account
      const resolvedModels = models
      finish(() => resolve({ account: resolvedAccount, models: resolvedModels }))
    }

    if (registerAbortHandler(input.signal, fail)) {
      return
    }

    const writeMessage = (message: unknown) => writeProbeMessage(child, message, fail)

    output.on('line', line =>
      handleCatalogProbeLine({
        line,
        fail,
        writeMessage,
        finishWithResult,
        setAccount: nextAccount => {
          account = nextAccount
        },
        setModels: nextModels => {
          models = nextModels
        },
      })
    )

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

export async function probeCodexAccount(input: {
  readonly binaryPath: string
  readonly homePath?: string
  readonly signal?: AbortSignal
}): Promise<CodexAccountSnapshot> {
  return (await probeCodexCatalog(input)).account
}
