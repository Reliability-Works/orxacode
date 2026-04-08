import {
  EventId,
  type ChatAttachment,
  type CommandId,
  ModelSelection,
  OrchestrationReadModel,
  OrchestrationSession,
  ProviderKind,
  ProviderSession,
  RuntimeMode,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect, Equal, Schema } from 'effect'

import { resolveThreadWorkspaceCwd } from '../../checkpointing/Utils.ts'
import { ProviderAdapterRequestError } from '../../provider/Errors.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import {
  createGenerateAndRenameWorktreeBranchForFirstTurn,
  createGenerateThreadTitleForFirstTurn,
  type ProviderCommandReactorFirstTurnDeps,
} from './ProviderCommandReactor.firstTurn.ts'

type OrchestrationThread = OrchestrationReadModel['threads'][number]

interface ProviderCommandReactorThreadContext {
  readonly readModel: OrchestrationReadModel
  readonly thread: OrchestrationThread
  readonly currentProvider: ProviderKind | undefined
  readonly desiredRuntimeMode: RuntimeMode
  readonly desiredModelSelection: ModelSelection
  readonly effectiveCwd: string | undefined
}

interface ProviderCommandReactorSessionDeps {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
  readonly threadModelSelections: Map<string, ModelSelection>
  readonly toNonEmptyProviderInput: (value: string | undefined) => string | undefined
  readonly mapProviderSessionStatusToOrchestrationStatus: (
    status: 'connecting' | 'ready' | 'running' | 'error' | 'closed'
  ) => OrchestrationSession['status']
  readonly createProviderFailureCommandId: () => CommandId
  readonly createSessionSetCommandId: () => CommandId
}

type ProviderCommandReactorSessionRuntimeDeps = ProviderCommandReactorSessionDeps &
  ProviderCommandReactorFirstTurnDeps

function createAppendProviderFailureActivity(
  orchestrationEngine: OrchestrationEngineShape,
  createProviderFailureCommandId: () => CommandId
) {
  return (input: {
    readonly threadId: ThreadId
    readonly kind:
      | 'provider.turn.start.failed'
      | 'provider.turn.interrupt.failed'
      | 'provider.approval.respond.failed'
      | 'provider.user-input.respond.failed'
      | 'provider.session.stop.failed'
    readonly summary: string
    readonly detail: string
    readonly turnId: TurnId | null
    readonly createdAt: string
    readonly requestId?: string
  }) =>
    orchestrationEngine
      .dispatch({
        type: 'thread.activity.append',
        commandId: createProviderFailureCommandId(),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: 'error',
          kind: input.kind,
          summary: input.summary,
          payload: {
            detail: input.detail,
            ...(input.requestId ? { requestId: input.requestId } : {}),
          },
          turnId: input.turnId,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      })
      .pipe(Effect.asVoid)
}

function createSetThreadSession(
  orchestrationEngine: OrchestrationEngineShape,
  createSessionSetCommandId: () => CommandId
) {
  return (input: {
    readonly threadId: ThreadId
    readonly session: OrchestrationSession
    readonly createdAt: string
  }) =>
    orchestrationEngine.dispatch({
      type: 'thread.session.set',
      commandId: createSessionSetCommandId(),
      threadId: input.threadId,
      session: input.session,
      createdAt: input.createdAt,
    })
}

function createResolveThread(orchestrationEngine: OrchestrationEngineShape) {
  return Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* orchestrationEngine.getReadModel()
    return readModel.threads.find(entry => entry.id === threadId)
  })
}

function buildThreadContext(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly threadId: ThreadId
  readonly modelSelection?: ModelSelection | undefined
}) {
  return Effect.gen(function* () {
    const readModel = yield* input.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === input.threadId)
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${input.threadId}' was not found in read model.`))
    }

    const currentProvider: ProviderKind | undefined = Schema.is(ProviderKind)(
      thread.session?.providerName
    )
      ? thread.session.providerName
      : undefined
    const requestedModelSelection = input.modelSelection
    const threadProvider: ProviderKind = currentProvider ?? thread.modelSelection.provider
    if (
      requestedModelSelection !== undefined &&
      requestedModelSelection.provider !== threadProvider
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: threadProvider,
        method: 'thread.turn.start',
        detail: `Thread '${input.threadId}' is bound to provider '${threadProvider}' and cannot switch to '${requestedModelSelection.provider}'.`,
      })
    }

    return {
      readModel,
      thread,
      currentProvider,
      desiredRuntimeMode: thread.runtimeMode,
      desiredModelSelection: requestedModelSelection ?? thread.modelSelection,
      effectiveCwd: resolveThreadWorkspaceCwd({
        thread,
        projects: readModel.projects,
      }),
    } satisfies ProviderCommandReactorThreadContext
  })
}

function resolveActiveSession(
  providerService: ProviderServiceShape,
  threadId: ThreadId
): Effect.Effect<ProviderSession | undefined> {
  return providerService
    .listSessions()
    .pipe(Effect.map(sessions => sessions.find(session => session.threadId === threadId)))
}

function startProviderSession(
  providerService: ProviderServiceShape,
  threadId: ThreadId,
  context: ProviderCommandReactorThreadContext,
  options?: {
    readonly resumeCursor?: unknown
  }
) {
  const preferredProvider = context.currentProvider ?? context.thread.modelSelection.provider
  return providerService.startSession(threadId, {
    threadId,
    ...(preferredProvider ? { provider: preferredProvider } : {}),
    ...(context.effectiveCwd ? { cwd: context.effectiveCwd } : {}),
    modelSelection: context.desiredModelSelection,
    ...(options?.resumeCursor !== undefined ? { resumeCursor: options.resumeCursor } : {}),
    runtimeMode: context.desiredRuntimeMode,
  })
}

function bindSessionToThread(input: {
  readonly setThreadSession: ReturnType<typeof createSetThreadSession>
  readonly threadId: ThreadId
  readonly createdAt: string
  readonly desiredRuntimeMode: RuntimeMode
  readonly mapProviderSessionStatusToOrchestrationStatus: ProviderCommandReactorSessionDeps['mapProviderSessionStatusToOrchestrationStatus']
  readonly session: ProviderSession
}) {
  return input.setThreadSession({
    threadId: input.threadId,
    session: {
      threadId: input.threadId,
      status: input.mapProviderSessionStatusToOrchestrationStatus(input.session.status),
      providerName: input.session.provider,
      runtimeMode: input.desiredRuntimeMode,
      activeTurnId: null,
      lastError: input.session.lastError ?? null,
      updatedAt: input.session.updatedAt,
    },
    createdAt: input.createdAt,
  })
}

function shouldRestartForRequestedModel(input: {
  readonly requestedModelSelection: ModelSelection | undefined
  readonly currentProvider: ProviderKind | undefined
  readonly activeSession: ProviderSession | undefined
  readonly providerService: ProviderServiceShape
}) {
  return Effect.gen(function* () {
    const sessionModelSwitch =
      input.currentProvider === undefined
        ? 'in-session'
        : (yield* input.providerService.getCapabilities(input.currentProvider)).sessionModelSwitch
    const modelChanged =
      input.requestedModelSelection !== undefined &&
      input.requestedModelSelection.model !== input.activeSession?.model
    return modelChanged && sessionModelSwitch === 'restart-session'
  })
}

function restartExistingSession(input: {
  readonly providerService: ProviderServiceShape
  readonly setThreadSession: ReturnType<typeof createSetThreadSession>
  readonly threadId: ThreadId
  readonly createdAt: string
  readonly context: ProviderCommandReactorThreadContext
  readonly existingSessionThreadId: ThreadId
  readonly activeSession: ProviderSession | undefined
  readonly runtimeModeChanged: boolean
  readonly modelChanged: boolean
  readonly shouldRestartForModelChange: boolean
  readonly shouldRestartForModelSelectionChange: boolean
  readonly requestedModelSelection: ModelSelection | undefined
  readonly currentProvider: ProviderKind | undefined
  readonly mapProviderSessionStatusToOrchestrationStatus: ProviderCommandReactorSessionDeps['mapProviderSessionStatusToOrchestrationStatus']
}) {
  const resumeCursor = input.shouldRestartForModelChange
    ? undefined
    : (input.activeSession?.resumeCursor ?? undefined)
  return Effect.gen(function* () {
    yield* Effect.logInfo('provider command reactor restarting provider session', {
      threadId: input.threadId,
      existingSessionThreadId: input.existingSessionThreadId,
      currentProvider: input.currentProvider,
      desiredProvider: input.context.desiredModelSelection.provider,
      currentRuntimeMode: input.context.thread.session?.runtimeMode,
      desiredRuntimeMode: input.context.thread.runtimeMode,
      runtimeModeChanged: input.runtimeModeChanged,
      modelChanged: input.modelChanged,
      shouldRestartForModelChange: input.shouldRestartForModelChange,
      shouldRestartForModelSelectionChange: input.shouldRestartForModelSelectionChange,
      hasResumeCursor: resumeCursor !== undefined,
    })
    const restartedSession = yield* startProviderSession(
      input.providerService,
      input.threadId,
      input.context,
      resumeCursor !== undefined ? { resumeCursor } : undefined
    )
    yield* Effect.logInfo('provider command reactor restarted provider session', {
      threadId: input.threadId,
      previousSessionId: input.existingSessionThreadId,
      restartedSessionThreadId: restartedSession.threadId,
      provider: restartedSession.provider,
      runtimeMode: restartedSession.runtimeMode,
    })
    yield* bindSessionToThread({
      setThreadSession: input.setThreadSession,
      threadId: input.threadId,
      createdAt: input.createdAt,
      desiredRuntimeMode: input.context.desiredRuntimeMode,
      mapProviderSessionStatusToOrchestrationStatus:
        input.mapProviderSessionStatusToOrchestrationStatus,
      session: restartedSession,
    })
    return restartedSession.threadId
  })
}

function evaluateSessionRestartDecision(deps: ProviderCommandReactorSessionDeps) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId
    readonly context: ProviderCommandReactorThreadContext
    readonly activeSession: ProviderSession | undefined
    readonly requestedModelSelection: ModelSelection | undefined
  }) {
    const runtimeModeChanged =
      input.context.thread.runtimeMode !== input.context.thread.session?.runtimeMode
    const modelChanged =
      input.requestedModelSelection !== undefined &&
      input.requestedModelSelection.model !== input.activeSession?.model
    const shouldRestartForModelChange = yield* shouldRestartForRequestedModel({
      requestedModelSelection: input.requestedModelSelection,
      currentProvider: input.context.currentProvider,
      activeSession: input.activeSession,
      providerService: deps.providerService,
    })
    const previousModelSelection = deps.threadModelSelections.get(input.threadId)
    const shouldRestartForModelSelectionChange =
      input.context.currentProvider === 'claudeAgent' &&
      input.requestedModelSelection !== undefined &&
      !Equal.equals(previousModelSelection, input.requestedModelSelection)
    return {
      runtimeModeChanged,
      modelChanged,
      shouldRestartForModelChange,
      shouldRestartForModelSelectionChange,
    }
  })
}

function createEnsureSessionForThread(
  deps: ProviderCommandReactorSessionDeps,
  setThreadSession: ReturnType<typeof createSetThreadSession>
) {
  const evaluateRestart = evaluateSessionRestartDecision(deps)
  return Effect.fnUntraced(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection
    }
  ) {
    const context = yield* buildThreadContext({
      orchestrationEngine: deps.orchestrationEngine,
      threadId,
      modelSelection: options?.modelSelection,
    })
    const existingSessionThreadId =
      context.thread.session && context.thread.session.status !== 'stopped'
        ? context.thread.id
        : null
    if (!existingSessionThreadId) {
      const startedSession = yield* startProviderSession(deps.providerService, threadId, context)
      yield* bindSessionToThread({
        setThreadSession,
        threadId,
        createdAt,
        desiredRuntimeMode: context.desiredRuntimeMode,
        mapProviderSessionStatusToOrchestrationStatus:
          deps.mapProviderSessionStatusToOrchestrationStatus,
        session: startedSession,
      })
      return startedSession.threadId
    }

    const activeSession = yield* resolveActiveSession(deps.providerService, existingSessionThreadId)
    const requestedModelSelection = options?.modelSelection
    const decision = yield* evaluateRestart({
      threadId,
      context,
      activeSession,
      requestedModelSelection,
    })

    if (
      !decision.runtimeModeChanged &&
      !decision.shouldRestartForModelChange &&
      !decision.shouldRestartForModelSelectionChange
    ) {
      return existingSessionThreadId
    }

    return yield* restartExistingSession({
      providerService: deps.providerService,
      setThreadSession,
      threadId,
      createdAt,
      context,
      existingSessionThreadId,
      activeSession,
      runtimeModeChanged: decision.runtimeModeChanged,
      modelChanged: decision.modelChanged,
      shouldRestartForModelChange: decision.shouldRestartForModelChange,
      shouldRestartForModelSelectionChange: decision.shouldRestartForModelSelectionChange,
      requestedModelSelection,
      currentProvider: context.currentProvider,
      mapProviderSessionStatusToOrchestrationStatus:
        deps.mapProviderSessionStatusToOrchestrationStatus,
    })
  })
}

function createSendTurnForThread(
  deps: ProviderCommandReactorSessionDeps,
  resolveThread: ReturnType<typeof createResolveThread>,
  ensureSessionForThread: ReturnType<typeof createEnsureSessionForThread>
) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId
    readonly messageText: string
    readonly attachments?: ReadonlyArray<ChatAttachment>
    readonly modelSelection?: ModelSelection
    readonly interactionMode?: 'default' | 'plan'
    readonly createdAt: string
  }) {
    const thread = yield* resolveThread(input.threadId)
    if (!thread) {
      return
    }
    yield* ensureSessionForThread(
      input.threadId,
      input.createdAt,
      input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}
    )
    if (input.modelSelection !== undefined) {
      deps.threadModelSelections.set(input.threadId, input.modelSelection)
    }

    const normalizedInput = deps.toNonEmptyProviderInput(input.messageText)
    const normalizedAttachments = input.attachments ?? []
    const activeSession = yield* resolveActiveSession(deps.providerService, input.threadId)
    const sessionModelSwitch =
      activeSession === undefined
        ? 'in-session'
        : (yield* deps.providerService.getCapabilities(activeSession.provider)).sessionModelSwitch
    const requestedModelSelection =
      input.modelSelection ??
      deps.threadModelSelections.get(input.threadId) ??
      thread.modelSelection
    const modelForTurn =
      sessionModelSwitch === 'unsupported' && activeSession?.model !== undefined
        ? {
            ...requestedModelSelection,
            model: activeSession.model,
          }
        : input.modelSelection

    yield* deps.providerService.sendTurn({
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    })
  })
}

export function createProviderCommandReactorSessionRuntime(
  deps: ProviderCommandReactorSessionRuntimeDeps
) {
  const appendProviderFailureActivity = createAppendProviderFailureActivity(
    deps.orchestrationEngine,
    deps.createProviderFailureCommandId
  )
  const setThreadSession = createSetThreadSession(
    deps.orchestrationEngine,
    deps.createSessionSetCommandId
  )
  const resolveThread = createResolveThread(deps.orchestrationEngine)
  const ensureSessionForThread = createEnsureSessionForThread(deps, setThreadSession)
  const sendTurnForThread = createSendTurnForThread(deps, resolveThread, ensureSessionForThread)
  const maybeGenerateAndRenameWorktreeBranchForFirstTurn =
    createGenerateAndRenameWorktreeBranchForFirstTurn(deps)
  const maybeGenerateThreadTitleForFirstTurn = createGenerateThreadTitleForFirstTurn(
    deps,
    resolveThread
  )

  return {
    appendProviderFailureActivity,
    setThreadSession,
    resolveThread,
    ensureSessionForThread,
    sendTurnForThread,
    maybeGenerateAndRenameWorktreeBranchForFirstTurn,
    maybeGenerateThreadTitleForFirstTurn,
  }
}

export type ProviderCommandReactorResolveThread = ReturnType<typeof createResolveThread>
export type ProviderCommandReactorSessionRuntime = ReturnType<
  typeof createProviderCommandReactorSessionRuntime
>
