import type { OrchestrationEvent, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import {
  collectThreadAttachmentRelativePaths,
  materializeAttachmentsForProjection,
  retainProjectionActivitiesAfterRevert,
  retainProjectionMessagesAfterRevert,
  retainProjectionProposedPlansAfterRevert,
} from './ProjectionPipelineAttachments.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipelineTypes.ts'
import type {
  AttachmentSideEffects,
  ProjectionProjectorServices,
  ProjectorDefinition,
} from './ProjectionPipelineTypes.ts'

interface ThreadScopedRevertRepository<TRow, EList, EDelete, EUpsert, R> {
  readonly listByThreadId: (input: {
    readonly threadId: ThreadId
  }) => Effect.Effect<ReadonlyArray<TRow>, EList, R>
  readonly deleteByThreadId: (input: {
    readonly threadId: ThreadId
  }) => Effect.Effect<void, EDelete, R>
  readonly upsert: (row: TRow) => Effect.Effect<void, EUpsert, R>
}

function applyRevertedRows<TRow, TTurn, EList, EDelete, EUpsert, R>(
  repository: ThreadScopedRevertRepository<TRow, EList, EDelete, EUpsert, R>,
  services: ProjectionProjectorServices,
  threadId: ThreadId,
  turnCount: number,
  retain: (
    rows: ReadonlyArray<TRow>,
    turns: ReadonlyArray<TTurn>,
    turnCount: number
  ) => ReadonlyArray<TRow>,
  onKeptRows?: (kept: ReadonlyArray<TRow>) => void
) {
  return Effect.gen(function* () {
    const existingRows = yield* repository.listByThreadId({ threadId })
    if (existingRows.length === 0) {
      return
    }
    const existingTurns = (yield* services.projectionTurnRepository.listByThreadId({
      threadId,
    })) as ReadonlyArray<TTurn>
    const keptRows = retain(existingRows, existingTurns, turnCount)
    if (keptRows.length === existingRows.length) {
      return
    }
    yield* repository.deleteByThreadId({ threadId })
    yield* Effect.forEach(keptRows, repository.upsert, { concurrency: 1 }).pipe(Effect.asVoid)
    onKeptRows?.(keptRows)
  })
}

const applyThreadMessagesProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadMessagesProjection')(function* (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects
  ) {
    switch (event.type) {
      case 'thread.message-sent': {
        const existingMessage = yield* services.projectionThreadMessageRepository.getByMessageId({
          messageId: event.payload.messageId,
        })
        const previousMessage = existingMessage._tag === 'Some' ? existingMessage.value : undefined
        const nextText =
          existingMessage._tag === 'None'
            ? event.payload.text
            : event.payload.streaming
              ? `${existingMessage.value.text}${event.payload.text}`
              : event.payload.text.length === 0
                ? existingMessage.value.text
                : event.payload.text
        const nextAttachments =
          event.payload.attachments !== undefined
            ? yield* materializeAttachmentsForProjection({
                attachments: event.payload.attachments,
              })
            : previousMessage?.attachments
        yield* services.projectionThreadMessageRepository.upsert({
          messageId: event.payload.messageId,
          threadId: event.payload.threadId,
          turnId: event.payload.turnId,
          role: event.payload.role,
          text: nextText,
          ...(nextAttachments !== undefined ? { attachments: [...nextAttachments] } : {}),
          isStreaming: event.payload.streaming,
          createdAt: previousMessage?.createdAt ?? event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        })
        return
      }
      case 'thread.reverted': {
        yield* applyRevertedRows(
          services.projectionThreadMessageRepository,
          services,
          event.payload.threadId,
          event.payload.turnCount,
          retainProjectionMessagesAfterRevert,
          keptRows => {
            attachmentSideEffects.prunedThreadRelativePaths.set(
              event.payload.threadId,
              collectThreadAttachmentRelativePaths(event.payload.threadId, keptRows)
            )
          }
        )
        return
      }
      default:
        return
    }
  })

const applyThreadProposedPlansProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadProposedPlansProjection')(function* (event: OrchestrationEvent) {
    switch (event.type) {
      case 'thread.proposed-plan-upserted':
        yield* services.projectionThreadProposedPlanRepository.upsert({
          planId: event.payload.proposedPlan.id,
          threadId: event.payload.threadId,
          turnId: event.payload.proposedPlan.turnId,
          planMarkdown: event.payload.proposedPlan.planMarkdown,
          implementedAt: event.payload.proposedPlan.implementedAt,
          implementationThreadId: event.payload.proposedPlan.implementationThreadId,
          createdAt: event.payload.proposedPlan.createdAt,
          updatedAt: event.payload.proposedPlan.updatedAt,
        })
        return
      case 'thread.reverted': {
        yield* applyRevertedRows(
          services.projectionThreadProposedPlanRepository,
          services,
          event.payload.threadId,
          event.payload.turnCount,
          retainProjectionProposedPlansAfterRevert
        )
        return
      }
      default:
        return
    }
  })

const applyThreadActivitiesProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadActivitiesProjection')(function* (event: OrchestrationEvent) {
    switch (event.type) {
      case 'thread.activity-appended':
        yield* services.projectionThreadActivityRepository.upsert({
          activityId: event.payload.activity.id,
          threadId: event.payload.threadId,
          turnId: event.payload.activity.turnId,
          tone: event.payload.activity.tone,
          kind: event.payload.activity.kind,
          summary: event.payload.activity.summary,
          payload: event.payload.activity.payload,
          ...(event.payload.activity.sequence !== undefined
            ? { sequence: event.payload.activity.sequence }
            : {}),
          createdAt: event.payload.activity.createdAt,
        })
        return
      case 'thread.reverted': {
        yield* applyRevertedRows(
          services.projectionThreadActivityRepository,
          services,
          event.payload.threadId,
          event.payload.turnCount,
          retainProjectionActivitiesAfterRevert
        )
        return
      }
      default:
        return
    }
  })

const applyThreadSessionsProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadSessionsProjection')(function* (event: OrchestrationEvent) {
    if (event.type !== 'thread.session-set') {
      return
    }
    yield* services.projectionThreadSessionRepository.upsert({
      threadId: event.payload.threadId,
      status: event.payload.session.status,
      providerName: event.payload.session.providerName,
      runtimeMode: event.payload.session.runtimeMode,
      activeTurnId: event.payload.session.activeTurnId,
      lastError: event.payload.session.lastError,
      updatedAt: event.payload.session.updatedAt,
    })
  })

export function makeProjectionContentProjectors(
  services: ProjectionProjectorServices
): ReadonlyArray<ProjectorDefinition> {
  return [
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
      apply: applyThreadMessagesProjection(services),
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
      apply: applyThreadProposedPlansProjection(services),
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
      apply: applyThreadActivitiesProjection(services),
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
      apply: applyThreadSessionsProjection(services),
    },
  ]
}
