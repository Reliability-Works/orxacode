import fs from 'node:fs'
import path from 'node:path'

import { CommandId, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'
import {
  asTurnId,
  createCheckpointHarnessController,
  gitRefExists,
  waitForEvent,
  waitForThread,
} from './CheckpointReactor.test.helpers.ts'

const controller = createCheckpointHarnessController()

afterEach(async () => {
  await controller.cleanup()
})

async function seedRevertableCheckpoints(
  harness: Awaited<ReturnType<typeof controller.createHarness>>,
  createdAt: string,
  firstCommandId: string,
  secondCommandId: string,
  firstTurnId: string,
  secondTurnId: string
) {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.diff.complete',
      commandId: CommandId.makeUnsafe(firstCommandId),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: asTurnId(firstTurnId),
      completedAt: createdAt,
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 1),
      status: 'ready',
      files: [],
      checkpointTurnCount: 1,
      createdAt,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.diff.complete',
      commandId: CommandId.makeUnsafe(secondCommandId),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: asTurnId(secondTurnId),
      completedAt: createdAt,
      checkpointRef: checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 2),
      status: 'ready',
      files: [],
      checkpointTurnCount: 2,
      createdAt,
    })
  )
}

it('executes provider revert and emits thread.reverted for checkpoint revert requests', async () => {
  const harness = await controller.createHarness()
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: createdAt,
      },
      createdAt,
    })
  )

  await seedRevertableCheckpoints(
    harness,
    createdAt,
    'cmd-diff-1',
    'cmd-diff-2',
    'turn-1',
    'turn-2'
  )

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.checkpoint.revert',
      commandId: CommandId.makeUnsafe('cmd-revert-request'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 1,
      createdAt,
    })
  )

  await waitForEvent(harness.engine, event => event.type === 'thread.reverted')
  const thread = await waitForThread(harness.engine, entry => entry.checkpoints.length === 1)

  expect(thread.latestTurn?.turnId).toBe('turn-1')
  expect(thread.checkpoints).toHaveLength(1)
  expect(thread.checkpoints[0]?.checkpointTurnCount).toBe(1)
  expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(1)
  expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({
    threadId: ThreadId.makeUnsafe('thread-1'),
    numTurns: 1,
  })
  expect(fs.readFileSync(path.join(harness.cwd, 'README.md'), 'utf8')).toBe('v2\n')
  expect(
    gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 2))
  ).toBe(false)
})

it('executes provider revert and emits thread.reverted for claude sessions', async () => {
  const harness = await controller.createHarness({ providerName: 'claudeAgent' })
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-claude'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'claudeAgent',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: createdAt,
      },
      createdAt,
    })
  )

  await seedRevertableCheckpoints(
    harness,
    createdAt,
    'cmd-diff-claude-1',
    'cmd-diff-claude-2',
    'turn-claude-1',
    'turn-claude-2'
  )

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.checkpoint.revert',
      commandId: CommandId.makeUnsafe('cmd-revert-request-claude'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 1,
      createdAt,
    })
  )

  await waitForEvent(harness.engine, event => event.type === 'thread.reverted')
  expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(1)
  expect(harness.provider.rollbackConversation).toHaveBeenCalledWith({
    threadId: ThreadId.makeUnsafe('thread-1'),
    numTurns: 1,
  })
})

it('processes consecutive revert requests with deterministic rollback sequencing', async () => {
  const harness = await controller.createHarness()
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-inline-revert'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: createdAt,
      },
      createdAt,
    })
  )

  await seedRevertableCheckpoints(
    harness,
    createdAt,
    'cmd-inline-revert-diff-1',
    'cmd-inline-revert-diff-2',
    'turn-1',
    'turn-2'
  )

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.checkpoint.revert',
      commandId: CommandId.makeUnsafe('cmd-sequenced-revert-request-1'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 1,
      createdAt,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.checkpoint.revert',
      commandId: CommandId.makeUnsafe('cmd-sequenced-revert-request-0'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 0,
      createdAt,
    })
  )

  await harness.drain()

  expect(harness.provider.rollbackConversation).toHaveBeenCalledTimes(2)
  expect(harness.provider.rollbackConversation.mock.calls[0]?.[0]).toEqual({
    threadId: ThreadId.makeUnsafe('thread-1'),
    numTurns: 1,
  })
  expect(harness.provider.rollbackConversation.mock.calls[1]?.[0]).toEqual({
    threadId: ThreadId.makeUnsafe('thread-1'),
    numTurns: 1,
  })
})

it('appends an error activity when revert is requested without an active session', async () => {
  const harness = await controller.createHarness({ hasSession: false })
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.checkpoint.revert',
      commandId: CommandId.makeUnsafe('cmd-revert-no-session'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnCount: 1,
      createdAt,
    })
  )

  const thread = await waitForThread(harness.engine, entry =>
    entry.activities.some(activity => activity.kind === 'checkpoint.revert.failed')
  )

  expect(thread.activities.some(activity => activity.kind === 'checkpoint.revert.failed')).toBe(
    true
  )
  expect(harness.provider.rollbackConversation).not.toHaveBeenCalled()
})
