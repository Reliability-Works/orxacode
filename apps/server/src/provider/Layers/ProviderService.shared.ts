import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from '@orxa-code/contracts'
import { Effect, Option, PubSub, Schema, SchemaIssue } from 'effect'

import { ProviderValidationError, type ProviderAdapterError } from '../Errors.ts'
import type { ProviderAdapterShape } from '../Services/ProviderAdapter.ts'
import type { ProviderAdapterRegistryShape } from '../Services/ProviderAdapterRegistry.ts'
import type {
  ProviderRuntimeBinding,
  ProviderSessionDirectoryShape,
} from '../Services/ProviderSessionDirectory.ts'
import { type EventNdjsonLogger } from './EventNdjsonLogger.ts'
import type { AnalyticsServiceShape } from '../../telemetry/Services/AnalyticsService.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'

export interface ProviderServiceRuntimeDeps {
  readonly analytics: AnalyticsServiceShape
  readonly serverSettings: ServerSettingsShape
  readonly registry: ProviderAdapterRegistryShape
  readonly directory: ProviderSessionDirectoryShape
  readonly canonicalEventLogger?: EventNdjsonLogger
}

export type ProviderServiceAdapter = ProviderAdapterShape<ProviderAdapterError>
export type { ProviderRuntimeBinding }

export const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
})

export function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  })
}

export const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string
  readonly schema: S
  readonly payload: unknown
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      schemaError =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        })
    )
  )

export function toRuntimeStatus(
  session: ProviderSession
): 'starting' | 'running' | 'stopped' | 'error' {
  switch (session.status) {
    case 'connecting':
      return 'starting'
    case 'error':
      return 'error'
    case 'closed':
      return 'stopped'
    case 'ready':
    case 'running':
    default:
      return 'running'
  }
}

export function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown
    readonly lastRuntimeEvent?: string
    readonly lastRuntimeEventAt?: string
  }
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  }
}

export function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding['runtimePayload']
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== 'object' || Array.isArray(runtimePayload)) {
    return undefined
  }
  const raw = 'modelSelection' in runtimePayload ? runtimePayload.modelSelection : undefined
  return Schema.is(ModelSelection)(raw) ? raw : undefined
}

export function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding['runtimePayload']
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== 'object' || Array.isArray(runtimePayload)) {
    return undefined
  }
  const rawCwd = 'cwd' in runtimePayload ? runtimePayload.cwd : undefined
  if (typeof rawCwd !== 'string') return undefined
  const trimmed = rawCwd.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function createPublishRuntimeEvent(
  runtimeEventPubSub: PubSub.PubSub<ProviderRuntimeEvent>,
  canonicalEventLogger: EventNdjsonLogger | undefined
) {
  return (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.succeed(event).pipe(
      Effect.tap(canonicalEvent =>
        canonicalEventLogger ? canonicalEventLogger.write(canonicalEvent, null) : Effect.void
      ),
      Effect.flatMap(canonicalEvent => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
      Effect.asVoid
    )
}

export function createUpsertSessionBinding(directory: ProviderSessionDirectoryShape) {
  return (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: {
      readonly modelSelection?: unknown
      readonly lastRuntimeEvent?: string
      readonly lastRuntimeEventAt?: string
    }
  ) =>
    directory.upsert({
      threadId,
      provider: session.provider,
      runtimeMode: session.runtimeMode,
      status: toRuntimeStatus(session),
      ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
      runtimePayload: toRuntimePayloadFromSession(session, extra),
    })
}

export function createRecoverSessionForThread(input: {
  readonly registry: ProviderAdapterRegistryShape
  readonly analytics: AnalyticsServiceShape
  readonly upsertSessionBinding: ReturnType<typeof createUpsertSessionBinding>
}) {
  return Effect.fn('recoverSessionForThread')(function* (request: {
    readonly binding: ProviderRuntimeBinding
    readonly operation: string
  }) {
    const adapter = yield* input.registry.getByProvider(request.binding.provider)
    const hasResumeCursor =
      request.binding.resumeCursor !== null && request.binding.resumeCursor !== undefined
    const hasActiveSession = yield* adapter.hasSession(request.binding.threadId)
    if (hasActiveSession) {
      const activeSessions = yield* adapter.listSessions()
      const existing = activeSessions.find(session => session.threadId === request.binding.threadId)
      if (existing) {
        yield* input.upsertSessionBinding(existing, request.binding.threadId)
        yield* input.analytics.record('provider.session.recovered', {
          provider: existing.provider,
          strategy: 'adopt-existing',
          hasResumeCursor: existing.resumeCursor !== undefined,
        })
        return { adapter, session: existing } as const
      }
    }

    if (!hasResumeCursor) {
      return yield* toValidationError(
        request.operation,
        `Cannot recover thread '${request.binding.threadId}' because no provider resume state is persisted.`
      )
    }

    const persistedCwd = readPersistedCwd(request.binding.runtimePayload)
    const persistedModelSelection = readPersistedModelSelection(request.binding.runtimePayload)
    const resumed = yield* adapter.startSession({
      threadId: request.binding.threadId,
      provider: request.binding.provider,
      ...(persistedCwd ? { cwd: persistedCwd } : {}),
      ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
      ...(hasResumeCursor ? { resumeCursor: request.binding.resumeCursor } : {}),
      runtimeMode: request.binding.runtimeMode ?? 'full-access',
    })

    if (resumed.provider !== adapter.provider) {
      return yield* toValidationError(
        request.operation,
        `Adapter/provider mismatch while recovering thread '${request.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`
      )
    }

    yield* input.upsertSessionBinding(resumed, request.binding.threadId)
    yield* input.analytics.record('provider.session.recovered', {
      provider: resumed.provider,
      strategy: 'resume-thread',
      hasResumeCursor: resumed.resumeCursor !== undefined,
    })
    return { adapter, session: resumed } as const
  })
}

export function createResolveRoutableSession(input: {
  readonly registry: ProviderAdapterRegistryShape
  readonly directory: ProviderSessionDirectoryShape
  readonly recoverSessionForThread: ReturnType<typeof createRecoverSessionForThread>
}) {
  return Effect.fn('resolveRoutableSession')(function* (request: {
    readonly threadId: ThreadId
    readonly operation: string
    readonly allowRecovery: boolean
  }) {
    const bindingOption = yield* input.directory.getBinding(request.threadId)
    const binding = Option.getOrUndefined(bindingOption)
    if (!binding) {
      return yield* toValidationError(
        request.operation,
        `Cannot route thread '${request.threadId}' because no persisted provider binding exists.`
      )
    }
    const adapter = yield* input.registry.getByProvider(binding.provider)
    const hasRequestedSession = yield* adapter.hasSession(request.threadId)

    if (hasRequestedSession) {
      return { adapter, threadId: request.threadId, isActive: true } as const
    }
    if (!request.allowRecovery) {
      return { adapter, threadId: request.threadId, isActive: false } as const
    }

    const recovered = yield* input.recoverSessionForThread({
      binding,
      operation: request.operation,
    })
    return { adapter: recovered.adapter, threadId: request.threadId, isActive: true } as const
  })
}
