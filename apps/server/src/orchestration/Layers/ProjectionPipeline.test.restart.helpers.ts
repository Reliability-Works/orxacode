import {
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { makeSqlitePersistenceLive } from '../../persistence/Layers/Sqlite.ts'
import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'
import { ServerConfig } from '../../config.ts'

interface RestartIds {
  readonly threadId: ThreadId
  readonly turnId: TurnId
  readonly messageId: MessageId
  readonly sourcePlanThreadId: ThreadId
  readonly sourcePlanId: string
  readonly turnStartedAt: string
  readonly sessionSetAt: string
}

const seedTurnStartRequested = (ids: RestartIds) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore
    const projectionPipeline = yield* OrchestrationProjectionPipeline

    yield* eventStore.append({
      type: 'thread.turn-start-requested',
      eventId: EventId.makeUnsafe('evt-restart-1'),
      aggregateKind: 'thread',
      aggregateId: ids.threadId,
      occurredAt: ids.turnStartedAt,
      commandId: CommandId.makeUnsafe('cmd-restart-1'),
      causationEventId: null,
      correlationId: CorrelationId.makeUnsafe('cmd-restart-1'),
      metadata: {},
      payload: {
        threadId: ids.threadId,
        messageId: ids.messageId,
        sourceProposedPlan: {
          threadId: ids.sourcePlanThreadId,
          planId: ids.sourcePlanId,
        },
        runtimeMode: 'approval-required',
        createdAt: ids.turnStartedAt,
      },
    })

    yield* projectionPipeline.bootstrap
  })

const queryTurnRowsAfterSessionSet = (ids: RestartIds) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore
    const projectionPipeline = yield* OrchestrationProjectionPipeline
    const sql = yield* SqlClient.SqlClient

    yield* eventStore.append({
      type: 'thread.session-set',
      eventId: EventId.makeUnsafe('evt-restart-2'),
      aggregateKind: 'thread',
      aggregateId: ids.threadId,
      occurredAt: ids.sessionSetAt,
      commandId: CommandId.makeUnsafe('cmd-restart-2'),
      causationEventId: null,
      correlationId: CorrelationId.makeUnsafe('cmd-restart-2'),
      metadata: {},
      payload: {
        threadId: ids.threadId,
        session: {
          threadId: ids.threadId,
          status: 'running',
          providerName: 'codex',
          runtimeMode: 'approval-required',
          activeTurnId: ids.turnId,
          lastError: null,
          updatedAt: ids.sessionSetAt,
        },
      },
    })

    yield* projectionPipeline.bootstrap

    const pendingRows = yield* sql<{ readonly threadId: string }>`
      SELECT thread_id AS "threadId"
      FROM projection_turns
      WHERE thread_id = ${ids.threadId}
        AND turn_id IS NULL
        AND state = 'pending'
    `
    assert.deepEqual(pendingRows, [])

    return yield* sql<{
      readonly turnId: string
      readonly userMessageId: string | null
      readonly sourceProposedPlanThreadId: string | null
      readonly sourceProposedPlanId: string | null
      readonly startedAt: string
    }>`
      SELECT
        turn_id AS "turnId",
        pending_message_id AS "userMessageId",
        source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
        source_proposed_plan_id AS "sourceProposedPlanId",
        started_at AS "startedAt"
      FROM projection_turns
      WHERE turn_id = ${ids.turnId}
    `
  })

export function* restorePendingTurnStartMetadataAfterRestartProgram() {
  const { dbPath } = yield* ServerConfig
  const persistenceLayer = makeSqlitePersistenceLive(dbPath)
  const firstProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(persistenceLayer)
  )
  const secondProjectionLayer = OrchestrationProjectionPipelineLive.pipe(
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(persistenceLayer)
  )

  const ids: RestartIds = {
    threadId: ThreadId.makeUnsafe('thread-restart'),
    turnId: TurnId.makeUnsafe('turn-restart'),
    messageId: MessageId.makeUnsafe('message-restart'),
    sourcePlanThreadId: ThreadId.makeUnsafe('thread-plan-source'),
    sourcePlanId: 'plan-source',
    turnStartedAt: '2026-02-26T14:00:00.000Z',
    sessionSetAt: '2026-02-26T14:00:05.000Z',
  }

  yield* seedTurnStartRequested(ids).pipe(Effect.provide(firstProjectionLayer))
  const turnRows = yield* queryTurnRowsAfterSessionSet(ids).pipe(
    Effect.provide(secondProjectionLayer)
  )

  assert.deepEqual(turnRows, [
    {
      turnId: 'turn-restart',
      userMessageId: 'message-restart',
      sourceProposedPlanThreadId: 'thread-plan-source',
      sourceProposedPlanId: 'plan-source',
      startedAt: ids.turnStartedAt,
    },
  ])
}

export function restorePendingTurnStartMetadataAfterRestartEffect() {
  return Effect.gen(restorePendingTurnStartMetadataAfterRestartProgram).pipe(
    Effect.provide(
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), {
          prefix: 'orxa-projection-pipeline-restart-',
        }),
        NodeServices.layer
      )
    )
  )
}
