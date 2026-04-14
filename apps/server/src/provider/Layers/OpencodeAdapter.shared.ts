import { ProviderItemId, RuntimeItemId, type TurnId } from '@orxa-code/contracts'

import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'
import type { OpencodeMapperContext } from './OpencodeAdapter.pure.ts'
import type { OpencodeEvent } from './OpencodeAdapter.types.ts'
import { PROVIDER } from './OpencodeAdapter.types.ts'

export interface BaseFields {
  readonly eventId: OpencodeMapperContext['nextStamp'] extends () => infer T
    ? T extends { eventId: infer E }
      ? E
      : never
    : never
  readonly provider: typeof PROVIDER
  readonly threadId: OpencodeMapperContext['threadId']
  readonly createdAt: string
  readonly turnId?: TurnId
  readonly providerRefs?: { readonly providerItemId?: ProviderItemId }
}

export function makeBaseForTurn(
  ctx: OpencodeMapperContext,
  turnId: TurnId | undefined,
  providerItemId?: string
): BaseFields {
  const stamp = ctx.nextStamp()
  return {
    eventId: stamp.eventId,
    provider: PROVIDER,
    threadId: ctx.threadId,
    createdAt: stamp.createdAt,
    ...(turnId !== undefined ? { turnId } : {}),
    ...(providerItemId
      ? { providerRefs: { providerItemId: ProviderItemId.makeUnsafe(providerItemId) } }
      : {}),
  }
}

export function turnIdForSession(
  ctx: OpencodeMapperContext,
  sessionId: string | undefined
): TurnId | undefined {
  if (!sessionId || sessionId === ctx.providerSessionId) {
    return ctx.turnId
  }
  return ctx.relatedSessionIds.has(sessionId) ? opencodeChildTurnId(sessionId) : ctx.turnId
}

export function resolveMapperContext(
  ctx: OpencodeMapperContext,
  sessionID: string
): { readonly turnId: TurnId | undefined } | null {
  if (!matchesThread(ctx, sessionID)) return null
  return { turnId: turnIdForSession(ctx, sessionID) ?? ctx.turnId }
}

export function matchesThread(ctx: OpencodeMapperContext, sessionId: string | undefined): boolean {
  if (sessionId && ctx.relatedSessionIds.has(sessionId)) {
    return true
  }
  if (!ctx.providerSessionId) return true
  return sessionId === ctx.providerSessionId
}

export function opencodeRawEvent(event: OpencodeEvent): {
  readonly source: 'opencode.sdk.event'
  readonly messageType: string
  readonly payload: unknown
} {
  return {
    source: 'opencode.sdk.event',
    messageType: event.type,
    payload: event.properties,
  }
}

export function runtimeItemIdFromPartId(partId: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(`opencode-part-${partId}`)
}
