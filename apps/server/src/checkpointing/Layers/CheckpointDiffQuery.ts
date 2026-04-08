import {
  type CheckpointRef,
  OrchestrationGetTurnDiffResult,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffResult as OrchestrationGetTurnDiffResultType,
} from '@orxa-code/contracts'
import { Effect, Layer, Option, Schema } from 'effect'

import { ProjectionSnapshotQuery } from '../../orchestration/Services/ProjectionSnapshotQuery.ts'
import type { ProjectionThreadCheckpointContext } from '../../orchestration/Services/ProjectionSnapshotQuery.ts'
import { CheckpointInvariantError, CheckpointUnavailableError } from '../Errors.ts'
import type { CheckpointServiceError, CheckpointStoreError } from '../Errors.ts'
import { checkpointRefForThreadTurn } from '../Utils.ts'
import { CheckpointStore } from '../Services/CheckpointStore.ts'
import type { CheckpointStoreShape } from '../Services/CheckpointStore.ts'
import {
  CheckpointDiffQuery,
  type CheckpointDiffQueryShape,
} from '../Services/CheckpointDiffQuery.ts'

const isTurnDiffResult = Schema.is(OrchestrationGetTurnDiffResult)

function ensureTurnDiffResult(
  operation: string,
  result: OrchestrationGetTurnDiffResultType
): Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointInvariantError> {
  if (!isTurnDiffResult(result)) {
    return Effect.fail(
      new CheckpointInvariantError({
        operation,
        detail: 'Computed turn diff result does not satisfy contract schema.',
      })
    )
  }
  return Effect.succeed(result)
}

function buildEmptyTurnDiff(
  operation: string,
  input: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0]
): Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointInvariantError> {
  return ensureTurnDiffResult(operation, {
    threadId: input.threadId,
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
    diff: '',
  })
}

function requireThreadCheckpointContext(
  operation: string,
  input: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0],
  threadContext: Option.Option<ProjectionThreadCheckpointContext>
): Effect.Effect<ProjectionThreadCheckpointContext, CheckpointInvariantError> {
  if (Option.isNone(threadContext)) {
    return Effect.fail(
      new CheckpointInvariantError({
        operation,
        detail: `Thread '${input.threadId}' not found.`,
      })
    )
  }
  return Effect.succeed(threadContext.value)
}

function ensureTurnRangeAvailable(
  input: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0],
  threadContext: ProjectionThreadCheckpointContext
): Effect.Effect<void, CheckpointUnavailableError> {
  const maxTurnCount = threadContext.checkpoints.reduce(
    (max, checkpoint) => Math.max(max, checkpoint.checkpointTurnCount),
    0
  )
  if (input.toTurnCount > maxTurnCount) {
    return Effect.fail(
      new CheckpointUnavailableError({
        threadId: input.threadId,
        turnCount: input.toTurnCount,
        detail: `Turn diff range exceeds current turn count: requested ${input.toTurnCount}, current ${maxTurnCount}.`,
      })
    )
  }
  return Effect.void
}

function requireWorkspaceCwd(
  operation: string,
  input: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0],
  threadContext: ProjectionThreadCheckpointContext
): Effect.Effect<string, CheckpointInvariantError> {
  const workspaceCwd = threadContext.worktreePath ?? threadContext.workspaceRoot
  if (!workspaceCwd) {
    return Effect.fail(
      new CheckpointInvariantError({
        operation,
        detail: `Workspace path missing for thread '${input.threadId}' when computing turn diff.`,
      })
    )
  }
  return Effect.succeed(workspaceCwd)
}

function resolveCheckpointRefForTurn(
  threadContext: ProjectionThreadCheckpointContext,
  threadId: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0]['threadId'],
  turnCount: number
): CheckpointRef | undefined {
  if (turnCount === 0) {
    return checkpointRefForThreadTurn(threadId, 0)
  }
  return threadContext.checkpoints.find(checkpoint => checkpoint.checkpointTurnCount === turnCount)
    ?.checkpointRef
}

function requireCheckpointRef(
  input: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0],
  threadContext: ProjectionThreadCheckpointContext,
  turnCount: number
): Effect.Effect<CheckpointRef, CheckpointUnavailableError> {
  const checkpointRef = resolveCheckpointRefForTurn(threadContext, input.threadId, turnCount)
  if (!checkpointRef) {
    return Effect.fail(
      new CheckpointUnavailableError({
        threadId: input.threadId,
        turnCount,
        detail: `Checkpoint ref is unavailable for turn ${turnCount}.`,
      })
    )
  }
  return Effect.succeed(checkpointRef)
}

function ensureCheckpointRefsExist(input: {
  checkpointStore: CheckpointStoreShape
  threadId: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0]['threadId']
  fromTurnCount: number
  toTurnCount: number
  workspaceCwd: string
  fromCheckpointRef: CheckpointRef
  toCheckpointRef: CheckpointRef
}): Effect.Effect<void, CheckpointStoreError> {
  return Effect.gen(function* () {
    const [fromExists, toExists] = yield* Effect.all(
      [
        input.checkpointStore.hasCheckpointRef({
          cwd: input.workspaceCwd,
          checkpointRef: input.fromCheckpointRef,
        }),
        input.checkpointStore.hasCheckpointRef({
          cwd: input.workspaceCwd,
          checkpointRef: input.toCheckpointRef,
        }),
      ],
      { concurrency: 'unbounded' }
    )

    if (!fromExists) {
      return yield* new CheckpointUnavailableError({
        threadId: input.threadId,
        turnCount: input.fromTurnCount,
        detail: `Filesystem checkpoint is unavailable for turn ${input.fromTurnCount}.`,
      })
    }

    if (!toExists) {
      return yield* new CheckpointUnavailableError({
        threadId: input.threadId,
        turnCount: input.toTurnCount,
        detail: `Filesystem checkpoint is unavailable for turn ${input.toTurnCount}.`,
      })
    }
  })
}

function computeTurnDiff(input: {
  operation: string
  checkpointStore: CheckpointStoreShape
  request: Parameters<CheckpointDiffQueryShape['getTurnDiff']>[0]
  workspaceCwd: string
  fromCheckpointRef: CheckpointRef
  toCheckpointRef: CheckpointRef
}): Effect.Effect<OrchestrationGetTurnDiffResultType, CheckpointServiceError> {
  return Effect.gen(function* () {
    yield* ensureCheckpointRefsExist({
      checkpointStore: input.checkpointStore,
      threadId: input.request.threadId,
      fromTurnCount: input.request.fromTurnCount,
      toTurnCount: input.request.toTurnCount,
      workspaceCwd: input.workspaceCwd,
      fromCheckpointRef: input.fromCheckpointRef,
      toCheckpointRef: input.toCheckpointRef,
    })

    const diff = yield* input.checkpointStore.diffCheckpoints({
      cwd: input.workspaceCwd,
      fromCheckpointRef: input.fromCheckpointRef,
      toCheckpointRef: input.toCheckpointRef,
      fallbackFromToHead: false,
    })

    return yield* ensureTurnDiffResult(input.operation, {
      threadId: input.request.threadId,
      fromTurnCount: input.request.fromTurnCount,
      toTurnCount: input.request.toTurnCount,
      diff,
    })
  })
}

const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery
  const checkpointStore = yield* CheckpointStore

  const getTurnDiff: CheckpointDiffQueryShape['getTurnDiff'] = Effect.fn('getTurnDiff')(
    function* (input) {
      const operation = 'CheckpointDiffQuery.getTurnDiff'

      if (input.fromTurnCount === input.toTurnCount) {
        return yield* buildEmptyTurnDiff(operation, input)
      }

      const threadContext = yield* projectionSnapshotQuery.getThreadCheckpointContext(
        input.threadId
      )
      const resolvedThreadContext = yield* requireThreadCheckpointContext(
        operation,
        input,
        threadContext
      )
      yield* ensureTurnRangeAvailable(input, resolvedThreadContext)
      const workspaceCwd = yield* requireWorkspaceCwd(operation, input, resolvedThreadContext)
      const fromCheckpointRef = yield* requireCheckpointRef(
        input,
        resolvedThreadContext,
        input.fromTurnCount
      )
      const toCheckpointRef = yield* requireCheckpointRef(
        input,
        resolvedThreadContext,
        input.toTurnCount
      )

      return yield* computeTurnDiff({
        operation,
        checkpointStore,
        request: input,
        workspaceCwd,
        fromCheckpointRef,
        toCheckpointRef,
      })
    }
  )

  const getFullThreadDiff: CheckpointDiffQueryShape['getFullThreadDiff'] = (
    input: OrchestrationGetFullThreadDiffInput
  ) =>
    getTurnDiff({
      threadId: input.threadId,
      fromTurnCount: 0,
      toTurnCount: input.toTurnCount,
    }).pipe(Effect.map((result): OrchestrationGetFullThreadDiffResult => result))

  return {
    getTurnDiff,
    getFullThreadDiff,
  } satisfies CheckpointDiffQueryShape
})

export const CheckpointDiffQueryLive = Layer.effect(CheckpointDiffQuery, make)
