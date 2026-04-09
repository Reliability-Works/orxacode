/**
 * Opencode adapter runtime user-input + assistant message helpers.
 *
 * The opencode adapter's user-facing message surface is much smaller than the
 * Claude adapter's because the opencode SDK collapses every user input into a
 * single `session.prompt(...)` call (handled by `runtime.turns.ts`) and the
 * assistant text deltas are reconstructed inside the f03 pure mapper. There
 * is therefore no streaming user-prompt iterable to manage and no separate
 * assistant-text-block lifecycle to track at the runtime layer.
 *
 * What this module DOES own:
 *   - `respondToUserInputUnsupported` — the canonical "opencode does not
 *     surface structured user-input requests" failure used by
 *     `runtime.methods.ts`. Centralized here so the methods file stays thin
 *     and the failure shape can evolve in one place.
 *   - `buildAssistantDeltaPreview` — pure helper that summarizes the most
 *     recent assistant text observed on a session context for diagnostics
 *     and the streaming integration test. Pure and synchronous: no Effect.
 *
 * Anything that needs the runtime queue, the SDK client, or the partHint
 * cache lives in `runtime.events.ts` (event pump), `runtime.turns.ts`
 * (`session.prompt` dispatch), or `runtime.eventBase.ts` (low-level emitters).
 *
 * @module OpencodeAdapter.runtime.messages
 */
import { type ApprovalRequestId, type ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import { ProviderAdapterRequestError } from '../Errors.ts'
import { PROVIDER, type OpencodeSessionContext } from './OpencodeAdapter.types.ts'

/**
 * Build a `ProviderAdapterRequestError` describing the unsupported user-input
 * surface. The opencode SDK does not currently fan out interactive user-input
 * requests through the `event.subscribe` channel, so any caller invoking
 * `respondToUserInput` is operating on a stale `requestId`. We surface this
 * as a request error rather than a validation error so the orchestration
 * layer routes it through the same retry / surfacing path as a real protocol
 * failure (matching how Claude reports an unknown pending request).
 */
export function unsupportedUserInputError(
  threadId: ThreadId,
  requestId: ApprovalRequestId
): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method: 'opencode:respondToUserInput',
    detail:
      `Opencode adapter does not support structured user-input responses ` +
      `(thread ${threadId}, request ${requestId}).`,
  })
}

/**
 * Effect-wrapped variant. The methods file uses this directly so the
 * `respondToUserInput` implementation stays a single expression and the
 * inferred error channel matches the rest of the adapter shape.
 */
export const failUnsupportedUserInput = (
  threadId: ThreadId,
  requestId: ApprovalRequestId
): Effect.Effect<never, ProviderAdapterRequestError> =>
  Effect.fail(unsupportedUserInputError(threadId, requestId))

/**
 * Synchronous, pure helper that surfaces a short snapshot of what is known
 * about a session's most-recent assistant exchange. Used by the streaming
 * integration test and reachable from diagnostics — never invoked from the
 * hot path.
 */
export interface AssistantDeltaPreview {
  readonly providerSessionId: string
  readonly hasInflightTurn: boolean
  readonly activeTurnId: string | undefined
  readonly knownTokenUsage: boolean
}

export function buildAssistantDeltaPreview(context: OpencodeSessionContext): AssistantDeltaPreview {
  return {
    providerSessionId: context.providerSessionId,
    hasInflightTurn: context.turnState !== undefined,
    activeTurnId: context.turnState !== undefined ? String(context.turnState.turnId) : undefined,
    knownTokenUsage: context.lastKnownTokenUsage !== undefined,
  }
}
