/**
 * Claude adapter runtime session-lifecycle helpers.
 *
 * Hosts the session startup pipeline (config loading, query runtime creation,
 * context construction, startup events, stream-fiber attachment) and the
 * `ClaudeAdapterShape` method implementations (`startSession`, `sendTurn`,
 * turn control, approval responses, stop/list/hasSession). Each helper takes
 * the shared `ClaudeAdapterDeps`.
 *
 * @module ClaudeAdapter.runtime.session
 */
import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { type ApprovalRequestId, type ProviderSession, type ThreadId } from '@orxa-code/contracts'
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Random, Ref, Stream } from 'effect'

import {
  type ProviderAdapterError,
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
} from '../Errors.ts'
import type { ClaudeAdapterShape } from '../Services/ClaudeAdapter.ts'
import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import {
  emitProviderSessionExitedEvent,
  ensureSessionStartProviderMatches,
} from './ProviderAdapter.shared.ts'
import {
  asCanonicalTurnId,
  asRuntimeRequestId,
  interruptionMessageFromClaudeCause,
  isClaudeInterruptedCause,
  messageFromClaudeStreamCause,
  readClaudeResumeState,
  toError,
  toMessage,
} from './ClaudeAdapter.pure.ts'
import { buildCanUseTool } from './ClaudeAdapter.runtime.approvals.ts'
import { emitRuntimeError } from './ClaudeAdapter.runtime.events.ts'
import { handleSdkMessage } from './ClaudeAdapter.runtime.system.ts'
import { completeTurn } from './ClaudeAdapter.runtime.turns.ts'
import {
  buildSessionQueryOptions,
  deriveSessionModelRuntimeConfig,
  nativeProviderRefs,
} from './ClaudeAdapter.sdk.ts'
import {
  PROVIDER,
  type ClaudeModelSelection,
  type ClaudeQueryRuntime,
  type ClaudeResumeState,
  type ClaudeSessionContext,
  type ClaudeSessionRuntimeConfig,
  type EffectForkRunner,
  type PendingApproval,
  type PendingUserInput,
  type PromptQueueItem,
  type ToolInFlight,
} from './ClaudeAdapter.types.ts'

export const buildPromptStream = (promptQueue: Queue.Queue<PromptQueueItem>) =>
  Stream.fromQueue(promptQueue).pipe(
    Stream.filter(item => item.type === 'message'),
    Stream.map(item => item.message),
    Stream.catchCause(cause =>
      Cause.hasInterruptsOnly(cause) ? Stream.empty : Stream.failCause(cause)
    ),
    Stream.toAsyncIterable
  )

export const loadSessionRuntimeConfig = Effect.fn('loadSessionRuntimeConfig')(function* (
  deps: ClaudeAdapterDeps,
  input: {
    readonly threadId: ThreadId
    readonly runtimeMode: ProviderSession['runtimeMode']
    readonly cwd: string | undefined
    readonly modelSelection: ClaudeModelSelection | undefined
    readonly existingResumeSessionId: string | undefined
    readonly newSessionId: string | undefined
    readonly canUseTool: CanUseTool
  }
) {
  const claudeSettings = yield* deps.serverSettingsService.getSettings.pipe(
    Effect.map(settings => settings.providers.claudeAgent),
    Effect.mapError(
      error =>
        new ProviderAdapterProcessError({
          provider: PROVIDER,
          threadId: input.threadId,
          detail: error.message,
          cause: error,
        })
    )
  )
  const claudeBinaryPath = claudeSettings.binaryPath
  const runtime = deriveSessionModelRuntimeConfig({
    runtimeMode: input.runtimeMode,
    modelSelection: input.modelSelection,
  })

  return {
    claudeBinaryPath,
    modelSelection: input.modelSelection,
    apiModelId: runtime.apiModelId,
    effectiveEffort: runtime.effectiveEffort,
    permissionMode: runtime.permissionMode,
    fastMode: runtime.fastMode,
    queryOptions: buildSessionQueryOptions({
      cwd: input.cwd,
      canUseTool: input.canUseTool,
      claudeBinaryPath,
      existingResumeSessionId: input.existingResumeSessionId,
      newSessionId: input.newSessionId,
      runtime,
    }),
  } satisfies ClaudeSessionRuntimeConfig
})

export const createSessionQueryRuntime = Effect.fn('createSessionQueryRuntime')(function* (
  deps: ClaudeAdapterDeps,
  input: {
    readonly threadId: ThreadId
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly queryOptions: ClaudeQueryOptions
  }
) {
  return yield* Effect.try({
    try: () =>
      deps.createQuery({
        prompt: input.prompt,
        options: input.queryOptions,
      }),
    catch: cause =>
      new ProviderAdapterProcessError({
        provider: PROVIDER,
        threadId: input.threadId,
        detail: toMessage(cause, 'Failed to start Claude runtime session.'),
        cause,
      }),
  })
})

export const createSessionContext = (input: {
  readonly threadId: ThreadId
  readonly runtimeMode: ProviderSession['runtimeMode']
  readonly cwd: string | undefined
  readonly startedAt: string
  readonly resumeState: ClaudeResumeState | undefined
  readonly sessionId: string | undefined
  readonly promptQueue: Queue.Queue<PromptQueueItem>
  readonly query: ClaudeQueryRuntime
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>
  readonly inFlightTools: Map<number, ToolInFlight>
  readonly config: ClaudeSessionRuntimeConfig
}): ClaudeSessionContext => {
  const session: ProviderSession = {
    threadId: input.threadId,
    provider: PROVIDER,
    status: 'ready',
    ...(input.sessionId ? { providerThreadId: input.sessionId } : {}),
    runtimeMode: input.runtimeMode,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.config.modelSelection?.model ? { model: input.config.modelSelection.model } : {}),
    resumeCursor: {
      threadId: input.threadId,
      ...(input.sessionId ? { resume: input.sessionId } : {}),
      ...(input.resumeState?.resumeSessionAt
        ? { resumeSessionAt: input.resumeState.resumeSessionAt }
        : {}),
      turnCount: input.resumeState?.turnCount ?? 0,
    },
    createdAt: input.startedAt,
    updatedAt: input.startedAt,
  }

  return {
    session,
    promptQueue: input.promptQueue,
    query: input.query,
    streamFiber: undefined,
    startedAt: input.startedAt,
    basePermissionMode: input.config.permissionMode,
    currentApiModelId: input.config.apiModelId,
    resumeSessionId: input.sessionId,
    pendingApprovals: input.pendingApprovals,
    pendingUserInputs: input.pendingUserInputs,
    turns: [],
    inFlightTools: input.inFlightTools,
    turnState: undefined,
    lastKnownContextWindow: undefined,
    lastKnownTokenUsage: undefined,
    lastAssistantUuid: input.resumeState?.resumeSessionAt,
    lastThreadStartedId: undefined,
    stopped: false,
  }
}

export const emitSessionStartupEvents = Effect.fn('emitSessionStartupEvents')(function* (
  deps: ClaudeAdapterDeps,
  threadId: ThreadId,
  resumeCursor: ProviderSession['resumeCursor'] | undefined,
  config: ClaudeSessionRuntimeConfig,
  cwd: string | undefined
) {
  const sessionStartedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'session.started',
    eventId: sessionStartedStamp.eventId,
    provider: PROVIDER,
    createdAt: sessionStartedStamp.createdAt,
    threadId,
    payload: resumeCursor !== undefined ? { resume: resumeCursor } : {},
    providerRefs: {},
  })

  const configuredStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'session.configured',
    eventId: configuredStamp.eventId,
    provider: PROVIDER,
    createdAt: configuredStamp.createdAt,
    threadId,
    payload: {
      config: {
        ...(config.apiModelId ? { model: config.apiModelId } : {}),
        ...(cwd ? { cwd } : {}),
        ...(config.effectiveEffort ? { effort: config.effectiveEffort } : {}),
        ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
        ...(config.fastMode ? { fastMode: true } : {}),
      },
    },
    providerRefs: {},
  })

  const readyStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'session.state.changed',
    eventId: readyStamp.eventId,
    provider: PROVIDER,
    createdAt: readyStamp.createdAt,
    threadId,
    payload: {
      state: 'ready',
    },
    providerRefs: {},
  })
})

export const runSdkStream = (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext
): Effect.Effect<void, Error> =>
  Stream.fromAsyncIterable(context.query, cause =>
    toError(cause, 'Claude runtime stream failed.')
  ).pipe(
    Stream.takeWhile(() => !context.stopped),
    Stream.runForEach(message => handleSdkMessage(deps, context, message))
  )

export const handleStreamExit = Effect.fn('handleStreamExit')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  exit: Exit.Exit<void, Error>
) {
  if (context.stopped) {
    return
  }

  if (Exit.isFailure(exit)) {
    if (isClaudeInterruptedCause(exit.cause)) {
      if (context.turnState) {
        yield* completeTurn(
          deps,
          context,
          'interrupted',
          interruptionMessageFromClaudeCause(exit.cause)
        )
      }
    } else {
      const message = messageFromClaudeStreamCause(exit.cause, 'Claude runtime stream failed.')
      yield* emitRuntimeError(deps, context, message, Cause.pretty(exit.cause))
      yield* completeTurn(deps, context, 'failed', message)
    }
  } else if (context.turnState) {
    yield* completeTurn(deps, context, 'interrupted', 'Claude runtime stream ended.')
  }

  yield* stopSessionInternal(deps, context, {
    emitExitEvent: true,
  })
})

export const stopSessionInternal = Effect.fn('stopSessionInternal')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  options?: { readonly emitExitEvent?: boolean }
) {
  if (context.stopped) return

  context.stopped = true

  for (const [requestId, pending] of context.pendingApprovals) {
    yield* Deferred.succeed(pending.decision, 'cancel')
    const stamp = yield* deps.makeEventStamp()
    yield* deps.offerRuntimeEvent({
      type: 'request.resolved',
      eventId: stamp.eventId,
      provider: PROVIDER,
      createdAt: stamp.createdAt,
      threadId: context.session.threadId,
      ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
      requestId: asRuntimeRequestId(requestId),
      payload: {
        requestType: pending.requestType,
        decision: 'cancel',
      },
      providerRefs: nativeProviderRefs(context),
    })
  }
  context.pendingApprovals.clear()

  if (context.turnState) {
    yield* completeTurn(deps, context, 'interrupted', 'Session stopped.')
  }

  yield* Queue.shutdown(context.promptQueue)

  const streamFiber = context.streamFiber
  context.streamFiber = undefined
  if (streamFiber && streamFiber.pollUnsafe() === undefined) {
    yield* Fiber.interrupt(streamFiber)
  }

  // @effect-diagnostics-next-line tryCatchInEffectGen:off
  try {
    context.query.close()
  } catch (cause) {
    yield* emitRuntimeError(deps, context, 'Failed to close Claude runtime query.', cause)
  }

  const updatedAt = yield* deps.nowIso
  context.session = {
    ...context.session,
    status: 'closed',
    activeTurnId: undefined,
    updatedAt,
  }

  if (options?.emitExitEvent !== false) {
    yield* emitProviderSessionExitedEvent(deps, {
      provider: PROVIDER,
      threadId: context.session.threadId,
      reason: 'Session stopped',
      exitKind: 'graceful',
    })
  }

  deps.sessions.delete(context.session.threadId)
})

export const attachSessionStreamFiber = (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  runFork: EffectForkRunner
): void => {
  const streamFiber = runFork(
    Effect.exit(runSdkStream(deps, context)).pipe(
      Effect.flatMap(exit => {
        if (context.stopped) {
          return Effect.void
        }
        if (context.streamFiber === streamFiber) {
          context.streamFiber = undefined
        }
        return handleStreamExit(deps, context, exit)
      })
    )
  )
  context.streamFiber = streamFiber
  streamFiber.addObserver(() => {
    if (context.streamFiber === streamFiber) {
      context.streamFiber = undefined
    }
  })
}

export const requireSession = (
  deps: ClaudeAdapterDeps,
  threadId: ThreadId
): Effect.Effect<ClaudeSessionContext, ProviderAdapterError> => {
  const context = deps.sessions.get(threadId)
  if (!context) {
    return Effect.fail(
      new ProviderAdapterSessionNotFoundError({
        provider: PROVIDER,
        threadId,
      })
    )
  }
  if (context.stopped || context.session.status === 'closed') {
    return Effect.fail(
      new ProviderAdapterSessionClosedError({
        provider: PROVIDER,
        threadId,
      })
    )
  }
  return Effect.succeed(context)
}

export const startSession = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['startSession'] =>
  Effect.fn('startSession')(function* (input) {
    yield* ensureSessionStartProviderMatches({
      provider: input.provider,
      expectedProvider: PROVIDER,
      operation: 'startSession',
    })

    const startedAt = yield* deps.nowIso
    const resumeState = readClaudeResumeState(input.resumeCursor)
    const threadId = input.threadId
    const existingResumeSessionId = resumeState?.resume
    const newSessionId =
      existingResumeSessionId === undefined ? yield* Random.nextUUIDv4 : undefined
    const sessionId = existingResumeSessionId ?? newSessionId

    const services = yield* Effect.services()
    const runFork = Effect.runForkWith(services)

    const promptQueue = yield* Queue.unbounded<PromptQueueItem>()
    const prompt = buildPromptStream(promptQueue)

    const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>()
    const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>()
    const inFlightTools = new Map<number, ToolInFlight>()

    const contextRef = yield* Ref.make<ClaudeSessionContext | undefined>(undefined)
    const canUseTool = yield* buildCanUseTool(deps, {
      threadId,
      runtimeMode: input.runtimeMode,
      contextRef,
      pendingApprovals,
      pendingUserInputs,
    })
    const modelSelection =
      input.modelSelection?.provider === 'claudeAgent' ? input.modelSelection : undefined
    const runtimeConfig = yield* loadSessionRuntimeConfig(deps, {
      threadId,
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      modelSelection,
      existingResumeSessionId,
      newSessionId,
      canUseTool,
    })
    const queryRuntime = yield* createSessionQueryRuntime(deps, {
      threadId,
      prompt,
      queryOptions: runtimeConfig.queryOptions,
    })

    const context = createSessionContext({
      threadId,
      runtimeMode: input.runtimeMode,
      cwd: input.cwd,
      startedAt,
      resumeState,
      sessionId,
      promptQueue,
      query: queryRuntime,
      pendingApprovals,
      pendingUserInputs,
      inFlightTools,
      config: runtimeConfig,
    })
    yield* Ref.set(contextRef, context)
    deps.sessions.set(threadId, context)
    yield* emitSessionStartupEvents(
      deps,
      threadId,
      input.resumeCursor !== undefined ? input.resumeCursor : undefined,
      runtimeConfig,
      input.cwd
    )
    attachSessionStreamFiber(deps, context, runFork)

    return {
      ...context.session,
    }
  })
