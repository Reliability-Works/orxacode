import { CommandId, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { decideOrchestrationCommand } from './decider.ts'
import { createProjectScriptsReadModel } from './decider.projectScripts.test.helpers.ts'

it('emits thread.runtime-mode-set from thread.runtime-mode.set', async () => {
  const now = new Date().toISOString()
  const readModel = await createProjectScriptsReadModel(now)

  const result = await Effect.runPromise(
    decideOrchestrationCommand({
      command: {
        type: 'thread.runtime-mode.set',
        commandId: CommandId.makeUnsafe('cmd-runtime-mode-set'),
        threadId: ThreadId.makeUnsafe('thread-1'),
        runtimeMode: 'approval-required',
        createdAt: now,
      },
      readModel,
    })
  )

  const singleResult = Array.isArray(result) ? null : result
  if (singleResult === null) {
    throw new Error('Expected a single runtime-mode-set event.')
  }
  expect(singleResult).toMatchObject({
    type: 'thread.runtime-mode-set',
    payload: {
      threadId: ThreadId.makeUnsafe('thread-1'),
      runtimeMode: 'approval-required',
    },
  })
})

it('emits thread.interaction-mode-set from thread.interaction-mode.set', async () => {
  const now = new Date().toISOString()
  const readModel = await createProjectScriptsReadModel(now)

  const result = await Effect.runPromise(
    decideOrchestrationCommand({
      command: {
        type: 'thread.interaction-mode.set',
        commandId: CommandId.makeUnsafe('cmd-interaction-mode-set'),
        threadId: ThreadId.makeUnsafe('thread-1'),
        interactionMode: 'plan',
        createdAt: now,
      },
      readModel,
    })
  )

  const singleResult = Array.isArray(result) ? null : result
  if (singleResult === null) {
    throw new Error('Expected a single interaction-mode-set event.')
  }
  expect(singleResult).toMatchObject({
    type: 'thread.interaction-mode-set',
    payload: {
      threadId: ThreadId.makeUnsafe('thread-1'),
      interactionMode: 'plan',
    },
  })
})
