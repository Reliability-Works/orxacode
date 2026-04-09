/**
 * Opencode adapter runtime system + telemetry helpers.
 *
 * The f03 pure mapper already produces the high-volume system signal the
 * adapter needs to surface to the orchestration layer:
 *   - `thread.token-usage.updated` events are derived directly from
 *     completed `message.updated` payloads inside the mapper.
 *   - `session.idle` events get folded into `turn.completed` by the mapper.
 *   - `session.error` events fan out to `runtime.error` + `turn.completed`
 *     ('failed') by the mapper.
 *
 * What the runtime layer still needs is a small bit of state that the pure
 * mapper cannot own (because it has no access to the session context map):
 * we want to know the most-recent token usage snapshot for a thread so the
 * `readThread` method can surface it to callers without re-walking the event
 * log. This module owns that bookkeeping.
 *
 * The helpers here are intentionally synchronous and side-effect-light so the
 * caller decides when to flush the cached snapshot back into the session
 * context. They mirror `ClaudeAdapter.runtime.system.ts` in shape (every
 * function takes the shared deps + context, and the public surface stays
 * declarative) without re-using any of its assistant-text bookkeeping —
 * opencode does not need that path because the mapper already emits
 * `item.completed` for assistant blocks.
 *
 * @module OpencodeAdapter.runtime.system
 */
import { type ThreadTokenUsageSnapshot } from '@orxa-code/contracts'

import type { OpencodeSessionContext } from './OpencodeAdapter.types.ts'

/**
 * Persist the most-recent token usage snapshot on the session context.
 *
 * Called by `runtime.methods.ts` after a `message.updated` event lands so
 * subsequent `readThread` calls can include the snapshot without forcing the
 * caller to drain the runtime event queue.
 */
export function recordTokenUsageSnapshot(
  context: OpencodeSessionContext,
  snapshot: ThreadTokenUsageSnapshot | undefined
): void {
  if (!snapshot) return
  context.lastKnownTokenUsage = snapshot
}

/**
 * Read the cached snapshot back. Returns `undefined` until the first
 * `recordTokenUsageSnapshot` call lands. Pure getter — keeps the methods file
 * agnostic to the context shape.
 */
export function getCachedTokenUsage(
  context: OpencodeSessionContext
): ThreadTokenUsageSnapshot | undefined {
  return context.lastKnownTokenUsage
}

/**
 * Clear the cached snapshot. Invoked from the methods module when a session
 * is being torn down so the WeakMap-style state on the context is left in a
 * clean shape for the GC. Mirrors the partHint cache `clear()` ordering in
 * `runtime.session.ts`.
 */
export function clearCachedTokenUsage(context: OpencodeSessionContext): void {
  context.lastKnownTokenUsage = undefined
}
