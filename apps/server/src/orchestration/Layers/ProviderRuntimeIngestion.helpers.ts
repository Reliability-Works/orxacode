import { CommandId, type ProviderRuntimeEvent, ThreadId, TurnId } from '@orxa-code/contracts'
import { Duration } from 'effect'

import { sameId } from './ReactorIdUtils.ts'

export { sameId }

export const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000
export const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120)
export const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000
export const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120)
export const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000
export const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120)
export const MAX_BUFFERED_ASSISTANT_CHARS = 24_000
export const STRICT_PROVIDER_LIFECYCLE_GUARD =
  process.env.ORXA_STRICT_PROVIDER_LIFECYCLE_GUARD !== '0'

export const providerTurnKey = (threadId: ThreadId, turnId: TurnId): string =>
  `${threadId}:${turnId}`

export const providerCommandId = (event: ProviderRuntimeEvent, tag: string): CommandId =>
  CommandId.makeUnsafe(`provider:${event.eventId}:${tag}:${crypto.randomUUID()}`)

export function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.makeUnsafe(String(value))
}

export function normalizeProposedPlanMarkdown(
  planMarkdown: string | undefined
): string | undefined {
  const trimmed = planMarkdown?.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed
}

export function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`
}

export function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId)
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId)
  }
  if (event.itemId) {
    return `plan:${threadId}:item:${event.itemId}`
  }
  return `plan:${threadId}:event:${event.eventId}`
}

export function normalizeRuntimeTurnState(
  value: string | undefined
): 'completed' | 'failed' | 'interrupted' | 'cancelled' {
  switch (value) {
    case 'failed':
    case 'interrupted':
    case 'cancelled':
    case 'completed':
      return value
    default:
      return 'completed'
  }
}

export function orchestrationSessionStatusFromRuntimeState(
  state: 'starting' | 'running' | 'waiting' | 'ready' | 'interrupted' | 'stopped' | 'error'
): 'starting' | 'running' | 'ready' | 'interrupted' | 'stopped' | 'error' {
  switch (state) {
    case 'starting':
      return 'starting'
    case 'running':
    case 'waiting':
      return 'running'
    case 'ready':
      return 'ready'
    case 'interrupted':
      return 'interrupted'
    case 'stopped':
      return 'stopped'
    case 'error':
      return 'error'
  }
}
