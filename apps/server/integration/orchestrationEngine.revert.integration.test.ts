import { CommandId } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { OrchestrationIntegrationHarness } from './OrchestrationEngineHarness.integration.ts'
import { gitRefExists } from './OrchestrationEngineHarness.integration.ts'
import {
  nowIso,
  seedProjectAndThread,
  THREAD_ID,
  withHarness,
} from './orchestrationEngine.integration.helpers.ts'
import { runReadmeEditTurn } from './orchestrationEngine.checkpoint.integration.helpers.ts'
import { checkpointRefForThreadTurn } from '../src/checkpointing/Utils.ts'

function assertRevertedCheckpointState(harness: OrchestrationIntegrationHarness) {
  return Effect.gen(function* () {
    const revertedThread = yield* harness.waitForThread(
      THREAD_ID,
      entry => entry.checkpoints.length === 1 && entry.checkpoints[0]?.checkpointTurnCount === 1
    )
    assert.equal(revertedThread.checkpoints[0]?.checkpointTurnCount, 1)
    assert.deepEqual(
      revertedThread.messages.map(message => ({ role: message.role, text: message.text })),
      [
        { role: 'user', text: 'First edit' },
        { role: 'assistant', text: 'Updated README to v2.\n' },
      ]
    )
    assert.equal(
      revertedThread.activities.some(activity => activity.turnId === 'turn-2'),
      false
    )
    assert.equal(
      revertedThread.activities.some(
        activity => activity.turnId === 'turn-1' && activity.kind === 'tool.started'
      ),
      true
    )
    assert.equal(
      revertedThread.activities.some(
        activity => activity.turnId === 'turn-1' && activity.kind === 'tool.completed'
      ),
      true
    )
    assert.equal(
      gitRefExists(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 2)),
      false
    )
    assert.deepEqual(harness.adapterHarness!.getRollbackCalls(THREAD_ID), [1])

    const checkpointRows = yield* harness.checkpointRepository.listByThreadId({
      threadId: THREAD_ID,
    })
    assert.equal(checkpointRows.length, 1)
  })
}

it.live('reverts to an earlier checkpoint and trims checkpoint projections + git refs', () =>
  withHarness(harness =>
    Effect.gen(function* () {
      yield* seedProjectAndThread(harness)

      yield* runReadmeEditTurn(harness, {
        turnStartedEventId: 'evt-revert-1',
        turnStartedAt: '2026-02-24T10:05:00.000Z',
        toolStartedEventId: 'evt-revert-1-tool-started',
        toolStartedAt: '2026-02-24T10:05:00.025Z',
        toolCompletedEventId: 'evt-revert-1-tool-completed',
        toolCompletedAt: '2026-02-24T10:05:00.035Z',
        messageEventId: 'evt-revert-1a',
        messageAt: '2026-02-24T10:05:00.050Z',
        messageText: 'Updated README to v2.\n',
        turnCompletedEventId: 'evt-revert-2',
        turnCompletedAt: '2026-02-24T10:05:00.100Z',
        readmeContent: 'v2\n',
        commandId: 'cmd-turn-start-revert-1',
        messageId: 'msg-user-revert-1',
        text: 'First edit',
        nextSession: true,
      })
      yield* harness.waitForThread(
        THREAD_ID,
        entry => entry.session?.threadId === 'thread-1' && entry.checkpoints.length === 1
      )

      yield* runReadmeEditTurn(harness, {
        turnStartedEventId: 'evt-revert-3',
        turnStartedAt: '2026-02-24T10:05:01.000Z',
        toolStartedEventId: 'evt-revert-3-tool-started',
        toolStartedAt: '2026-02-24T10:05:01.025Z',
        toolCompletedEventId: 'evt-revert-3-tool-completed',
        toolCompletedAt: '2026-02-24T10:05:01.035Z',
        messageEventId: 'evt-revert-3a',
        messageAt: '2026-02-24T10:05:01.050Z',
        messageText: 'Updated README to v3.\n',
        turnCompletedEventId: 'evt-revert-4',
        turnCompletedAt: '2026-02-24T10:05:01.100Z',
        readmeContent: 'v3\n',
        commandId: 'cmd-turn-start-revert-2',
        messageId: 'msg-user-revert-2',
        text: 'Second edit',
      })
      yield* harness.waitForThread(
        THREAD_ID,
        entry =>
          entry.latestTurn?.turnId === 'turn-2' &&
          entry.checkpoints.length === 2 &&
          entry.activities.some(activity => activity.turnId === 'turn-2'),
        8000
      )

      yield* harness.engine.dispatch({
        type: 'thread.checkpoint.revert',
        commandId: CommandId.makeUnsafe('cmd-checkpoint-revert'),
        threadId: THREAD_ID,
        turnCount: 1,
        createdAt: nowIso(),
      })

      yield* harness.waitForDomainEvent(event => event.type === 'thread.reverted')
      yield* assertRevertedCheckpointState(harness)
    })
  )
)
