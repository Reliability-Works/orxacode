import { assert, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { OrchestrationIntegrationHarness } from './OrchestrationEngineHarness.integration.ts'
import { gitShowFileAtRef } from './OrchestrationEngineHarness.integration.ts'
import {
  seedProjectAndThread,
  THREAD_ID,
  withHarness,
} from './orchestrationEngine.integration.helpers.ts'
import { runReadmeEditTurn } from './orchestrationEngine.checkpoint.integration.helpers.ts'
import { checkpointRefForThreadTurn } from '../src/checkpointing/Utils.ts'
function assertCheckpointDiffState(harness: OrchestrationIntegrationHarness) {
  return Effect.gen(function* () {
    const secondTurnThread = yield* harness.waitForThread(
      THREAD_ID,
      entry =>
        entry.latestTurn?.turnId === 'turn-2' &&
        entry.checkpoints.length === 2 &&
        entry.checkpoints.some(checkpoint => checkpoint.checkpointTurnCount === 2)
    )
    const secondCheckpoint = secondTurnThread.checkpoints.find(
      checkpoint => checkpoint.checkpointTurnCount === 2
    )
    assert.equal(
      secondCheckpoint?.files.some(file => file.path === 'README.md'),
      true
    )

    const checkpointRows = yield* harness.checkpointRepository.listByThreadId({
      threadId: THREAD_ID,
    })
    assert.deepEqual(
      checkpointRows.map(row => row.checkpointTurnCount),
      [1, 2]
    )

    const incrementalDiff = yield* harness.checkpointStore.diffCheckpoints({
      cwd: harness.workspaceDir,
      fromCheckpointRef: checkpointRefForThreadTurn(THREAD_ID, 1),
      toCheckpointRef: checkpointRefForThreadTurn(THREAD_ID, 2),
      fallbackFromToHead: false,
    })
    const fullDiff = yield* harness.checkpointStore.diffCheckpoints({
      cwd: harness.workspaceDir,
      fromCheckpointRef: checkpointRefForThreadTurn(THREAD_ID, 0),
      toCheckpointRef: checkpointRefForThreadTurn(THREAD_ID, 2),
      fallbackFromToHead: false,
    })
    assert.equal(incrementalDiff.includes('README.md'), true)
    assert.equal(fullDiff.includes('README.md'), true)
    assert.equal(
      gitShowFileAtRef(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 1), 'README.md'),
      'v2\n'
    )
    assert.equal(
      gitShowFileAtRef(harness.workspaceDir, checkpointRefForThreadTurn(THREAD_ID, 2), 'README.md'),
      'v3\n'
    )
  })
}

it.live('runs multi-turn file edits and persists checkpoint diffs', () =>
  withHarness(harness =>
    Effect.gen(function* () {
      yield* seedProjectAndThread(harness)

      yield* runReadmeEditTurn(harness, {
        turnStartedEventId: 'evt-multi-1',
        turnStartedAt: '2026-02-24T10:01:00.000Z',
        toolStartedEventId: 'evt-multi-2',
        toolStartedAt: '2026-02-24T10:01:00.100Z',
        toolCompletedEventId: 'evt-multi-3',
        toolCompletedAt: '2026-02-24T10:01:00.200Z',
        messageEventId: 'evt-multi-4',
        messageAt: '2026-02-24T10:01:00.300Z',
        messageText: 'Updated README to v2.\n',
        turnCompletedEventId: 'evt-multi-5',
        turnCompletedAt: '2026-02-24T10:01:00.400Z',
        readmeContent: 'v2\n',
        commandId: 'cmd-turn-start-multi-1',
        messageId: 'msg-user-multi-1',
        text: 'Make first edit',
        nextSession: true,
      })
      yield* harness.waitForReceipt(
        receipt =>
          receipt.type === 'checkpoint.diff.finalized' &&
          receipt.threadId === THREAD_ID &&
          receipt.checkpointTurnCount === 1
      )
      yield* harness.waitForThread(
        THREAD_ID,
        entry => entry.checkpoints.length === 1 && entry.session?.threadId === 'thread-1'
      )

      yield* runReadmeEditTurn(harness, {
        turnStartedEventId: 'evt-multi-6',
        turnStartedAt: '2026-02-24T10:02:00.000Z',
        toolStartedEventId: 'evt-multi-6-tool-started',
        toolStartedAt: '2026-02-24T10:02:00.050Z',
        toolCompletedEventId: 'evt-multi-6-tool-completed',
        toolCompletedAt: '2026-02-24T10:02:00.075Z',
        messageEventId: 'evt-multi-7',
        messageAt: '2026-02-24T10:02:00.100Z',
        messageText: 'Updated README to v3.\n',
        turnCompletedEventId: 'evt-multi-8',
        turnCompletedAt: '2026-02-24T10:02:00.200Z',
        readmeContent: 'v3\n',
        commandId: 'cmd-turn-start-multi-2',
        messageId: 'msg-user-multi-2',
        text: 'Make second edit',
      })

      const secondReceipt = yield* harness.waitForReceipt(
        receipt =>
          receipt.type === 'checkpoint.diff.finalized' &&
          receipt.threadId === THREAD_ID &&
          receipt.checkpointTurnCount === 2
      )
      if (secondReceipt.type !== 'checkpoint.diff.finalized') {
        throw new Error('Expected checkpoint.diff.finalized receipt.')
      }
      assert.equal(secondReceipt.status, 'ready')
      yield* harness.waitForReceipt(
        receipt =>
          receipt.type === 'turn.processing.quiesced' &&
          receipt.threadId === THREAD_ID &&
          receipt.checkpointTurnCount === 2
      )
      yield* assertCheckpointDiffState(harness)
    })
  )
)
