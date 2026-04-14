/**
 * Opencode adapter runtime assistant-message helpers.
 *
 * The opencode adapter's user-facing message surface is small: user input
 * flows through `session.promptAsync(...)` (handled by `runtime.turns.ts`)
 * and assistant text deltas are reconstructed inside the f03 pure mapper.
 * Interactive permission + question requests are handled in
 * `runtime.methods.ts` now that opencode exposes them over `event.subscribe`.
 *
 * What this module DOES own:
 *   - `buildAssistantDeltaPreview` — pure helper that summarizes the most
 *     recent assistant text observed on a session context for diagnostics
 *     and the streaming integration test. Pure and synchronous: no Effect.
 *
 * Anything that needs the runtime queue, the SDK client, or the partHint
 * cache lives in `runtime.events.ts` (event pump), `runtime.turns.ts`
 * (`session.promptAsync` dispatch), or `runtime.eventBase.ts` (low-level emitters).
 *
 * @module OpencodeAdapter.runtime.messages
 */
import { type OpencodeSessionContext } from './OpencodeAdapter.types.ts'

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
