import type { OrchestrationEvent } from '@orxa-code/contracts'
import type { Effect } from 'effect'

import type { ProjectionRepositoryError } from '../../persistence/Errors.ts'
import type { ProjectionPendingApprovalRepositoryShape } from '../../persistence/Services/ProjectionPendingApprovals.ts'
import type { ProjectionProjectRepositoryShape } from '../../persistence/Services/ProjectionProjects.ts'
import type { ProjectionStateRepositoryShape } from '../../persistence/Services/ProjectionState.ts'
import type { ProjectionThreadActivityRepositoryShape } from '../../persistence/Services/ProjectionThreadActivities.ts'
import type { ProjectionThreadMessageRepositoryShape } from '../../persistence/Services/ProjectionThreadMessages.ts'
import type { ProjectionThreadProposedPlanRepositoryShape } from '../../persistence/Services/ProjectionThreadProposedPlans.ts'
import type { ProjectionThreadSessionRepositoryShape } from '../../persistence/Services/ProjectionThreadSessions.ts'
import type { ProjectionThreadRepositoryShape } from '../../persistence/Services/ProjectionThreads.ts'
import type { ProjectionTurnRepositoryShape } from '../../persistence/Services/ProjectionTurns.ts'

export const ORCHESTRATION_PROJECTOR_NAMES = {
  projects: 'projection.projects',
  threads: 'projection.threads',
  threadMessages: 'projection.thread-messages',
  threadProposedPlans: 'projection.thread-proposed-plans',
  threadActivities: 'projection.thread-activities',
  threadSessions: 'projection.thread-sessions',
  threadTurns: 'projection.thread-turns',
  checkpoints: 'projection.checkpoints',
  pendingApprovals: 'projection.pending-approvals',
} as const

export type ProjectorName =
  (typeof ORCHESTRATION_PROJECTOR_NAMES)[keyof typeof ORCHESTRATION_PROJECTOR_NAMES]

export interface AttachmentSideEffects {
  readonly deletedThreadIds: Set<string>
  readonly prunedThreadRelativePaths: Map<string, Set<string>>
}

export interface ProjectorDefinition {
  readonly name: ProjectorName
  readonly apply: (
    event: OrchestrationEvent,
    attachmentSideEffects: AttachmentSideEffects
  ) => Effect.Effect<void, ProjectionRepositoryError>
}

export interface ProjectionProjectorServices {
  readonly projectionProjectRepository: ProjectionProjectRepositoryShape
  readonly projectionThreadRepository: ProjectionThreadRepositoryShape
  readonly projectionThreadMessageRepository: ProjectionThreadMessageRepositoryShape
  readonly projectionThreadProposedPlanRepository: ProjectionThreadProposedPlanRepositoryShape
  readonly projectionThreadActivityRepository: ProjectionThreadActivityRepositoryShape
  readonly projectionThreadSessionRepository: ProjectionThreadSessionRepositoryShape
  readonly projectionTurnRepository: ProjectionTurnRepositoryShape
  readonly projectionPendingApprovalRepository: ProjectionPendingApprovalRepositoryShape
}

export interface ProjectionPipelineRuntimeServices {
  readonly projectionStateRepository: ProjectionStateRepositoryShape
}
