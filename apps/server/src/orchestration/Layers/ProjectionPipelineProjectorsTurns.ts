import type { OrchestrationEvent } from '@orxa-code/contracts'
import { Effect, Option } from 'effect'

import type {
  ProjectionPendingTurnStart,
  ProjectionTurnById,
} from '../../persistence/Services/ProjectionTurns.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipelineTypes.ts'
import type { ProjectionProjectorServices, ProjectorDefinition } from './ProjectionPipelineTypes.ts'

const EMPTY_CHECKPOINT_FIELDS = {
  checkpointTurnCount: null,
  checkpointRef: null,
  checkpointStatus: null,
  checkpointFiles: [],
} as const

const EMPTY_TURN_LINKS = {
  pendingMessageId: null,
  sourceProposedPlanThreadId: null,
  sourceProposedPlanId: null,
  assistantMessageId: null,
} as const

function handleTurnStartRequested(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.turn-start-requested' }>
) {
  return services.projectionTurnRepository.replacePendingTurnStart({
    threadId: event.payload.threadId,
    messageId: event.payload.messageId,
    sourceProposedPlanThreadId: event.payload.sourceProposedPlan?.threadId ?? null,
    sourceProposedPlanId: event.payload.sourceProposedPlan?.planId ?? null,
    requestedAt: event.payload.createdAt,
  })
}

function handleSessionSetForTurns(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.session-set' }>
) {
  return Effect.gen(function* () {
    const turnId = event.payload.session.activeTurnId
    if (turnId === null || event.payload.session.status !== 'running') {
      return
    }
    const existingTurn = yield* services.projectionTurnRepository.getByTurnId({
      threadId: event.payload.threadId,
      turnId,
    })
    const pendingTurnStart = yield* services.projectionTurnRepository.getPendingTurnStartByThreadId(
      {
        threadId: event.payload.threadId,
      }
    )
    const pending = Option.getOrUndefined(pendingTurnStart)

    if (Option.isSome(existingTurn)) {
      yield* services.projectionTurnRepository.upsertByTurnId(
        buildSessionSetExistingTurnRow(existingTurn.value, pending, event.occurredAt)
      )
    } else {
      yield* services.projectionTurnRepository.upsertByTurnId(
        buildSessionSetNewTurnRow(event.payload.threadId, turnId, pending, event.occurredAt)
      )
    }

    yield* services.projectionTurnRepository.deletePendingTurnStartByThreadId({
      threadId: event.payload.threadId,
    })
  })
}

function resolveRunningTurnState(state: ProjectionTurnById['state']): ProjectionTurnById['state'] {
  return state === 'completed' || state === 'error' ? state : 'running'
}

function resolveTurnRequestTimestamp(
  pending: ProjectionPendingTurnStart | undefined,
  occurredAt: string
): string {
  return pending?.requestedAt ?? occurredAt
}

function buildSessionSetExistingTurnRow(
  existingTurn: ProjectionTurnById,
  pending: ProjectionPendingTurnStart | undefined,
  occurredAt: string
): ProjectionTurnById {
  const requestedAt = existingTurn.requestedAt ?? resolveTurnRequestTimestamp(pending, occurredAt)

  return {
    ...existingTurn,
    state: resolveRunningTurnState(existingTurn.state),
    pendingMessageId: existingTurn.pendingMessageId ?? pending?.messageId ?? null,
    sourceProposedPlanThreadId:
      existingTurn.sourceProposedPlanThreadId ?? pending?.sourceProposedPlanThreadId ?? null,
    sourceProposedPlanId:
      existingTurn.sourceProposedPlanId ?? pending?.sourceProposedPlanId ?? null,
    startedAt: existingTurn.startedAt ?? requestedAt,
    requestedAt,
  }
}

function buildSessionSetNewTurnRow(
  threadId: Extract<OrchestrationEvent, { type: 'thread.session-set' }>['payload']['threadId'],
  turnId: NonNullable<
    Extract<
      OrchestrationEvent,
      { type: 'thread.session-set' }
    >['payload']['session']['activeTurnId']
  >,
  pending: ProjectionPendingTurnStart | undefined,
  occurredAt: string
): ProjectionTurnById {
  const requestedAt = resolveTurnRequestTimestamp(pending, occurredAt)

  return {
    turnId,
    threadId,
    pendingMessageId: pending?.messageId ?? null,
    sourceProposedPlanThreadId: pending?.sourceProposedPlanThreadId ?? null,
    sourceProposedPlanId: pending?.sourceProposedPlanId ?? null,
    assistantMessageId: null,
    state: 'running',
    requestedAt,
    startedAt: requestedAt,
    completedAt: null,
    ...EMPTY_CHECKPOINT_FIELDS,
  }
}

function mergeExistingTurnTimestamps(
  existingTurn: ProjectionTurnById,
  fallback: string
): Pick<ProjectionTurnById, 'startedAt' | 'requestedAt'> {
  return {
    startedAt: existingTurn.startedAt ?? fallback,
    requestedAt: existingTurn.requestedAt ?? fallback,
  }
}

function buildBlankTurnRow(
  threadId: ProjectionTurnById['threadId'],
  turnId: NonNullable<ProjectionTurnById['turnId']>,
  timestamps: { requestedAt: string; startedAt: string; completedAt: string | null }
): ProjectionTurnById {
  return {
    turnId,
    threadId,
    ...EMPTY_TURN_LINKS,
    state: 'running',
    requestedAt: timestamps.requestedAt,
    startedAt: timestamps.startedAt,
    completedAt: timestamps.completedAt,
    ...EMPTY_CHECKPOINT_FIELDS,
  }
}

function upsertExistingOrBlankTurn(
  services: ProjectionProjectorServices,
  params: {
    readonly threadId: ProjectionTurnById['threadId']
    readonly turnId: NonNullable<ProjectionTurnById['turnId']>
    readonly fallbackTimestamp: string
    readonly buildExisting: (existing: ProjectionTurnById) => ProjectionTurnById
    readonly buildBlank: (blank: ProjectionTurnById) => ProjectionTurnById
    readonly blankTimestamps: {
      readonly requestedAt: string
      readonly startedAt: string
      readonly completedAt: string | null
    }
  }
) {
  return Effect.gen(function* () {
    const existingTurn = yield* services.projectionTurnRepository.getByTurnId({
      threadId: params.threadId,
      turnId: params.turnId,
    })
    if (Option.isSome(existingTurn)) {
      yield* services.projectionTurnRepository.upsertByTurnId({
        ...params.buildExisting(existingTurn.value),
        ...mergeExistingTurnTimestamps(existingTurn.value, params.fallbackTimestamp),
      })
      return
    }
    yield* services.projectionTurnRepository.upsertByTurnId(
      params.buildBlank(buildBlankTurnRow(params.threadId, params.turnId, params.blankTimestamps))
    )
  })
}

interface TurnUpsertBuilders {
  readonly buildExisting: (existing: ProjectionTurnById) => ProjectionTurnById
  readonly buildBlank: (blank: ProjectionTurnById) => ProjectionTurnById
  readonly blankTimestamps: {
    readonly requestedAt: string
    readonly startedAt: string
    readonly completedAt: string | null
  }
}

function runTurnUpsert(
  services: ProjectionProjectorServices,
  threadId: ProjectionTurnById['threadId'],
  turnId: NonNullable<ProjectionTurnById['turnId']>,
  fallbackTimestamp: string,
  builders: TurnUpsertBuilders
) {
  return upsertExistingOrBlankTurn(services, {
    threadId,
    turnId,
    fallbackTimestamp,
    ...builders,
  })
}

function handleAssistantMessageSent(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.message-sent' }>
) {
  if (event.payload.turnId === null || event.payload.role !== 'assistant') {
    return Effect.void
  }
  return runTurnUpsert(
    services,
    event.payload.threadId,
    event.payload.turnId,
    event.payload.createdAt,
    {
      buildExisting: existing => ({
        ...existing,
        assistantMessageId: event.payload.messageId,
        state: event.payload.streaming
          ? existing.state
          : existing.state === 'interrupted'
            ? 'interrupted'
            : existing.state === 'error'
              ? 'error'
              : 'completed',
        completedAt: event.payload.streaming
          ? existing.completedAt
          : (existing.completedAt ?? event.payload.updatedAt),
      }),
      blankTimestamps: {
        requestedAt: event.payload.createdAt,
        startedAt: event.payload.createdAt,
        completedAt: event.payload.streaming ? null : event.payload.updatedAt,
      },
      buildBlank: blank => ({
        ...blank,
        assistantMessageId: event.payload.messageId,
        state: event.payload.streaming ? 'running' : 'completed',
      }),
    }
  )
}

function handleTurnInterruptRequested(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.turn-interrupt-requested' }>
) {
  if (event.payload.turnId === undefined) {
    return Effect.void
  }
  return runTurnUpsert(
    services,
    event.payload.threadId,
    event.payload.turnId,
    event.payload.createdAt,
    {
      buildExisting: existing => ({
        ...existing,
        state: 'interrupted',
        completedAt: existing.completedAt ?? event.payload.createdAt,
      }),
      blankTimestamps: {
        requestedAt: event.payload.createdAt,
        startedAt: event.payload.createdAt,
        completedAt: event.payload.createdAt,
      },
      buildBlank: blank => ({ ...blank, state: 'interrupted' }),
    }
  )
}

function handleTurnDiffCompleted(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.turn-diff-completed' }>
) {
  return Effect.gen(function* () {
    const existingTurn = yield* services.projectionTurnRepository.getByTurnId({
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
    })
    const nextState = event.payload.status === 'error' ? 'error' : 'completed'
    yield* services.projectionTurnRepository.clearCheckpointTurnConflict({
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
      checkpointTurnCount: event.payload.checkpointTurnCount,
    })
    if (Option.isSome(existingTurn)) {
      yield* services.projectionTurnRepository.upsertByTurnId({
        ...existingTurn.value,
        assistantMessageId: event.payload.assistantMessageId,
        state: nextState,
        checkpointTurnCount: event.payload.checkpointTurnCount,
        checkpointRef: event.payload.checkpointRef,
        checkpointStatus: event.payload.status,
        checkpointFiles: event.payload.files,
        startedAt: existingTurn.value.startedAt ?? event.payload.completedAt,
        requestedAt: existingTurn.value.requestedAt ?? event.payload.completedAt,
        completedAt: event.payload.completedAt,
      })
      return
    }
    yield* services.projectionTurnRepository.upsertByTurnId({
      turnId: event.payload.turnId,
      threadId: event.payload.threadId,
      ...EMPTY_TURN_LINKS,
      assistantMessageId: event.payload.assistantMessageId,
      state: nextState,
      requestedAt: event.payload.completedAt,
      startedAt: event.payload.completedAt,
      completedAt: event.payload.completedAt,
      checkpointTurnCount: event.payload.checkpointTurnCount,
      checkpointRef: event.payload.checkpointRef,
      checkpointStatus: event.payload.status,
      checkpointFiles: event.payload.files,
    })
  })
}

function handleThreadRevertedForTurns(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.reverted' }>
) {
  return Effect.gen(function* () {
    const existingTurns = yield* services.projectionTurnRepository.listByThreadId({
      threadId: event.payload.threadId,
    })
    const keptTurns = existingTurns.filter(
      turn =>
        turn.turnId !== null &&
        turn.checkpointTurnCount !== null &&
        turn.checkpointTurnCount <= event.payload.turnCount
    )
    yield* services.projectionTurnRepository.deleteByThreadId({
      threadId: event.payload.threadId,
    })
    yield* Effect.forEach(
      keptTurns,
      turn =>
        turn.turnId === null
          ? Effect.void
          : services.projectionTurnRepository.upsertByTurnId({ ...turn, turnId: turn.turnId }),
      { concurrency: 1 }
    ).pipe(Effect.asVoid)
  })
}

const applyThreadTurnsProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadTurnsProjection')(function* (event: OrchestrationEvent) {
    switch (event.type) {
      case 'thread.turn-start-requested':
        yield* handleTurnStartRequested(services, event)
        return
      case 'thread.session-set':
        yield* handleSessionSetForTurns(services, event)
        return
      case 'thread.message-sent':
        yield* handleAssistantMessageSent(services, event)
        return
      case 'thread.turn-interrupt-requested':
        yield* handleTurnInterruptRequested(services, event)
        return
      case 'thread.turn-diff-completed':
        yield* handleTurnDiffCompleted(services, event)
        return
      case 'thread.reverted':
        yield* handleThreadRevertedForTurns(services, event)
        return
      default:
        return
    }
  })

const applyCheckpointsProjection: ProjectorDefinition['apply'] = () => Effect.void

export function makeProjectionTurnProjectors(
  services: ProjectionProjectorServices
): ReadonlyArray<ProjectorDefinition> {
  return [
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadTurns,
      apply: applyThreadTurnsProjection(services),
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
      apply: applyCheckpointsProjection,
    },
  ]
}
