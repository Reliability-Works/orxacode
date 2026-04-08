import { ThreadId } from '@orxa-code/contracts'

import { ProviderAdapterRequestError, type ProviderAdapterError } from '../Errors.ts'

export function makeRequestError(input: {
  provider: string
  threadId: ThreadId
  method: string
  cause: unknown
  toMessage: (cause: unknown, fallback: string) => string
  toSessionError: (threadId: ThreadId, cause: unknown) => ProviderAdapterError | undefined
}): ProviderAdapterError {
  const sessionError = input.toSessionError(input.threadId, input.cause)
  if (sessionError) {
    return sessionError
  }
  return new ProviderAdapterRequestError({
    provider: input.provider,
    method: input.method,
    detail: input.toMessage(input.cause, `${input.method} failed`),
    cause: input.cause,
  })
}
