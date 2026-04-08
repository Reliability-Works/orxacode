/**
 * Shared helpers for assembling Claude runtime event base fields.
 *
 * Centralizes the eventId/provider/createdAt/threadId/turnId prefix used by
 * many runtime event emitters in `ClaudeAdapter.runtime.*`. Pure functions
 * only — no Effect access. Stamp values come from `deps.makeEventStamp()` at
 * the call site.
 *
 * @module ClaudeAdapter.runtime.eventBase
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { EventId } from '@orxa-code/contracts'

import { asCanonicalTurnId, asRuntimeItemId } from './ClaudeAdapter.pure.ts'
import { nativeProviderRefs } from './ClaudeAdapter.sdk.ts'
import { PROVIDER, type ClaudeSessionContext } from './ClaudeAdapter.types.ts'

export type EventStamp = {
  readonly eventId: EventId
  readonly createdAt: string
}

export function buildEventBasePrefix(context: ClaudeSessionContext, stamp: EventStamp) {
  return {
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
  }
}

export function buildToolItemEventBase(
  context: ClaudeSessionContext,
  stamp: EventStamp,
  itemId: string
) {
  return {
    ...buildEventBasePrefix(context, stamp),
    itemId: asRuntimeItemId(itemId),
    providerRefs: nativeProviderRefs(context, { providerItemId: itemId }),
  }
}

export function buildRequestEventBase(
  context: ClaudeSessionContext,
  stamp: EventStamp,
  requestId: import('@orxa-code/contracts').RuntimeRequestId,
  toolUseID: string | undefined
) {
  return {
    ...buildEventBasePrefix(context, stamp),
    requestId,
    providerRefs: nativeProviderRefs(context, { providerItemId: toolUseID }),
  }
}

export function buildContentDeltaEventBase<TTurn>(input: {
  context: ClaudeSessionContext
  stamp: EventStamp
  turnId: TTurn
  itemId: string
  providerRefs: Record<string, unknown>
}) {
  return {
    eventId: input.stamp.eventId,
    provider: PROVIDER,
    createdAt: input.stamp.createdAt,
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    itemId: asRuntimeItemId(input.itemId),
    providerRefs: input.providerRefs,
  }
}

export function buildSdkMessageEventBase(
  context: ClaudeSessionContext,
  stamp: EventStamp,
  raw: { readonly method: string; readonly messageType: string; readonly payload: SDKMessage }
) {
  return {
    ...buildEventBasePrefix(context, stamp),
    providerRefs: nativeProviderRefs(context),
    raw: {
      source: 'claude.sdk.message' as const,
      method: raw.method,
      messageType: raw.messageType,
      payload: raw.payload,
    },
  }
}
