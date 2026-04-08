import { OrchestrationReadModel } from '@orxa-code/contracts'
import { Effect, Layer, Option, Schema } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import {
  isPersistenceError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from '../../persistence/Errors.ts'
import { ORCHESTRATION_PROJECTOR_NAMES } from './ProjectionPipeline.ts'
import { loadThreadCheckpointContext } from './ProjectionSnapshotQuery.checkpointContext.ts'
import {
  createProjectionSnapshotQueries,
  type ProjectionSnapshotQueries,
} from './ProjectionSnapshotQuery.queries.ts'
import {
  buildOrchestrationProjectFromRow,
  loadProjectionSnapshot,
} from './ProjectionSnapshotQuery.snapshot.ts'
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
  type ProjectionSnapshotQueryShape,
} from '../Services/ProjectionSnapshotQuery.ts'

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel)

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right
  }
  return left > right ? left : right
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<{ projector: string; lastAppliedSequence: number }>
): number {
  if (stateRows.length === 0) {
    return 0
  }
  const sequenceByProjector = new Map(
    stateRows.map(row => [row.projector, row.lastAppliedSequence] as const)
  )

  let minSequence = Number.POSITIVE_INFINITY
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector)
    if (sequence === undefined) {
      return 0
    }
    if (sequence < minSequence) {
      minSequence = sequence
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause)
}

function createSnapshotPrimaryLoaders(queries: ProjectionSnapshotQueries) {
  return {
    listProjectRows: () =>
      queries
        .listProjectRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listProjects:query',
              'ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows'
            )
          )
        ),
    listThreadRows: () =>
      queries
        .listThreadRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listThreads:query',
              'ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows'
            )
          )
        ),
    listThreadMessageRows: () =>
      queries
        .listThreadMessageRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query',
              'ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows'
            )
          )
        ),
    listThreadProposedPlanRows: () =>
      queries
        .listThreadProposedPlanRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query',
              'ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows'
            )
          )
        ),
    listThreadActivityRows: () =>
      queries
        .listThreadActivityRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query',
              'ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows'
            )
          )
        ),
  }
}

function createSnapshotAuxiliaryLoaders(queries: ProjectionSnapshotQueries) {
  return {
    listThreadSessionRows: () =>
      queries
        .listThreadSessionRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query',
              'ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows'
            )
          )
        ),
    listCheckpointRows: () =>
      queries
        .listCheckpointRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query',
              'ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows'
            )
          )
        ),
    listLatestTurnRows: () =>
      queries
        .listLatestTurnRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query',
              'ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows'
            )
          )
        ),
    listProjectionStateRows: () =>
      queries
        .listProjectionStateRows(undefined)
        .pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getSnapshot:listProjectionState:query',
              'ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows'
            )
          )
        ),
  }
}

function createGetSnapshot(
  sql: SqlClient.SqlClient,
  queries: ProjectionSnapshotQueries
): ProjectionSnapshotQueryShape['getSnapshot'] {
  return () =>
    sql
      .withTransaction(
        loadProjectionSnapshot({
          ...createSnapshotPrimaryLoaders(queries),
          ...createSnapshotAuxiliaryLoaders(queries),
          computeSnapshotSequence,
          maxIso,
          decodeReadModel: snapshot =>
            decodeReadModel(snapshot).pipe(
              Effect.mapError(
                toPersistenceDecodeError('ProjectionSnapshotQuery.getSnapshot:decodeReadModel')
              )
            ),
        })
      )
      .pipe(
        Effect.mapError(error => {
          if (isPersistenceError(error)) {
            return error
          }
          return toPersistenceSqlError('ProjectionSnapshotQuery.getSnapshot:query')(error)
        })
      )
}

function createGetCounts(
  readProjectionCounts: ProjectionSnapshotQueries['readProjectionCounts']
): ProjectionSnapshotQueryShape['getCounts'] {
  return () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProjectionSnapshotQuery.getCounts:query',
          'ProjectionSnapshotQuery.getCounts:decodeRow'
        )
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        })
      )
    )
}

function createGetActiveProjectByWorkspaceRoot(
  getActiveProjectRowByWorkspaceRoot: ProjectionSnapshotQueries['getActiveProjectRowByWorkspaceRoot']
): ProjectionSnapshotQueryShape['getActiveProjectByWorkspaceRoot'] {
  return workspaceRoot =>
    getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query',
          'ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow'
        )
      ),
      Effect.map(Option.map(buildOrchestrationProjectFromRow))
    )
}

function createGetFirstActiveThreadIdByProjectId(
  getFirstActiveThreadIdByProject: ProjectionSnapshotQueries['getFirstActiveThreadIdByProject']
): ProjectionSnapshotQueryShape['getFirstActiveThreadIdByProjectId'] {
  return projectId =>
    getFirstActiveThreadIdByProject({ projectId }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          'ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query',
          'ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow'
        )
      ),
      Effect.map(Option.map(row => row.threadId))
    )
}

function createGetThreadCheckpointContext(
  getThreadCheckpointContextThreadRow: ProjectionSnapshotQueries['getThreadCheckpointContextThreadRow'],
  listCheckpointRowsByThread: ProjectionSnapshotQueries['listCheckpointRowsByThread']
): ProjectionSnapshotQueryShape['getThreadCheckpointContext'] {
  return threadId =>
    loadThreadCheckpointContext({
      threadId,
      getThreadRow: request =>
        getThreadCheckpointContextThreadRow(request).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query',
              'ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow'
            )
          )
        ),
      listCheckpointRows: request =>
        listCheckpointRowsByThread(request).pipe(
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              'ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query',
              'ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows'
            )
          )
        ),
    })
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const queries = createProjectionSnapshotQueries(sql)
  const getSnapshot = createGetSnapshot(sql, queries)
  const getCounts = createGetCounts(queries.readProjectionCounts)
  const getActiveProjectByWorkspaceRoot = createGetActiveProjectByWorkspaceRoot(
    queries.getActiveProjectRowByWorkspaceRoot
  )
  const getFirstActiveThreadIdByProjectId = createGetFirstActiveThreadIdByProjectId(
    queries.getFirstActiveThreadIdByProject
  )
  const getThreadCheckpointContext = createGetThreadCheckpointContext(
    queries.getThreadCheckpointContextThreadRow,
    queries.listCheckpointRowsByThread
  )

  return {
    getSnapshot,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape
})

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery
)
