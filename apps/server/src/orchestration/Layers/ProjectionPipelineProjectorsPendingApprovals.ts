import type { OrchestrationEvent } from '@orxa-code/contracts'
import { Effect, Option } from 'effect'

import { extractActivityRequestId } from './ProjectionPipelineAttachments.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipelineTypes.ts'
import type { ProjectionProjectorServices, ProjectorDefinition } from './ProjectionPipelineTypes.ts'

function readResolvedDecision(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || !('decision' in payload)) {
    return null
  }
  const decision = (payload as { decision?: unknown }).decision
  return decision === 'accept' ||
    decision === 'acceptForSession' ||
    decision === 'decline' ||
    decision === 'cancel'
    ? decision
    : null
}

function handleApprovalActivityAppended(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.activity-appended' }>
) {
  return Effect.gen(function* () {
    const requestId =
      extractActivityRequestId(event.payload.activity.payload) ?? event.metadata.requestId ?? null
    if (requestId === null) {
      return
    }
    const existingRow = yield* services.projectionPendingApprovalRepository.getByRequestId({
      requestId,
    })
    if (event.payload.activity.kind === 'approval.resolved') {
      yield* services.projectionPendingApprovalRepository.upsert({
        requestId,
        threadId: Option.isSome(existingRow) ? existingRow.value.threadId : event.payload.threadId,
        turnId: Option.isSome(existingRow)
          ? existingRow.value.turnId
          : event.payload.activity.turnId,
        status: 'resolved',
        decision: readResolvedDecision(event.payload.activity.payload),
        createdAt: Option.isSome(existingRow)
          ? existingRow.value.createdAt
          : event.payload.activity.createdAt,
        resolvedAt: event.payload.activity.createdAt,
      })
      return
    }
    if (Option.isSome(existingRow) && existingRow.value.status === 'resolved') {
      return
    }
    yield* services.projectionPendingApprovalRepository.upsert({
      requestId,
      threadId: event.payload.threadId,
      turnId: event.payload.activity.turnId,
      status: 'pending',
      decision: null,
      createdAt: Option.isSome(existingRow)
        ? existingRow.value.createdAt
        : event.payload.activity.createdAt,
      resolvedAt: null,
    })
  })
}

function handleApprovalResponseRequested(
  services: ProjectionProjectorServices,
  event: Extract<OrchestrationEvent, { type: 'thread.approval-response-requested' }>
) {
  return Effect.gen(function* () {
    const existingRow = yield* services.projectionPendingApprovalRepository.getByRequestId({
      requestId: event.payload.requestId,
    })
    yield* services.projectionPendingApprovalRepository.upsert({
      requestId: event.payload.requestId,
      threadId: Option.isSome(existingRow) ? existingRow.value.threadId : event.payload.threadId,
      turnId: Option.isSome(existingRow) ? existingRow.value.turnId : null,
      status: 'resolved',
      decision: event.payload.decision,
      createdAt: Option.isSome(existingRow) ? existingRow.value.createdAt : event.payload.createdAt,
      resolvedAt: event.payload.createdAt,
    })
  })
}

const applyPendingApprovalsProjection = (
  services: ProjectionProjectorServices
): ProjectorDefinition['apply'] =>
  Effect.fn('applyPendingApprovalsProjection')(function* (event: OrchestrationEvent) {
    switch (event.type) {
      case 'thread.activity-appended':
        yield* handleApprovalActivityAppended(services, event)
        return
      case 'thread.approval-response-requested':
        yield* handleApprovalResponseRequested(services, event)
        return
      default:
        return
    }
  })

export function makeProjectionPendingApprovalProjector(
  services: ProjectionProjectorServices
): ProjectorDefinition {
  return {
    name: ORCHESTRATION_PROJECTOR_NAMES.pendingApprovals,
    apply: applyPendingApprovalsProjection(services),
  }
}
