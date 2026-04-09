import {
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  type ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  type ProviderSession,
} from '@orxa-code/contracts'
import { Effect, Option, type PubSub, Stream } from 'effect'

import type { ProviderServiceShape } from '../Services/ProviderService.ts'
import type { ProviderSessionDirectoryShape } from '../Services/ProviderSessionDirectory.ts'
import type { AnalyticsServiceShape } from '../../telemetry/Services/AnalyticsService.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import {
  ProviderRollbackConversationInput,
  createUpsertSessionBinding,
  decodeInputOrValidationError,
  toValidationError,
  type ProviderServiceAdapter,
  type ProviderServiceRuntimeDeps,
  type ProviderRuntimeBinding,
} from './ProviderService.shared.ts'

function createStartSession(input: {
  readonly serverSettings: ServerSettingsShape
  readonly registry: ProviderServiceRuntimeDeps['registry']
  readonly directory: ProviderSessionDirectoryShape
  readonly analytics: AnalyticsServiceShape
  readonly upsertSessionBinding: ReturnType<typeof createUpsertSessionBinding>
}): ProviderServiceShape['startSession'] {
  return Effect.fn('startSession')(function* (threadId, rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: 'ProviderService.startSession',
      schema: ProviderSessionStartInput,
      payload: rawInput,
    })

    const request = {
      ...parsed,
      threadId,
      provider: parsed.provider ?? 'codex',
    }
    const settings = yield* input.serverSettings.getSettings.pipe(
      Effect.mapError(error =>
        toValidationError(
          'ProviderService.startSession',
          `Failed to load provider settings: ${error.message}`,
          error
        )
      )
    )
    if (!settings.providers[request.provider].enabled) {
      return yield* toValidationError(
        'ProviderService.startSession',
        `Provider '${request.provider}' is disabled in Orxa Code settings.`
      )
    }

    const persistedBinding = Option.getOrUndefined(yield* input.directory.getBinding(threadId))
    const effectiveResumeCursor =
      request.resumeCursor ??
      (persistedBinding?.provider === request.provider ? persistedBinding.resumeCursor : undefined)
    const adapter = yield* input.registry.getByProvider(request.provider)
    const session = yield* adapter.startSession({
      ...request,
      ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
    })

    if (session.provider !== adapter.provider) {
      return yield* toValidationError(
        'ProviderService.startSession',
        `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`
      )
    }

    yield* input.upsertSessionBinding(session, threadId, {
      modelSelection: request.modelSelection,
    })
    yield* input.analytics.record('provider.session.started', {
      provider: session.provider,
      runtimeMode: request.runtimeMode,
      hasResumeCursor: session.resumeCursor !== undefined,
      hasCwd: typeof request.cwd === 'string' && request.cwd.trim().length > 0,
      hasModel:
        typeof request.modelSelection?.model === 'string' &&
        request.modelSelection.model.trim().length > 0,
    })

    return session
  })
}

function createSendTurn(input: {
  readonly directory: ProviderSessionDirectoryShape
  readonly analytics: AnalyticsServiceShape
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['sendTurn'] {
  return Effect.fn('sendTurn')(function* (rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: 'ProviderService.sendTurn',
      schema: ProviderSendTurnInput,
      payload: rawInput,
    })

    const request = {
      ...parsed,
      attachments: parsed.attachments ?? [],
    }
    if (!request.input && request.attachments.length === 0) {
      return yield* toValidationError(
        'ProviderService.sendTurn',
        'Either input text or at least one attachment is required'
      )
    }
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.sendTurn',
      allowRecovery: true,
    })
    const turn = yield* routed.adapter.sendTurn(request)
    yield* input.directory.upsert({
      threadId: request.threadId,
      provider: routed.adapter.provider,
      status: 'running',
      ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
      runtimePayload: {
        ...(request.modelSelection !== undefined ? { modelSelection: request.modelSelection } : {}),
        activeTurnId: turn.turnId,
        lastRuntimeEvent: 'provider.sendTurn',
        lastRuntimeEventAt: new Date().toISOString(),
      },
    })
    yield* input.analytics.record('provider.turn.sent', {
      provider: routed.adapter.provider,
      model: request.modelSelection?.model,
      interactionMode: request.interactionMode,
      attachmentCount: request.attachments.length,
      hasInput: typeof request.input === 'string' && request.input.trim().length > 0,
    })
    return turn
  })
}

function createInterruptTurn(input: {
  readonly analytics: AnalyticsServiceShape
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['interruptTurn'] {
  return Effect.fn('interruptTurn')(function* (rawInput) {
    const request = yield* decodeInputOrValidationError({
      operation: 'ProviderService.interruptTurn',
      schema: ProviderInterruptTurnInput,
      payload: rawInput,
    })
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.interruptTurn',
      allowRecovery: true,
    })
    yield* routed.adapter.interruptTurn(routed.threadId, request.turnId, request.providerThreadId)
    yield* input.analytics.record('provider.turn.interrupted', {
      provider: routed.adapter.provider,
    })
  })
}

function createRespondToRequest(input: {
  readonly analytics: AnalyticsServiceShape
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['respondToRequest'] {
  return Effect.fn('respondToRequest')(function* (rawInput) {
    const request = yield* decodeInputOrValidationError({
      operation: 'ProviderService.respondToRequest',
      schema: ProviderRespondToRequestInput,
      payload: rawInput,
    })
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.respondToRequest',
      allowRecovery: true,
    })
    yield* routed.adapter.respondToRequest(routed.threadId, request.requestId, request.decision)
    yield* input.analytics.record('provider.request.responded', {
      provider: routed.adapter.provider,
      decision: request.decision,
    })
  })
}

function createRespondToUserInput(input: {
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['respondToUserInput'] {
  return Effect.fn('respondToUserInput')(function* (rawInput) {
    const request = yield* decodeInputOrValidationError({
      operation: 'ProviderService.respondToUserInput',
      schema: ProviderRespondToUserInputInput,
      payload: rawInput,
    })
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.respondToUserInput',
      allowRecovery: true,
    })
    yield* routed.adapter.respondToUserInput(routed.threadId, request.requestId, request.answers)
  })
}

function createStopSession(input: {
  readonly directory: ProviderSessionDirectoryShape
  readonly analytics: AnalyticsServiceShape
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['stopSession'] {
  return Effect.fn('stopSession')(function* (rawInput) {
    const request = yield* decodeInputOrValidationError({
      operation: 'ProviderService.stopSession',
      schema: ProviderStopSessionInput,
      payload: rawInput,
    })
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.stopSession',
      allowRecovery: false,
    })
    if (routed.isActive) {
      yield* routed.adapter.stopSession(routed.threadId)
    }
    yield* input.directory.remove(request.threadId)
    yield* input.analytics.record('provider.session.stopped', {
      provider: routed.adapter.provider,
    })
  })
}

function createListSessions(input: {
  readonly adapters: ReadonlyArray<ProviderServiceAdapter>
  readonly directory: ProviderSessionDirectoryShape
}): ProviderServiceShape['listSessions'] {
  return Effect.fn('listSessions')(function* () {
    const sessionsByProvider = yield* Effect.forEach(input.adapters, adapter =>
      adapter.listSessions()
    )
    const activeSessions = sessionsByProvider.flatMap(sessions => sessions)
    const persistedBindings = yield* input.directory.listThreadIds().pipe(
      Effect.flatMap(threadIds =>
        Effect.forEach(
          threadIds,
          threadId =>
            input.directory
              .getBinding(threadId)
              .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
          { concurrency: 'unbounded' }
        )
      ),
      Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>)
    )
    const bindingsByThreadId = new Map<string, ProviderRuntimeBinding>()
    for (const bindingOption of persistedBindings) {
      const binding = Option.getOrUndefined(bindingOption)
      if (binding) {
        bindingsByThreadId.set(String(binding.threadId), binding)
      }
    }

    return activeSessions.map(session => {
      const binding = bindingsByThreadId.get(String(session.threadId))
      if (!binding) {
        return session
      }

      const overrides: {
        resumeCursor?: ProviderSession['resumeCursor']
        runtimeMode?: ProviderSession['runtimeMode']
      } = {}
      if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
        overrides.resumeCursor = binding.resumeCursor
      }
      if (binding.runtimeMode !== undefined) {
        overrides.runtimeMode = binding.runtimeMode
      }
      return Object.assign({}, session, overrides)
    })
  })
}

function createRollbackConversation(input: {
  readonly analytics: AnalyticsServiceShape
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
}): ProviderServiceShape['rollbackConversation'] {
  return Effect.fn('rollbackConversation')(function* (rawInput) {
    const request = yield* decodeInputOrValidationError({
      operation: 'ProviderService.rollbackConversation',
      schema: ProviderRollbackConversationInput,
      payload: rawInput,
    })
    if (request.numTurns === 0) {
      return
    }
    const routed = yield* input.resolveRoutableSession({
      threadId: request.threadId,
      operation: 'ProviderService.rollbackConversation',
      allowRecovery: true,
    })
    yield* routed.adapter.rollbackThread(routed.threadId, request.numTurns)
    yield* input.analytics.record('provider.conversation.rolled_back', {
      provider: routed.adapter.provider,
      turns: request.numTurns,
    })
  })
}

function createRunStopAll(input: {
  readonly adapters: ReadonlyArray<ProviderServiceAdapter>
  readonly directory: ProviderSessionDirectoryShape
  readonly analytics: AnalyticsServiceShape
  readonly upsertSessionBinding: ReturnType<typeof createUpsertSessionBinding>
}) {
  return Effect.fn('runStopAll')(function* () {
    const threadIds = yield* input.directory.listThreadIds()
    const activeSessions = yield* Effect.forEach(input.adapters, adapter =>
      adapter.listSessions()
    ).pipe(Effect.map(sessionsByAdapter => sessionsByAdapter.flatMap(sessions => sessions)))
    yield* Effect.forEach(activeSessions, session =>
      input.upsertSessionBinding(session, session.threadId, {
        lastRuntimeEvent: 'provider.stopAll',
        lastRuntimeEventAt: new Date().toISOString(),
      })
    ).pipe(Effect.asVoid)
    yield* Effect.forEach(input.adapters, adapter => adapter.stopAll()).pipe(Effect.asVoid)
    yield* Effect.forEach(threadIds, threadId =>
      input.directory.getProvider(threadId).pipe(
        Effect.flatMap(provider =>
          input.directory.upsert({
            threadId,
            provider,
            status: 'stopped',
            runtimePayload: {
              activeTurnId: null,
              lastRuntimeEvent: 'provider.stopAll',
              lastRuntimeEventAt: new Date().toISOString(),
            },
          })
        )
      )
    ).pipe(Effect.asVoid)
    yield* input.analytics.record('provider.sessions.stopped_all', {
      sessionCount: threadIds.length,
    })
    yield* input.analytics.flush
  })
}

export function createProviderServiceOperations(input: {
  readonly deps: ProviderServiceRuntimeDeps
  readonly adapters: ReadonlyArray<ProviderServiceAdapter>
  readonly resolveRoutableSession: ReturnType<
    typeof import('./ProviderService.shared.ts').createResolveRoutableSession
  >
  readonly upsertSessionBinding: ReturnType<typeof createUpsertSessionBinding>
  readonly runtimeEventPubSub: PubSub.PubSub<ProviderRuntimeEvent>
}) {
  const service = {
    startSession: createStartSession({
      serverSettings: input.deps.serverSettings,
      registry: input.deps.registry,
      directory: input.deps.directory,
      analytics: input.deps.analytics,
      upsertSessionBinding: input.upsertSessionBinding,
    }),
    sendTurn: createSendTurn({
      directory: input.deps.directory,
      analytics: input.deps.analytics,
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    interruptTurn: createInterruptTurn({
      analytics: input.deps.analytics,
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    respondToRequest: createRespondToRequest({
      analytics: input.deps.analytics,
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    respondToUserInput: createRespondToUserInput({
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    stopSession: createStopSession({
      directory: input.deps.directory,
      analytics: input.deps.analytics,
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    listSessions: createListSessions({
      adapters: input.adapters,
      directory: input.deps.directory,
    }),
    getCapabilities: provider =>
      input.deps.registry.getByProvider(provider).pipe(Effect.map(adapter => adapter.capabilities)),
    rollbackConversation: createRollbackConversation({
      analytics: input.deps.analytics,
      resolveRoutableSession: input.resolveRoutableSession,
    }),
    get streamEvents(): ProviderServiceShape['streamEvents'] {
      return Stream.fromPubSub(input.runtimeEventPubSub)
    },
  } satisfies ProviderServiceShape

  return {
    service,
    runStopAll: createRunStopAll({
      adapters: input.adapters,
      directory: input.deps.directory,
      analytics: input.deps.analytics,
      upsertSessionBinding: input.upsertSessionBinding,
    }),
  } as const
}
