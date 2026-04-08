import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CommandId, EventId, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { afterEach, expect, it } from 'vitest'

import { checkpointRefForThreadTurn } from '../../checkpointing/Utils.ts'
import {
  asTurnId,
  createCheckpointHarnessController,
  gitRefExists,
  waitForGitRefExists,
} from './CheckpointReactor.test.helpers.ts'

const controller = createCheckpointHarnessController()

afterEach(async () => {
  await controller.cleanup()
})

it('ignores non-v2 checkpoint.captured runtime events', async () => {
  const harness = await controller.createHarness()
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-checkpoint-captured'),
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

  harness.provider.emit({
    type: 'checkpoint.captured',
    eventId: EventId.makeUnsafe('evt-checkpoint-captured-3'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: ThreadId.makeUnsafe('thread-1'),
    turnId: asTurnId('turn-3'),
    turnCount: 3,
    status: 'completed',
  })

  await harness.drain()
  const readModel = await Effect.runPromise(harness.engine.getReadModel())
  const thread = readModel.threads.find(entry => entry.id === ThreadId.makeUnsafe('thread-1'))
  expect(thread?.checkpoints.some(checkpoint => checkpoint.checkpointTurnCount === 3)).toBe(false)
})

it('continues processing runtime events after a single checkpoint runtime failure', async () => {
  const nonRepositorySessionCwd = fs.mkdtempSync(
    path.join(os.tmpdir(), 'orxa-checkpoint-runtime-non-repo-')
  )

  const harness = await controller.createHarness({
    seedFilesystemCheckpoints: false,
    providerSessionCwd: nonRepositorySessionCwd,
  })
  const createdAt = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-non-repo-runtime'),
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

  harness.provider.emit({
    type: 'turn.completed',
    eventId: EventId.makeUnsafe('evt-runtime-capture-failure'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: ThreadId.makeUnsafe('thread-1'),
    turnId: asTurnId('turn-runtime-failure'),
    payload: { state: 'completed' },
  })

  harness.provider.emit({
    type: 'turn.started',
    eventId: EventId.makeUnsafe('evt-turn-started-after-runtime-failure'),
    provider: 'codex',
    createdAt: new Date().toISOString(),
    threadId: ThreadId.makeUnsafe('thread-1'),
    turnId: asTurnId('turn-after-runtime-failure'),
  })

  await waitForGitRefExists(
    harness.cwd,
    checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 0)
  )
  expect(
    gitRefExists(harness.cwd, checkpointRefForThreadTurn(ThreadId.makeUnsafe('thread-1'), 0))
  ).toBe(true)
  fs.rmSync(nonRepositorySessionCwd, { recursive: true, force: true })
})
