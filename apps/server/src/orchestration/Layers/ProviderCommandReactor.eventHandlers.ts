import type {
  ChatAttachment,
  ModelSelection,
  OrchestrationEvent,
  ThreadId,
} from '@orxa-code/contracts'
import { Cause, Effect } from 'effect'

import type { ProviderServiceError } from '../../provider/Errors.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import type { ProviderCommandReactorSessionRuntime } from './ProviderCommandReactor.sessionRuntime.ts'
import {
  buildSessionStateSnapshot,
  listInterruptibleSubagentRoutes,
  resolveProviderControlRoute,
  propagateSubagentSessionState,
} from './ProviderCommandReactor.subagentRouting.ts'

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | 'thread.runtime-mode-set'
      | 'thread.turn-start-requested'
      | 'thread.turn-interrupt-requested'
      | 'thread.approval-response-requested'
      | 'thread.user-input-response-requested'
      | 'thread.session-stop-requested'
  }
>

interface ProviderCommandReactorEventHandlerDeps extends ProviderCommandReactorSessionRuntime {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
  readonly threadModelSelections: Map<string, ModelSelection>
  readonly turnStartKeyForEvent: (event: ProviderIntentEvent) => string
  readonly canReplaceThreadTitle: (currentTitle: string, titleSeed?: string) => boolean
  readonly hasHandledTurnStartRecently: (key: string) => Effect.Effect<boolean>
  readonly isUnknownPendingApprovalRequestError: (
    cause: Cause.Cause<ProviderServiceError>
  ) => boolean
  readonly isUnknownPendingUserInputRequestError: (
    cause: Cause.Cause<ProviderServiceError>
  ) => boolean
  readonly stalePendingRequestDetail: (
    requestKind: 'approval' | 'user-input',
    requestId: string
  ) => string
  readonly defaultRuntimeMode: 'full-access'
}

function interruptSubagentChildren(
  deps: ProviderCommandReactorEventHandlerDeps,
  input: {
    readonly parentThreadId: ThreadId
    readonly sessionThreadId: ThreadId
  }
) {
  return Effect.gen(function* () {
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    const childRoutes = listInterruptibleSubagentRoutes(
      {
        threads: readModel.threads,
        parentThreadId: input.parentThreadId,
      },
      input.sessionThreadId
    )
    yield* Effect.forEach(
      childRoutes,
      childRoute =>
        deps.providerService.interruptTurn({
          threadId: childRoute.sessionThreadId,
          turnId: childRoute.activeTurnId ?? undefined,
          ...(childRoute.providerThreadId ? { providerThreadId: childRoute.providerThreadId } : {}),
        }),
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
  })
}

function appendMissingSessionFailure(
  deps: ProviderCommandReactorEventHandlerDeps,
  input: {
    readonly threadId: ThreadId
    readonly kind:
      | 'provider.turn.interrupt.failed'
      | 'provider.approval.respond.failed'
      | 'provider.user-input.respond.failed'
    readonly summary: string
    readonly requestId?: string
    readonly createdAt: string
    readonly detail?: string
  }
) {
  return deps.appendProviderFailureActivity({
    threadId: input.threadId,
    kind: input.kind,
    summary: input.summary,
    detail: input.detail ?? 'No active provider session is bound to this thread.',
    turnId: null,
    createdAt: input.createdAt,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  })
}

function ensureThreadWithActiveSession(
  deps: ProviderCommandReactorEventHandlerDeps,
  input: {
    readonly threadId: ThreadId
    readonly kind:
      | 'provider.turn.interrupt.failed'
      | 'provider.approval.respond.failed'
      | 'provider.user-input.respond.failed'
    readonly summary: string
    readonly requestId?: string
    readonly createdAt: string
  }
) {
  return Effect.gen(function* () {
    const thread = yield* deps.resolveThread(input.threadId)
    if (!thread) {
      return { handled: true as const }
    }
    if (!thread.session || thread.session.status === 'stopped') {
      yield* appendMissingSessionFailure(deps, input)
      return { handled: true as const }
    }
    return { handled: false as const, thread }
  })
}

function buildGenerationInput(
  event: Extract<ProviderIntentEvent, { type: 'thread.turn-start-requested' }>,
  message: {
    readonly text: string
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined
  }
) {
  return {
    messageText: message.text,
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
    ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
  }
}

function maybeGenerateFirstTurnMetadata(
  deps: ProviderCommandReactorEventHandlerDeps,
  event: Extract<ProviderIntentEvent, { type: 'thread.turn-start-requested' }>,
  input: {
    readonly title: string
    readonly branch: string | null
    readonly worktreePath: string | null
    readonly cwd: string
    readonly generationInput: {
      readonly messageText: string
      readonly attachments?: ReadonlyArray<ChatAttachment>
      readonly titleSeed?: string
    }
  }
) {
  return Effect.gen(function* () {
    yield* deps
      .maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: input.branch,
        worktreePath: input.worktreePath,
        messageText: input.generationInput.messageText,
        ...(input.generationInput.attachments !== undefined
          ? { attachments: input.generationInput.attachments }
          : {}),
      })
      .pipe(Effect.forkScoped)

    if (!deps.canReplaceThreadTitle(input.title, input.generationInput.titleSeed)) {
      return
    }
    yield* deps
      .maybeGenerateThreadTitleForFirstTurn({
        threadId: event.payload.threadId,
        cwd: input.cwd,
        messageText: input.generationInput.messageText,
        ...(input.generationInput.attachments !== undefined
          ? { attachments: input.generationInput.attachments }
          : {}),
        ...(input.generationInput.titleSeed !== undefined
          ? { titleSeed: input.generationInput.titleSeed }
          : {}),
      })
      .pipe(Effect.forkScoped)
  })
}

function createProcessTurnStartRequested(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: 'thread.turn-start-requested' }>
  ) {
    const key = deps.turnStartKeyForEvent(event)
    if (yield* deps.hasHandledTurnStartRecently(key)) {
      return
    }

    const thread = yield* deps.resolveThread(event.payload.threadId)
    if (!thread) {
      return
    }
    const message = thread.messages.find(entry => entry.id === event.payload.messageId)
    if (!message || message.role !== 'user') {
      return yield* deps.appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: 'provider.turn.start.failed',
        summary: 'Provider turn start failed',
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      })
    }

    const isFirstUserMessageTurn =
      thread.messages.filter(entry => entry.role === 'user').length === 1
    if (isFirstUserMessageTurn) {
      const readModel = yield* deps.orchestrationEngine.getReadModel()
      const generationCwd =
        readModel.projects.find(project => project.id === thread.projectId)?.workspaceRoot ??
        thread.worktreePath ??
        process.cwd()
      yield* maybeGenerateFirstTurnMetadata(deps, event, {
        title: thread.title,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        cwd: generationCwd,
        generationInput: buildGenerationInput(event, message),
      })
    }

    yield* deps
      .sendTurnForThread({
        threadId: event.payload.threadId,
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        interactionMode: event.payload.interactionMode,
        createdAt: event.payload.createdAt,
      })
      .pipe(
        Effect.catchCause(cause =>
          deps.appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: 'provider.turn.start.failed',
            summary: 'Provider turn start failed',
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
          })
        )
      )
  })
}

function createProcessTurnInterruptRequested(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: 'thread.turn-interrupt-requested' }>
  ) {
    const guard = yield* ensureThreadWithActiveSession(deps, {
      threadId: event.payload.threadId,
      kind: 'provider.turn.interrupt.failed',
      summary: 'Provider turn interrupt failed',
      createdAt: event.payload.createdAt,
    })
    if (guard.handled) return
    const controlRoute = yield* resolveProviderControlRoute(deps, event.payload.threadId)
    if (!controlRoute) {
      return
    }
    yield* deps.providerService.interruptTurn({
      threadId: controlRoute.sessionThreadId,
      turnId: event.payload.turnId ?? controlRoute.activeTurnId ?? undefined,
      ...(controlRoute.providerThreadId ? { providerThreadId: controlRoute.providerThreadId } : {}),
    })
    if (controlRoute.isSubagentThread) {
      yield* deps.setThreadSession({
        threadId: controlRoute.thread.id,
        session: buildSessionStateSnapshot({
          thread: controlRoute.thread,
          status: 'interrupted',
          createdAt: event.payload.createdAt,
        }),
        createdAt: event.payload.createdAt,
      })
      return
    }
    yield* interruptSubagentChildren(deps, {
      parentThreadId: event.payload.threadId,
      sessionThreadId: controlRoute.sessionThreadId,
    })
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    yield* propagateSubagentSessionState({
      threads: readModel.threads,
      parentThreadId: event.payload.threadId,
      status: 'interrupted',
      createdAt: event.payload.createdAt,
      setThreadSession: deps.setThreadSession,
    })
  })
}

function createProcessApprovalResponseRequested(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: 'thread.approval-response-requested' }>
  ) {
    const guard = yield* ensureThreadWithActiveSession(deps, {
      threadId: event.payload.threadId,
      kind: 'provider.approval.respond.failed',
      summary: 'Provider approval response failed',
      requestId: event.payload.requestId,
      createdAt: event.payload.createdAt,
    })
    if (guard.handled) return
    const controlRoute = yield* resolveProviderControlRoute(deps, event.payload.threadId)
    if (!controlRoute) {
      return
    }
    yield* deps.providerService
      .respondToRequest({
        threadId: controlRoute.sessionThreadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause(cause =>
          deps.appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: 'provider.approval.respond.failed',
            summary: 'Provider approval response failed',
            detail: deps.isUnknownPendingApprovalRequestError(cause)
              ? deps.stalePendingRequestDetail('approval', event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          })
        )
      )
  })
}

function createProcessUserInputResponseRequested(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: 'thread.user-input-response-requested' }>
  ) {
    const guard = yield* ensureThreadWithActiveSession(deps, {
      threadId: event.payload.threadId,
      kind: 'provider.user-input.respond.failed',
      summary: 'Provider user input response failed',
      requestId: event.payload.requestId,
      createdAt: event.payload.createdAt,
    })
    if (guard.handled) return
    const controlRoute = yield* resolveProviderControlRoute(deps, event.payload.threadId)
    if (!controlRoute) {
      return
    }
    yield* deps.providerService
      .respondToUserInput({
        threadId: controlRoute.sessionThreadId,
        requestId: event.payload.requestId,
        answers: event.payload.answers,
      })
      .pipe(
        Effect.catchCause(cause =>
          deps.appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: 'provider.user-input.respond.failed',
            summary: 'Provider user input response failed',
            detail: deps.isUnknownPendingUserInputRequestError(cause)
              ? deps.stalePendingRequestDetail('user-input', event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          })
        )
      )
  })
}

function createProcessSessionStopRequested(deps: ProviderCommandReactorEventHandlerDeps) {
  return Effect.fnUntraced(function* (
    event: Extract<ProviderIntentEvent, { type: 'thread.session-stop-requested' }>
  ) {
    const controlRoute = yield* resolveProviderControlRoute(deps, event.payload.threadId)
    if (!controlRoute) {
      return
    }
    const thread = controlRoute.thread
    if (thread.session && thread.session.status !== 'stopped') {
      yield* deps.providerService.stopSession({ threadId: controlRoute.sessionThreadId })
    }
    const rootThread = controlRoute.parentThread ?? thread
    yield* deps.setThreadSession({
      threadId: rootThread.id,
      session: buildSessionStateSnapshot({
        thread: rootThread,
        status: 'stopped',
        createdAt: event.payload.createdAt,
      }),
      createdAt: event.payload.createdAt,
    })
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    yield* propagateSubagentSessionState({
      threads: readModel.threads,
      parentThreadId: rootThread.id,
      status: 'stopped',
      createdAt: event.payload.createdAt,
      setThreadSession: deps.setThreadSession,
    })
  })
}

function createProcessDomainEvent(deps: ProviderCommandReactorEventHandlerDeps) {
  const processTurnStartRequested = createProcessTurnStartRequested(deps)
  const processTurnInterruptRequested = createProcessTurnInterruptRequested(deps)
  const processApprovalResponseRequested = createProcessApprovalResponseRequested(deps)
  const processUserInputResponseRequested = createProcessUserInputResponseRequested(deps)
  const processSessionStopRequested = createProcessSessionStopRequested(deps)

  return Effect.fn('processDomainEvent')(function* (event: ProviderIntentEvent) {
    switch (event.type) {
      case 'thread.runtime-mode-set': {
        const thread = yield* deps.resolveThread(event.payload.threadId)
        if (!thread?.session || thread.session.status === 'stopped') {
          return
        }
        const cachedModelSelection = deps.threadModelSelections.get(event.payload.threadId)
        yield* deps.ensureSessionForThread(
          event.payload.threadId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {}
        )
        return
      }
      case 'thread.turn-start-requested':
        return yield* processTurnStartRequested(event)
      case 'thread.turn-interrupt-requested':
        return yield* processTurnInterruptRequested(event)
      case 'thread.approval-response-requested':
        return yield* processApprovalResponseRequested(event)
      case 'thread.user-input-response-requested':
        return yield* processUserInputResponseRequested(event)
      case 'thread.session-stop-requested':
        return yield* processSessionStopRequested(event)
    }
  })
}

export function createProviderCommandReactorEventProcessor(
  deps: ProviderCommandReactorEventHandlerDeps
) {
  const processDomainEvent = createProcessDomainEvent(deps)
  return (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause(cause => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause)
        }
        return Effect.logWarning('provider command reactor failed to process event', {
          eventType: event.type,
          cause: Cause.pretty(cause),
        })
      })
    )
}
