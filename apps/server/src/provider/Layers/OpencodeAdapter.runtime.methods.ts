/**
 * Opencode adapter runtime method bindings.
 *
 * Hosts the `OpencodeAdapterShape` method implementations that operate on an
 * already-started session and have no business living inside the session
 * lifecycle, turn dispatch, or event-pump modules: `readThread`,
 * `rollbackThread`, `stopSession`, `listSessions`, `hasSession`, `stopAll`,
 * `respondToRequest`, and `respondToUserInput`.
 *
 * Mirrors `ClaudeAdapter.runtime.methods.ts` but is much thinner because:
 *   - opencode does not yet expose interactive approvals on the SDK event
 *     channel, so `respondToRequest` and `respondToUserInput` surface a
 *     `ProviderAdapterRequestError` describing the unsupported surface
 *     (using the helper from `runtime.messages.ts`).
 *   - opencode does not maintain a per-turn item history at the runtime
 *     layer, so `readThread` returns an empty turn array; the orchestration
 *     layer is the source of truth for thread snapshots in this provider.
 *   - `rollbackThread` is structurally a no-op because we have nothing to
 *     splice; it returns the same empty snapshot.
 *
 * @module OpencodeAdapter.runtime.methods
 */
import { type ApprovalRequestId, type ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { ProviderAdapterRequestError } from '../Errors.ts'
import type { OpencodeAdapterShape } from '../Services/OpencodeAdapter.ts'
import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { requireOpencodeSession } from './OpencodeAdapter.runtime.eventBase.ts'
import { failUnsupportedUserInput } from './OpencodeAdapter.runtime.messages.ts'
import { stopSessionInternal } from './OpencodeAdapter.runtime.session.ts'
import { PROVIDER, type OpencodeSessionContext } from './OpencodeAdapter.types.ts'

function emptySnapshot(threadId: ThreadId): {
  readonly threadId: ThreadId
  readonly turns: ReadonlyArray<{ readonly id: never; readonly items: ReadonlyArray<unknown> }>
} {
  return { threadId, turns: [] }
}

export const readThread =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['readThread'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.map((context: OpencodeSessionContext) => emptySnapshot(context.session.threadId))
    )

export const rollbackThread =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['rollbackThread'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.map((context: OpencodeSessionContext) => emptySnapshot(context.session.threadId))
    )

export const respondToRequest =
  (): OpencodeAdapterShape['respondToRequest'] =>
  (threadId: ThreadId, requestId: ApprovalRequestId) =>
    Effect.fail(
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: 'opencode:respondToRequest',
        detail:
          `Opencode adapter does not support interactive approval decisions ` +
          `(thread ${threadId}, request ${requestId}).`,
      })
    )

export const respondToUserInput =
  (): OpencodeAdapterShape['respondToUserInput'] =>
  (threadId: ThreadId, requestId: ApprovalRequestId) =>
    failUnsupportedUserInput(threadId, requestId)

export const stopSession =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['stopSession'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.flatMap(context => stopSessionInternal(deps, context, { emitExitEvent: true }))
    )

export const listSessions =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['listSessions'] =>
  () =>
    Effect.sync(() => Array.from(deps.sessions.values(), context => ({ ...context.session })))

export const hasSession =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['hasSession'] =>
  (threadId: ThreadId) =>
    Effect.sync(() => {
      const context = deps.sessions.get(threadId)
      return context !== undefined && !context.stopped
    })

export const stopAll =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['stopAll'] =>
  () =>
    Effect.forEach(
      deps.sessions,
      ([, context]) => stopSessionInternal(deps, context, { emitExitEvent: true }),
      { discard: true }
    )
