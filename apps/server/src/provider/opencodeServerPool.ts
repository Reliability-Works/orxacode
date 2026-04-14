/**
 * Refcounted shared `opencode serve` pool.
 *
 * Opencode is designed for many sessions against a single HTTP serve (that's
 * what the upstream TUI does). Spawning a fresh subprocess per provider
 * session pays the full cold-start cost — port acquisition, process spawn,
 * workspace indexing — on every first message. This pool hoists that cost
 * out of the per-session hot path: the first session to request a serve for
 * a given binary spawns it; subsequent sessions reuse the same HTTP server.
 *
 * Each caller receives a wrapper whose `shutdown()` decrements a refcount
 * rather than killing the subprocess. When the refcount reaches zero we
 * schedule real shutdown after a short grace window so a rapid
 * close-then-open cycle (e.g. archiving a session and opening another in the
 * same project) doesn't re-pay spawn cost.
 *
 * Keyed only by `binaryPath` — the opencode serve accepts a per-request
 * `directory` on session create, so one server can host sessions from many
 * working directories. Env overrides are captured from the first caller;
 * callers after that share the same subprocess env. In practice our callers
 * pass the sanitized env built from `buildSanitizedOpencodeEnv` and don't
 * vary it per-session.
 */
import {
  startOpencodeServer,
  type StartOpencodeServerInput,
  type StartedOpencodeServer,
} from './opencodeAppServer'

const DEFAULT_GRACE_MS = 30_000

interface PoolEntry {
  readonly key: string
  promise: Promise<StartedOpencodeServer>
  refCount: number
  shutdownTimer: ReturnType<typeof setTimeout> | null
  shuttingDown: Promise<void> | null
  pid: number | undefined
}

const pool = new Map<string, PoolEntry>()

function keyFor(binaryPath: string): string {
  return binaryPath
}

function cancelPendingShutdown(entry: PoolEntry): void {
  if (entry.shutdownTimer !== null) {
    clearTimeout(entry.shutdownTimer)
    entry.shutdownTimer = null
  }
}

function scheduleShutdown(entry: PoolEntry, graceMs: number): void {
  cancelPendingShutdown(entry)
  entry.shutdownTimer = setTimeout(() => {
    void finalizeShutdown(entry)
  }, graceMs)
  entry.shutdownTimer.unref?.()
}

async function finalizeShutdown(entry: PoolEntry): Promise<void> {
  if (entry.refCount > 0) return
  if (pool.get(entry.key) !== entry) return
  pool.delete(entry.key)
  entry.shutdownTimer = null
  try {
    const server = await entry.promise
    entry.shuttingDown = server.shutdown()
    await entry.shuttingDown
  } catch {
    // Either spawn failed (already removed) or shutdown raced; nothing to do.
  }
}

function wrapHandle(entry: PoolEntry, server: StartedOpencodeServer): StartedOpencodeServer {
  let released = false
  return {
    client: server.client,
    port: server.port,
    pid: server.pid,
    shutdown: async () => {
      if (released) return
      released = true
      entry.refCount = Math.max(0, entry.refCount - 1)
      if (entry.refCount === 0) {
        scheduleShutdown(entry, DEFAULT_GRACE_MS)
      }
    },
  }
}

/**
 * Acquire a shared `opencode serve` for the given binary. The returned
 * handle's `shutdown()` releases this caller's reference; the subprocess
 * itself only exits once every caller has released and a short grace
 * window has elapsed.
 */
export async function acquireSharedOpencodeServer(
  input: StartOpencodeServerInput
): Promise<StartedOpencodeServer> {
  const key = keyFor(input.binaryPath)
  let entry = pool.get(key)
  if (entry) {
    cancelPendingShutdown(entry)
    entry.refCount += 1
    try {
      const server = await entry.promise
      entry.pid = server.pid
      return wrapHandle(entry, server)
    } catch (error) {
      // The shared spawn failed. Release the refcount we optimistically
      // took and let the caller see the original error.
      entry.refCount = Math.max(0, entry.refCount - 1)
      throw error
    }
  }

  const promise = startOpencodeServer(input)
  entry = {
    key,
    promise,
    refCount: 1,
    shutdownTimer: null,
    shuttingDown: null,
    pid: undefined,
  }
  pool.set(key, entry)

  try {
    const server = await promise
    entry.pid = server.pid
    return wrapHandle(entry, server)
  } catch (error) {
    // Spawn failed — evict so the next acquire retries from scratch.
    if (pool.get(key) === entry) pool.delete(key)
    throw error
  }
}

/**
 * Gracefully shut down every pooled `opencode serve` subprocess. Called from
 * the server's SIGINT/SIGTERM handlers so orphaned children don't survive the
 * parent process. Safe to call multiple times.
 */
export async function shutdownAllPooledOpencodeServers(): Promise<void> {
  const entries = Array.from(pool.values())
  pool.clear()
  await Promise.all(
    entries.map(async entry => {
      cancelPendingShutdown(entry)
      try {
        const server = await entry.promise
        await server.shutdown()
      } catch {
        // ignore
      }
    })
  )
}

/** Test-only alias retained for backward compatibility. */
export const drainOpencodeServerPoolForTests = shutdownAllPooledOpencodeServers

/**
 * Best-effort synchronous SIGTERM to every tracked pooled child. Used from
 * `process.on('exit', ...)` where we can't await. Children that ignore
 * SIGTERM will still be reaped by the OS when this process dies, but only if
 * they weren't detached — which they aren't (default `detached: false`).
 */
export function killAllPooledOpencodeServersSync(): void {
  for (const entry of pool.values()) {
    if (entry.pid !== undefined) {
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch {
        // Process may already be gone.
      }
    }
  }
}

let shutdownHandlersInstalled = false

/**
 * Install process-level signal and exit hooks that drain the opencode pool
 * before this Node process exits. Idempotent. Call once from the server
 * entrypoint.
 */
export function installOpencodeServerPoolShutdownHandlers(): void {
  if (shutdownHandlersInstalled) return
  shutdownHandlersInstalled = true

  // SIGINT/SIGTERM: async drain races alongside Effect's own fiber-interrupt
  // handler; whichever finishes first leaves the other with nothing to do.
  // `exit`: synchronous SIGTERM to any still-tracked child as a
  // belt-and-suspenders for abrupt exits (uncaught exceptions, etc.).
  process.on('SIGINT', () => {
    void shutdownAllPooledOpencodeServers()
  })
  process.on('SIGTERM', () => {
    void shutdownAllPooledOpencodeServers()
  })
  process.on('exit', () => {
    killAllPooledOpencodeServersSync()
  })
}
