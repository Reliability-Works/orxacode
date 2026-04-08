import { Effect, Option } from 'effect'

import type { OrchestrationCheckpointSummary, ThreadId } from '@orxa-code/contracts'

import type { ProjectionRepositoryError } from '../../persistence/Errors.ts'
import type { ProjectionThreadCheckpointContext } from '../Services/ProjectionSnapshotQuery.ts'

export type ProjectionSnapshotQueryCheckpointRow = {
  turnId: OrchestrationCheckpointSummary['turnId']
  checkpointTurnCount: number
  checkpointRef: OrchestrationCheckpointSummary['checkpointRef']
  status: OrchestrationCheckpointSummary['status']
  files: OrchestrationCheckpointSummary['files']
  assistantMessageId: OrchestrationCheckpointSummary['assistantMessageId']
  completedAt: OrchestrationCheckpointSummary['completedAt']
}

export type ProjectionSnapshotQueryCheckpointThreadRow = {
  threadId: ThreadId
  projectId: ProjectionThreadCheckpointContext['projectId']
  workspaceRoot: string
  worktreePath: string | null
}

export function toCheckpointSummary(
  row: ProjectionSnapshotQueryCheckpointRow
): OrchestrationCheckpointSummary {
  return {
    turnId: row.turnId,
    checkpointTurnCount: row.checkpointTurnCount,
    checkpointRef: row.checkpointRef,
    status: row.status,
    files: row.files,
    assistantMessageId: row.assistantMessageId,
    completedAt: row.completedAt,
  }
}

export function loadThreadCheckpointContext(input: {
  readonly threadId: ThreadId
  readonly getThreadRow: (input: {
    threadId: ThreadId
  }) => Effect.Effect<
    Option.Option<ProjectionSnapshotQueryCheckpointThreadRow>,
    ProjectionRepositoryError,
    never
  >
  readonly listCheckpointRows: (input: {
    threadId: ThreadId
  }) => Effect.Effect<
    ReadonlyArray<ProjectionSnapshotQueryCheckpointRow>,
    ProjectionRepositoryError,
    never
  >
}): Effect.Effect<Option.Option<ProjectionThreadCheckpointContext>, ProjectionRepositoryError> {
  return Effect.gen(function* () {
    const threadRow = yield* input.getThreadRow({ threadId: input.threadId })
    if (Option.isNone(threadRow)) {
      return Option.none<ProjectionThreadCheckpointContext>()
    }

    const checkpointRows = yield* input.listCheckpointRows({ threadId: input.threadId })
    return Option.some({
      threadId: threadRow.value.threadId,
      projectId: threadRow.value.projectId,
      workspaceRoot: threadRow.value.workspaceRoot,
      worktreePath: threadRow.value.worktreePath,
      checkpoints: checkpointRows.map(toCheckpointSummary),
    })
  })
}
