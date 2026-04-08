import { ThreadId } from '@orxa-code/contracts'

import {
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from '../Errors.ts'
import { makeRequestError } from './ProviderAdapter.shared.ts'

export const CODEX_PROVIDER = 'codex' as const

export function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }
  return fallback
}

export function toSessionError(
  threadId: ThreadId,
  cause: unknown
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, '').toLowerCase()
  if (normalized.includes('unknown session') || normalized.includes('unknown provider session')) {
    return new ProviderAdapterSessionNotFoundError({
      provider: CODEX_PROVIDER,
      threadId,
      cause,
    })
  }
  if (normalized.includes('session is closed')) {
    return new ProviderAdapterSessionClosedError({
      provider: CODEX_PROVIDER,
      threadId,
      cause,
    })
  }
  return undefined
}

export function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown
): ProviderAdapterError {
  return makeRequestError({
    provider: CODEX_PROVIDER,
    threadId,
    method,
    cause,
    toMessage,
    toSessionError,
  })
}
