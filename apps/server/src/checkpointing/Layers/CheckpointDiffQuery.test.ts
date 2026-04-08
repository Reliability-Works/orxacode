import { CheckpointRef, ProjectId, ThreadId, TurnId } from '@orxa-code/contracts'
import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  ProjectionSnapshotQuery,
  type ProjectionThreadCheckpointContext,
} from '../../orchestration/Services/ProjectionSnapshotQuery.ts'
import { checkpointRefForThreadTurn } from '../Utils.ts'
import { CheckpointDiffQueryLive } from './CheckpointDiffQuery.ts'
import { CheckpointStore, type CheckpointStoreShape } from '../Services/CheckpointStore.ts'
import { CheckpointDiffQuery } from '../Services/CheckpointDiffQuery.ts'

function makeThreadCheckpointContext(input: {
  readonly projectId: ProjectId
  readonly threadId: ThreadId
  readonly workspaceRoot: string
  readonly worktreePath: string | null
  readonly checkpointTurnCount: number
  readonly checkpointRef: CheckpointRef
}): ProjectionThreadCheckpointContext {
  return {
    threadId: input.threadId,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
    worktreePath: input.worktreePath,
    checkpoints: [
      {
        turnId: TurnId.makeUnsafe('turn-1'),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: input.checkpointRef,
        status: 'ready',
        files: [],
        assistantMessageId: null,
        completedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

function makeProjectionSnapshotQueryLayer(
  threadCheckpointContext: Option.Option<ProjectionThreadCheckpointContext>
) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () =>
      Effect.die('CheckpointDiffQuery should not request the full orchestration snapshot'),
    getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(threadCheckpointContext),
  })
}

function makeHappyPathCheckpointStore() {
  const hasCheckpointRefCalls: Array<CheckpointRef> = []
  const diffCheckpointsCalls: Array<{
    readonly fromCheckpointRef: CheckpointRef
    readonly toCheckpointRef: CheckpointRef
    readonly cwd: string
  }> = []

  const checkpointStore: CheckpointStoreShape = {
    isGitRepository: () => Effect.succeed(true),
    captureCheckpoint: () => Effect.void,
    hasCheckpointRef: ({ checkpointRef }) =>
      Effect.sync(() => {
        hasCheckpointRefCalls.push(checkpointRef)
        return true
      }),
    restoreCheckpoint: () => Effect.succeed(true),
    diffCheckpoints: ({ fromCheckpointRef, toCheckpointRef, cwd }) =>
      Effect.sync(() => {
        diffCheckpointsCalls.push({ fromCheckpointRef, toCheckpointRef, cwd })
        return 'diff patch'
      }),
    deleteCheckpointRefs: () => Effect.void,
  }

  return { checkpointStore, hasCheckpointRefCalls, diffCheckpointsCalls }
}

function makePassiveCheckpointStore(): CheckpointStoreShape {
  return {
    isGitRepository: () => Effect.succeed(true),
    captureCheckpoint: () => Effect.void,
    hasCheckpointRef: () => Effect.succeed(true),
    restoreCheckpoint: () => Effect.succeed(true),
    diffCheckpoints: () => Effect.succeed(''),
    deleteCheckpointRefs: () => Effect.void,
  }
}

function makeCheckpointDiffLayer(
  checkpointStore: CheckpointStoreShape,
  threadCheckpointContext: Option.Option<ProjectionThreadCheckpointContext>
) {
  return CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(Layer.succeed(CheckpointStore, checkpointStore)),
    Layer.provideMerge(makeProjectionSnapshotQueryLayer(threadCheckpointContext))
  )
}

function getTurnDiff(layer: Layer.Layer<CheckpointDiffQuery, never, never>, threadId: ThreadId) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const query = yield* CheckpointDiffQuery
      return yield* query.getTurnDiff({
        threadId,
        fromTurnCount: 0,
        toTurnCount: 1,
      })
    }).pipe(Effect.provide(layer))
  )
}

describe('CheckpointDiffQueryLive', () => {
  it('computes diffs using canonical turn-0 checkpoint refs', async () => {
    const projectId = ProjectId.makeUnsafe('project-1')
    const threadId = ThreadId.makeUnsafe('thread-1')
    const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1)
    const { checkpointStore, hasCheckpointRefCalls, diffCheckpointsCalls } =
      makeHappyPathCheckpointStore()
    const threadCheckpointContext = makeThreadCheckpointContext({
      projectId,
      threadId,
      workspaceRoot: '/tmp/workspace',
      worktreePath: null,
      checkpointTurnCount: 1,
      checkpointRef: toCheckpointRef,
    })

    const layer = makeCheckpointDiffLayer(checkpointStore, Option.some(threadCheckpointContext))
    const result = await getTurnDiff(layer, threadId)

    const expectedFromRef = checkpointRefForThreadTurn(threadId, 0)
    expect(hasCheckpointRefCalls).toEqual([expectedFromRef, toCheckpointRef])
    expect(diffCheckpointsCalls).toEqual([
      {
        cwd: '/tmp/workspace',
        fromCheckpointRef: expectedFromRef,
        toCheckpointRef,
      },
    ])
    expect(result).toEqual({
      threadId,
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: 'diff patch',
    })
  })

  it('fails when the thread is missing from the snapshot', async () => {
    const threadId = ThreadId.makeUnsafe('thread-missing')
    const layer = makeCheckpointDiffLayer(makePassiveCheckpointStore(), Option.none())

    await expect(getTurnDiff(layer, threadId)).rejects.toThrow("Thread 'thread-missing' not found.")
  })
})
