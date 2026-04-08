import type { OrchestrationEvent, ProjectId, ThreadId, TurnId } from '@orxa-code/contracts'
import {
  projectCreatedToCoreFields,
  projectMetaUpdatedToPatch,
  threadCreatedToCoreFields,
  threadMetaUpdatedToPatch,
} from '@orxa-code/shared/projectionEventPayloads'
import { Effect, Option } from 'effect'

import type { ProjectionProject } from '../../persistence/Services/ProjectionProjects.ts'
import type { ProjectionThread } from '../../persistence/Services/ProjectionThreads.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipelineTypes.ts'
import type {
  AttachmentSideEffects,
  ProjectionProjectorServices,
  ProjectorDefinition,
} from './ProjectionPipelineTypes.ts'

function touchThread(
  services: ProjectionProjectorServices,
  threadId: ThreadId,
  updatedAt: string,
  update: (row: ProjectionThread) => Partial<ProjectionThread> = () => ({})
) {
  return Effect.gen(function* () {
    const existingRow = yield* services.projectionThreadRepository.getById({ threadId })
    if (Option.isNone(existingRow)) {
      return
    }
    yield* services.projectionThreadRepository.upsert({
      ...existingRow.value,
      ...update(existingRow.value),
      updatedAt,
    })
  })
}

function updateThreadArchiveState(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.archived' } | { type: 'thread.unarchived' }>
) {
  return touchThread(services, event.payload.threadId, event.payload.updatedAt, () => ({
    archivedAt: event.type === 'thread.archived' ? event.payload.archivedAt : null,
  }))
}

function handleThreadCreated(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.created' }>
) {
  return services.projectionThreadRepository.upsert({
    ...threadCreatedToCoreFields(event),
    latestTurnId: null,
  })
}

function handleThreadMetaUpdated(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.meta-updated' }>
) {
  return touchThread(services, event.payload.threadId, event.payload.updatedAt, () =>
    threadMetaUpdatedToPatch(event)
  )
}

function handleThreadDeleted(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.deleted' }>,
  attachmentSideEffects: AttachmentSideEffects
) {
  return Effect.gen(function* () {
    attachmentSideEffects.deletedThreadIds.add(event.payload.threadId)
    yield* touchThread(services, event.payload.threadId, event.payload.deletedAt, () => ({
      deletedAt: event.payload.deletedAt,
    }))
  })
}

function touchOccurredThread(
  services: ProjectionProjectorServices,
  event: Extract<
    OrchestrationEvent,
    | { type: 'thread.message-sent' }
    | { type: 'thread.proposed-plan-upserted' }
    | { type: 'thread.activity-appended' }
  >
) {
  return touchThread(services, event.payload.threadId, event.occurredAt)
}

function setLatestTurnId(
  services: ProjectionProjectorServices,
  threadId: ThreadId,
  occurredAt: string,
  latestTurnId: TurnId | null
) {
  return touchThread(services, threadId, occurredAt, () => ({
    latestTurnId,
  }))
}

function applyThreadProjectionEvent(
  services: ProjectionProjectorServices,
  event: OrchestrationEvent,
  attachmentSideEffects: AttachmentSideEffects
) {
  switch (event.type) {
    case 'thread.created':
      return handleThreadCreated(services, event)
    case 'thread.archived':
    case 'thread.unarchived':
      return updateThreadArchiveState(services, event)
    case 'thread.meta-updated':
      return handleThreadMetaUpdated(services, event)
    case 'thread.runtime-mode-set':
      return touchThread(services, event.payload.threadId, event.payload.updatedAt, () => ({
        runtimeMode: event.payload.runtimeMode,
      }))
    case 'thread.interaction-mode-set':
      return touchThread(services, event.payload.threadId, event.payload.updatedAt, () => ({
        interactionMode: event.payload.interactionMode,
      }))
    case 'thread.deleted':
      return handleThreadDeleted(services, event, attachmentSideEffects)
    case 'thread.message-sent':
    case 'thread.proposed-plan-upserted':
    case 'thread.activity-appended':
      return touchOccurredThread(services, event)
    case 'thread.session-set':
      return setLatestTurnId(
        services,
        event.payload.threadId,
        event.occurredAt,
        event.payload.session.activeTurnId
      )
    case 'thread.turn-diff-completed':
      return setLatestTurnId(
        services,
        event.payload.threadId,
        event.occurredAt,
        event.payload.turnId
      )
    case 'thread.reverted':
      return setLatestTurnId(services, event.payload.threadId, event.occurredAt, null)
    default:
      return Effect.void
  }
}

function updateExistingProjectRow(
  services: ProjectionProjectorServices,
  projectId: ProjectId,
  patch: (existing: ProjectionProject) => ProjectionProject
) {
  return Effect.gen(function* () {
    const existingRow = yield* services.projectionProjectRepository.getById({ projectId })
    if (Option.isNone(existingRow)) {
      return
    }
    yield* services.projectionProjectRepository.upsert(patch(existingRow.value))
  })
}

const applyProjectsProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyProjectsProjection')(function* (event: OrchestrationEvent) {
    switch (event.type) {
      case 'project.created':
        yield* services.projectionProjectRepository.upsert(projectCreatedToCoreFields(event))
        return
      case 'project.meta-updated': {
        yield* updateExistingProjectRow(services, event.payload.projectId, existing => ({
          ...existing,
          ...projectMetaUpdatedToPatch(event),
          updatedAt: event.payload.updatedAt,
        }))
        return
      }
      case 'project.deleted': {
        yield* updateExistingProjectRow(services, event.payload.projectId, existing => ({
          ...existing,
          deletedAt: event.payload.deletedAt,
          updatedAt: event.payload.deletedAt,
        }))
        return
      }
      default:
        return
    }
  })

const applyThreadsProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyThreadsProjection')(function* (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects
  ) {
    yield* applyThreadProjectionEvent(services, event, attachmentSideEffects)
  })

export function makeProjectThreadProjectors(
  services: ProjectionProjectorServices
): ReadonlyArray<ProjectorDefinition> {
  return [
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.projects,
      apply: applyProjectsProjection(services),
    },
    {
      name: ORCHESTRATION_PROJECTOR_NAMES.threads,
      apply: applyThreadsProjection(services),
    },
  ]
}
