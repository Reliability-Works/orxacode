import { Effect, FileSystem, Layer, Option, Path, Stream } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { ServerConfig, type ServerConfigShape } from '../../config.ts'
import { ProjectionPendingApprovalRepositoryLive } from '../../persistence/Layers/ProjectionPendingApprovals.ts'
import { ProjectionProjectRepositoryLive } from '../../persistence/Layers/ProjectionProjects.ts'
import { ProjectionStateRepositoryLive } from '../../persistence/Layers/ProjectionState.ts'
import { ProjectionThreadActivityRepositoryLive } from '../../persistence/Layers/ProjectionThreadActivities.ts'
import { ProjectionThreadMessageRepositoryLive } from '../../persistence/Layers/ProjectionThreadMessages.ts'
import { ProjectionThreadProposedPlanRepositoryLive } from '../../persistence/Layers/ProjectionThreadProposedPlans.ts'
import { ProjectionThreadSessionRepositoryLive } from '../../persistence/Layers/ProjectionThreadSessions.ts'
import { ProjectionThreadRepositoryLive } from '../../persistence/Layers/ProjectionThreads.ts'
import { ProjectionTurnRepositoryLive } from '../../persistence/Layers/ProjectionTurns.ts'
import { toPersistenceSqlError } from '../../persistence/Errors.ts'
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from '../../persistence/Services/OrchestrationEventStore.ts'
import { ProjectionPendingApprovalRepository } from '../../persistence/Services/ProjectionPendingApprovals.ts'
import { ProjectionProjectRepository } from '../../persistence/Services/ProjectionProjects.ts'
import {
  ProjectionStateRepository,
  type ProjectionStateRepositoryShape,
} from '../../persistence/Services/ProjectionState.ts'
import { ProjectionThreadActivityRepository } from '../../persistence/Services/ProjectionThreadActivities.ts'
import { ProjectionThreadMessageRepository } from '../../persistence/Services/ProjectionThreadMessages.ts'
import { ProjectionThreadProposedPlanRepository } from '../../persistence/Services/ProjectionThreadProposedPlans.ts'
import { ProjectionThreadSessionRepository } from '../../persistence/Services/ProjectionThreadSessions.ts'
import { ProjectionThreadRepository } from '../../persistence/Services/ProjectionThreads.ts'
import { ProjectionTurnRepository } from '../../persistence/Services/ProjectionTurns.ts'
import type { OrchestrationEvent } from '@orxa-code/contracts'
import { runAttachmentSideEffects } from './ProjectionPipelineAttachments.ts'
import { makeProjectionContentProjectors } from './ProjectionPipelineProjectorsContent.ts'
import { makeProjectionPendingApprovalProjector } from './ProjectionPipelineProjectorsPendingApprovals.ts'
import { makeProjectThreadProjectors } from './ProjectionPipelineProjectorsProjectsThreads.ts'
import { makeProjectionTurnProjectors } from './ProjectionPipelineProjectorsTurns.ts'
import type {
  AttachmentSideEffects,
  ProjectionProjectorServices,
  ProjectorDefinition,
} from './ProjectionPipelineTypes.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipelineTypes.ts'
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from '../Services/ProjectionPipeline.ts'

function emptyAttachmentSideEffects(): AttachmentSideEffects {
  return {
    deletedThreadIds: new Set<string>(),
    prunedThreadRelativePaths: new Map<string, Set<string>>(),
  }
}

function listProjectors(services: ProjectionProjectorServices): ReadonlyArray<ProjectorDefinition> {
  return [
    ...makeProjectThreadProjectors(services),
    ...makeProjectionContentProjectors(services),
    ...makeProjectionTurnProjectors(services),
    makeProjectionPendingApprovalProjector(services),
  ]
}

function mapSqlErrors<A, E>(label: string, effect: Effect.Effect<A, E>) {
  return effect.pipe(
    Effect.catchIf(
      (error): error is Extract<E, { readonly _tag: 'SqlError' }> =>
        typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'SqlError',
      sqlError => Effect.fail(toPersistenceSqlError(label)(sqlError))
    )
  )
}

function provideProjectionFileServices<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  services: {
    readonly fileSystem: FileSystem.FileSystem
    readonly path: Path.Path
    readonly serverConfig: ServerConfigShape
  }
) {
  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, services.fileSystem),
    Effect.provideService(Path.Path, services.path),
    Effect.provideService(ServerConfig, services.serverConfig)
  )
}

function makeRunProjectorForEvent(input: {
  readonly sql: SqlClient.SqlClient
  readonly projectionStateRepository: ProjectionStateRepositoryShape
}) {
  return Effect.fn('runProjectorForEvent')(function* (
    projector: ProjectorDefinition,
    event: OrchestrationEvent
  ) {
    const attachmentSideEffects = emptyAttachmentSideEffects()
    yield* input.sql.withTransaction(
      projector.apply(event, attachmentSideEffects).pipe(
        Effect.flatMap(() =>
          input.projectionStateRepository.upsert({
            projector: projector.name,
            lastAppliedSequence: event.sequence,
            updatedAt: event.occurredAt,
          })
        )
      )
    )
    yield* runAttachmentSideEffects(attachmentSideEffects).pipe(
      Effect.catch(cause =>
        Effect.logWarning('failed to apply projected attachment side-effects', {
          projector: projector.name,
          sequence: event.sequence,
          eventType: event.type,
          cause,
        })
      )
    )
  })
}

function makeBootstrapProjector(input: {
  readonly eventStore: OrchestrationEventStoreShape
  readonly projectionStateRepository: ProjectionStateRepositoryShape
  readonly runProjectorForEvent: ReturnType<typeof makeRunProjectorForEvent>
}) {
  return (projector: ProjectorDefinition) =>
    input.projectionStateRepository
      .getByProjector({ projector: projector.name })
      .pipe(
        Effect.flatMap(stateRow =>
          Stream.runForEach(
            input.eventStore.readFromSequence(
              Option.isSome(stateRow) ? stateRow.value.lastAppliedSequence : 0
            ),
            event => input.runProjectorForEvent(projector, event)
          )
        )
      )
}

const makeOrchestrationProjectionPipeline = Effect.fn('makeOrchestrationProjectionPipeline')(
  function* () {
    const sql = yield* SqlClient.SqlClient
    const eventStore = yield* OrchestrationEventStore
    const projectionStateRepository = yield* ProjectionStateRepository
    const services: ProjectionProjectorServices = {
      projectionProjectRepository: yield* ProjectionProjectRepository,
      projectionThreadRepository: yield* ProjectionThreadRepository,
      projectionThreadMessageRepository: yield* ProjectionThreadMessageRepository,
      projectionThreadProposedPlanRepository: yield* ProjectionThreadProposedPlanRepository,
      projectionThreadActivityRepository: yield* ProjectionThreadActivityRepository,
      projectionThreadSessionRepository: yield* ProjectionThreadSessionRepository,
      projectionTurnRepository: yield* ProjectionTurnRepository,
      projectionPendingApprovalRepository: yield* ProjectionPendingApprovalRepository,
    }

    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const serverConfig = yield* ServerConfig
    const projectors = listProjectors(services)
    const runProjectorForEvent = makeRunProjectorForEvent({
      sql,
      projectionStateRepository,
    })
    const bootstrapProjector = makeBootstrapProjector({
      eventStore,
      projectionStateRepository,
      runProjectorForEvent,
    })

    const projectEvent: OrchestrationProjectionPipelineShape['projectEvent'] = event =>
      mapSqlErrors(
        'ProjectionPipeline.projectEvent:query',
        provideProjectionFileServices(
          Effect.forEach(projectors, projector => runProjectorForEvent(projector, event), {
            concurrency: 1,
          }).pipe(Effect.asVoid),
          { fileSystem, path, serverConfig }
        )
      )

    const bootstrap: OrchestrationProjectionPipelineShape['bootstrap'] = mapSqlErrors(
      'ProjectionPipeline.bootstrap:query',
      provideProjectionFileServices(
        Effect.forEach(projectors, bootstrapProjector, { concurrency: 1 }).pipe(
          Effect.asVoid,
          Effect.tap(() =>
            Effect.logDebug('orchestration projection pipeline bootstrapped').pipe(
              Effect.annotateLogs({ projectors: projectors.length })
            )
          )
        ),
        { fileSystem, path, serverConfig }
      )
    )

    return {
      bootstrap,
      projectEvent,
    } satisfies OrchestrationProjectionPipelineShape
  }
)

export const OrchestrationProjectionPipelineLive = Layer.effect(
  OrchestrationProjectionPipeline,
  makeOrchestrationProjectionPipeline()
).pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectionThreadRepositoryLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
  Layer.provideMerge(ProjectionThreadProposedPlanRepositoryLive),
  Layer.provideMerge(ProjectionThreadActivityRepositoryLive),
  Layer.provideMerge(ProjectionThreadSessionRepositoryLive),
  Layer.provideMerge(ProjectionTurnRepositoryLive),
  Layer.provideMerge(ProjectionPendingApprovalRepositoryLive),
  Layer.provideMerge(ProjectionStateRepositoryLive)
)

export { ORCHESTRATION_PROJECTOR_NAMES }
