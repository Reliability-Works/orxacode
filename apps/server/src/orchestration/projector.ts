import type { OrchestrationEvent, OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { OrchestrationProjectorDecodeError } from './Errors.ts'
import { handleProjectEvent } from './projector.projectEvents.ts'
import { handleThreadEvent } from './projector.threadEvents.ts'

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: nowIso,
  }
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  }

  return (
    handleProjectEvent(nextBase, event) ??
    handleThreadEvent(nextBase, event) ??
    Effect.succeed(nextBase)
  )
}
