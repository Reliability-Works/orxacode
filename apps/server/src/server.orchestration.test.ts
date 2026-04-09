import {
  CommandId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ThreadId,
  WS_METHODS,
} from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { assertInclude, assertTrue } from '@effect/vitest/utils'
import { Effect, Stream } from 'effect'

import { PersistenceSqlError } from './persistence/Errors.ts'
import {
  buildAppUnderTest,
  defaultModelSelection,
  getWsServerUrl,
  makeDefaultOrchestrationReadModel,
  makeRevertedEvent,
  provideServerTest,
  withWsRpcClient,
} from './server.test.helpers.ts'

const buildOrchestrationSuccessApp = (now: string) =>
  buildAppUnderTest({
    layers: {
      projectionSnapshotQuery: {
        getSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 1,
            updatedAt: now,
            projects: [
              {
                id: ProjectId.makeUnsafe('project-a'),
                title: 'Project A',
                workspaceRoot: '/tmp/project-a',
                defaultModelSelection,
                scripts: [],
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              },
            ],
            threads: [
              {
                id: ThreadId.makeUnsafe('thread-1'),
                projectId: ProjectId.makeUnsafe('project-a'),
                title: 'Thread A',
                modelSelection: defaultModelSelection,
                interactionMode: 'default' as const,
                runtimeMode: 'full-access' as const,
                branch: null,
                worktreePath: null,
                handoff: null,
                createdAt: now,
                updatedAt: now,
                archivedAt: null,
                latestTurn: null,
                messages: [],
                session: null,
                activities: [],
                proposedPlans: [],
                checkpoints: [],
                deletedAt: null,
              },
            ],
          }),
      },
      orchestrationEngine: {
        dispatch: () => Effect.succeed({ sequence: 7 }),
        readEvents: () => Stream.empty,
      },
      checkpointDiffQuery: {
        getTurnDiff: () =>
          Effect.succeed({
            threadId: ThreadId.makeUnsafe('thread-1'),
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: 'turn-diff',
          }),
        getFullThreadDiff: () =>
          Effect.succeed({
            threadId: ThreadId.makeUnsafe('thread-1'),
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: 'full-diff',
          }),
      },
    },
  })

it.effect('routes websocket rpc orchestration snapshot and dispatch', () =>
  provideServerTest(
    Effect.gen(function* () {
      const now = new Date().toISOString()
      yield* buildOrchestrationSuccessApp(now)

      const wsUrl = yield* getWsServerUrl('/ws')
      const snapshotResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[ORCHESTRATION_WS_METHODS.getSnapshot]({}))
      )
      assert.equal(snapshotResult.snapshotSequence, 1)

      const dispatchResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[ORCHESTRATION_WS_METHODS.dispatchCommand]({
            type: 'thread.session.stop',
            commandId: CommandId.makeUnsafe('cmd-1'),
            threadId: ThreadId.makeUnsafe('thread-1'),
            createdAt: now,
          })
        )
      )
      assert.equal(dispatchResult.sequence, 7)
    })
  )
)

it.effect('routes websocket rpc orchestration diff and replay helpers', () =>
  provideServerTest(
    Effect.gen(function* () {
      const now = new Date().toISOString()
      yield* buildOrchestrationSuccessApp(now)

      const wsUrl = yield* getWsServerUrl('/ws')
      const turnDiffResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[ORCHESTRATION_WS_METHODS.getTurnDiff]({
            threadId: ThreadId.makeUnsafe('thread-1'),
            fromTurnCount: 0,
            toTurnCount: 1,
          })
        )
      )
      assert.equal(turnDiffResult.diff, 'turn-diff')

      const fullDiffResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[ORCHESTRATION_WS_METHODS.getFullThreadDiff]({
            threadId: ThreadId.makeUnsafe('thread-1'),
            toTurnCount: 1,
          })
        )
      )
      assert.equal(fullDiffResult.diff, 'full-diff')

      const replayResult = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[ORCHESTRATION_WS_METHODS.replayEvents]({
            fromSequenceExclusive: 0,
          })
        )
      )
      assert.deepEqual(replayResult, [])
    })
  )
)

it.effect(
  'routes websocket rpc subscribeOrchestrationDomainEvents with replay/live overlap resilience',
  () =>
    provideServerTest(
      Effect.gen(function* () {
        const now = new Date().toISOString()
        const threadId = ThreadId.makeUnsafe('thread-1')
        let replayCursor: number | null = null

        yield* buildAppUnderTest({
          layers: {
            orchestrationEngine: {
              getReadModel: () =>
                Effect.succeed({
                  ...makeDefaultOrchestrationReadModel(),
                  snapshotSequence: 1,
                }),
              readEvents: fromSequenceExclusive => {
                replayCursor = fromSequenceExclusive
                return Stream.make(
                  makeRevertedEvent(threadId, now, 2),
                  makeRevertedEvent(threadId, now, 3)
                )
              },
              streamDomainEvents: Stream.make(
                makeRevertedEvent(threadId, now, 3),
                makeRevertedEvent(threadId, now, 4)
              ),
            },
          },
        })

        const wsUrl = yield* getWsServerUrl('/ws')
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, client =>
            client[WS_METHODS.subscribeOrchestrationDomainEvents]({}).pipe(
              Stream.take(3),
              Stream.runCollect
            )
          )
        )

        assert.equal(replayCursor, 1)
        assert.deepEqual(
          Array.from(events).map(event => event.sequence),
          [2, 3, 4]
        )
      })
    )
)

it.effect('routes websocket rpc orchestration.getSnapshot errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          projectionSnapshotQuery: {
            getSnapshot: () =>
              Effect.fail(
                new PersistenceSqlError({
                  operation: 'ProjectionSnapshotQuery.getSnapshot',
                  detail: 'projection unavailable',
                })
              ),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})).pipe(
          Effect.result
        )
      )

      assertTrue(result._tag === 'Failure')
      assertTrue(result.failure._tag === 'OrchestrationGetSnapshotError')
      assertInclude(result.failure.message, 'Failed to load orchestration snapshot')
    })
  )
)
