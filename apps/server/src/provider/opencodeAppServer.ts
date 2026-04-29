/**
 * Subprocess lifecycle for `opencode serve`.
 *
 * Mirrors `codexAppServer.ts` in shape but is thinner because the opencode
 * SDK owns the wire protocol. We only need to:
 *  - acquire a free localhost port
 *  - spawn `opencode serve --port <port>`
 *  - poll the HTTP root until the server answers (or time out)
 *  - construct an `OpencodeClient` pointed at the local port
 *  - hand back `{ client, port, shutdown }`
 *
 * `probeOpencodeAuth` reuses `startOpencodeServer` for a one-shot lookup of
 * the configured nested LLM providers. The auth probe is the only place this
 * file talks to the SDK; runtime adapters use `client` directly.
 *
 * Promise-based on purpose: Effect wraps it later in `acquireRelease`.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createServer } from 'node:net'
import {
  createOpencodeClient as defaultCreateOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2/client'

import { killChildProcessTree, type KillableChildProcess } from '../processTreeKill'

const READINESS_TIMEOUT_MS = 15_000
const READINESS_POLL_INTERVAL_MS = 100
const SHUTDOWN_GRACE_MS = 2_000
const SHUTDOWN_HARD_KILL_MS = 1_000

/**
 * Hard allow-list of environment variables propagated into the
 * `opencode serve` subprocess. Anything outside this set — especially
 * provider API keys like `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`,
 * `OPENAI_API_KEY`, etc. — must never reach the child, because opencode
 * will silently auto-register nested providers based on ambient env.
 *
 * Keep this list tight. If a new key is needed, add it here explicitly.
 */
const OPENCODE_ENV_ALLOWLIST: ReadonlyArray<string> = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LC_COLLATE',
  'TERM',
  'SHELL',
]

/**
 * Build a sanitized env for the opencode subprocess. Only allow-listed keys
 * from the parent `process.env` are propagated, and only when actually set
 * (missing keys are not injected as empty strings). `overrides` is layered on
 * top and may introduce keys outside the allow-list intentionally (e.g. tests
 * or scoped env like `OPENCODE_CONFIG`).
 */
export function buildSanitizedOpencodeEnv(
  overrides?: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {}
  for (const key of OPENCODE_ENV_ALLOWLIST) {
    const value = source[key]
    if (typeof value === 'string') {
      sanitized[key] = value
    }
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        sanitized[key] = value
      }
    }
  }
  return sanitized
}

export interface SpawnedOpencodeProcess extends KillableChildProcess {
  readonly stderr: ChildProcess['stderr']
  readonly stdout: ChildProcess['stdout']
  once(event: 'error', listener: (error: Error) => void): unknown
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown
  removeAllListeners(event?: string): unknown
}

export type OpencodeSpawner = (
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
) => SpawnedOpencodeProcess

export type OpencodeClientFactory = (config: { baseUrl: string }) => OpencodeClient

export interface StartOpencodeServerInput {
  readonly binaryPath: string
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly signal?: AbortSignal | undefined
  readonly spawner?: OpencodeSpawner | undefined
  readonly clientFactory?: OpencodeClientFactory | undefined
  readonly readinessTimeoutMs?: number | undefined
  readonly readinessPollIntervalMs?: number | undefined
  readonly readinessProbe?: ((url: string, signal: AbortSignal) => Promise<boolean>) | undefined
}

export interface StartedOpencodeServer {
  readonly client: OpencodeClient
  readonly port: number
  readonly pid: number | undefined
  readonly shutdown: () => Promise<void>
}

export interface ProbeOpencodeAuthInput {
  readonly binaryPath: string
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly signal?: AbortSignal | undefined
  readonly spawner?: OpencodeSpawner | undefined
  readonly clientFactory?: OpencodeClientFactory | undefined
  readonly readinessTimeoutMs?: number | undefined
  readonly readinessProbe?: ((url: string, signal: AbortSignal) => Promise<boolean>) | undefined
}

export interface ProbeOpencodeAuthResult {
  readonly configuredProviders: ReadonlyArray<string>
}

const defaultSpawner: OpencodeSpawner = (binaryPath, args, options) =>
  nodeSpawn(binaryPath, args, options) as SpawnedOpencodeProcess

async function defaultReadinessProbe(url: string, signal: AbortSignal): Promise<boolean> {
  // Hit the SDK-documented `/global/health` endpoint rather than `/`. The
  // health endpoint only returns `{ healthy: true, version }` once the server
  // has finished bootstrapping; `/` can 200 before the workspace is fully
  // initialised and lead us to resolve readiness before opencode can actually
  // accept a `session.prompt` call.
  try {
    const response = await fetch(`${url}/global/health`, { signal, method: 'GET' })
    if (!response.ok) {
      response.body?.cancel().catch(() => {})
      return false
    }
    const body = (await response.json().catch(() => null)) as { healthy?: unknown } | null
    return body?.healthy === true
  } catch {
    return false
  }
}

function acquireFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to acquire a free localhost port for opencode serve.'))
        return
      }
      const { port } = address
      server.close(closeError => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(port)
      })
    })
  })
}

interface WaitForReadyInput {
  readonly url: string
  readonly probe: (url: string, signal: AbortSignal) => Promise<boolean>
  readonly timeoutMs: number
  readonly intervalMs: number
  readonly externalSignal?: AbortSignal | undefined
  readonly isChildAlive: () => boolean
}

async function waitForReady(input: WaitForReadyInput): Promise<void> {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    if (input.externalSignal?.aborted) {
      throw new Error('opencode serve readiness wait aborted by caller.')
    }
    if (!input.isChildAlive()) {
      throw new Error('opencode serve exited before becoming ready.')
    }
    const probeController = new AbortController()
    const probeTimeout = setTimeout(() => probeController.abort(), input.intervalMs * 5)
    try {
      const ready = await input.probe(input.url, probeController.signal)
      if (ready) return
    } finally {
      clearTimeout(probeTimeout)
    }
    await delay(input.intervalMs)
  }
  throw new Error(
    `opencode serve did not become ready at ${input.url} within ${input.timeoutMs}ms.`
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createShutdown(child: SpawnedOpencodeProcess): () => Promise<void> {
  let shuttingDown: Promise<void> | null = null
  return () => {
    if (shuttingDown) return shuttingDown
    shuttingDown = (async () => {
      if (child.pid === undefined) return

      // Resolves when the child actually exits.
      let exited = false
      const exitPromise = new Promise<void>(resolve => {
        child.once('exit', () => {
          exited = true
          resolve()
        })
      })

      const waitFor = (ms: number): Promise<void> =>
        new Promise(resolve => {
          const timer = setTimeout(resolve, ms)
          timer.unref?.()
        })

      // Step 1: graceful SIGTERM to the entire process group. The child is
      // spawned with `detached: true` (Unix) so its PGID equals its PID;
      // signalling the group reaches every descendant opencode forked
      // (workers, plugins, watchers) instead of just the immediate parent.
      try {
        killChildProcessTree(child, 'SIGTERM', { viaProcessGroup: true })
      } catch {
        // Process may already be gone.
      }
      await Promise.race([exitPromise, waitFor(SHUTDOWN_GRACE_MS)])
      if (exited) return

      // Step 2: SIGKILL — opencode serve has been observed to ignore
      // SIGTERM, leaving orphaned subprocesses across long-running parents.
      try {
        killChildProcessTree(child, 'SIGKILL', { viaProcessGroup: true })
      } catch {
        // Process may already be gone.
      }
      await Promise.race([exitPromise, waitFor(SHUTDOWN_HARD_KILL_MS)])
    })()
    return shuttingDown
  }
}

interface SpawnContext {
  readonly child: SpawnedOpencodeProcess
  readonly alive: { value: boolean }
  readonly stderr: { value: string }
}

function spawnOpencodeServe(input: {
  binaryPath: string
  port: number
  env?: NodeJS.ProcessEnv | undefined
  spawner: OpencodeSpawner
}): SpawnContext {
  const child = input.spawner(input.binaryPath, ['serve', '--port', String(input.port)], {
    env: buildSanitizedOpencodeEnv(input.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    // Unix only: make the child a process group leader (PGID === PID) so
    // we can signal every descendant opencode forks. Windows already gets
    // tree-kill via `taskkill /T` and `detached: true` would pop a console.
    detached: process.platform !== 'win32',
  })
  const alive = { value: true }
  const stderr = { value: '' }
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr.value += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (stderr.value.length > 4096) {
      stderr.value = stderr.value.slice(-4096)
    }
  })
  child.once('exit', () => {
    alive.value = false
  })
  child.once('error', () => {
    alive.value = false
  })
  return { child, alive, stderr }
}

export async function startOpencodeServer(
  input: StartOpencodeServerInput
): Promise<StartedOpencodeServer> {
  const spawner = input.spawner ?? defaultSpawner
  const clientFactory = input.clientFactory ?? defaultCreateOpencodeClient
  const readinessProbe = input.readinessProbe ?? defaultReadinessProbe
  const timeoutMs = input.readinessTimeoutMs ?? READINESS_TIMEOUT_MS
  const intervalMs = input.readinessPollIntervalMs ?? READINESS_POLL_INTERVAL_MS

  if (input.signal?.aborted) {
    throw new Error('opencode serve start aborted before spawn.')
  }

  const port = await acquireFreePort()
  const ctx = spawnOpencodeServe({
    binaryPath: input.binaryPath,
    port,
    env: input.env,
    spawner,
  })
  const shutdown = createShutdown(ctx.child)

  const spawnErrorPromise = new Promise<never>((_, reject) => {
    ctx.child.once('error', error => {
      reject(
        error instanceof Error
          ? new Error(`opencode serve failed to spawn: ${error.message}`)
          : new Error(`opencode serve failed to spawn: ${String(error)}`)
      )
    })
  })

  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await Promise.race([
      spawnErrorPromise,
      waitForReady({
        url: baseUrl,
        probe: readinessProbe,
        timeoutMs,
        intervalMs,
        externalSignal: input.signal,
        isChildAlive: () => ctx.alive.value,
      }),
    ])
  } catch (error) {
    await shutdown()
    const tail = ctx.stderr.value.trim()
    const suffix = tail.length > 0 ? ` Last stderr: ${tail}` : ''
    throw error instanceof Error ? new Error(`${error.message}${suffix}`) : new Error(String(error))
  }

  const client = clientFactory({ baseUrl })
  return { client, port, pid: ctx.child.pid, shutdown }
}

interface ProviderListResponseLike {
  readonly data?: { readonly connected?: ReadonlyArray<string> }
  readonly error?: unknown
}

/**
 * Shared helper for unwrapping opencode SDK response envelopes that carry
 * `{ error?, data? }`. Throws with a readable detail string prefixed by the
 * calling surface (e.g. `opencode provider.list`). Exported so sibling
 * modules (`opencodeDiscovery`) can reuse the same extraction contract
 * without duplicating the message-vs-json-stringify branch.
 */
export function throwIfOpencodeResponseError(
  response: { readonly error?: unknown },
  surface: string
): void {
  if (response.error !== undefined && response.error !== null) {
    const detail =
      typeof response.error === 'object' && response.error !== null && 'message' in response.error
        ? String((response.error as { message?: unknown }).message)
        : JSON.stringify(response.error)
    throw new Error(`${surface} failed: ${detail}`)
  }
}

function readConfiguredProviders(response: ProviderListResponseLike): ReadonlyArray<string> {
  throwIfOpencodeResponseError(response, 'opencode provider.list')
  const connected = response.data?.connected
  return Array.isArray(connected) ? connected.slice() : []
}

export async function probeOpencodeAuth(
  input: ProbeOpencodeAuthInput
): Promise<ProbeOpencodeAuthResult> {
  const started = await startOpencodeServer({
    binaryPath: input.binaryPath,
    env: input.env,
    signal: input.signal,
    spawner: input.spawner,
    clientFactory: input.clientFactory,
    readinessTimeoutMs: input.readinessTimeoutMs,
    readinessProbe: input.readinessProbe,
  })
  try {
    const result = (await started.client.provider.list()) as ProviderListResponseLike
    return { configuredProviders: readConfiguredProviders(result) }
  } finally {
    await started.shutdown()
  }
}
