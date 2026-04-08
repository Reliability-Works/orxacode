import { CommandId, DEFAULT_PROVIDER_INTERACTION_MODE, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { decideOrchestrationCommand } from './decider.ts'
import {
  asMessageId,
  createProjectScriptsReadModel,
} from './decider.projectScripts.test.helpers.ts'

it('emits user message and turn-start-requested events for thread.turn.start', async () => {
  const now = new Date().toISOString()
  const readModel = await createProjectScriptsReadModel(now)

  const result = await Effect.runPromise(
    decideOrchestrationCommand({
      command: {
        type: 'thread.turn.start',
        commandId: CommandId.makeUnsafe('cmd-turn-start'),
        threadId: ThreadId.makeUnsafe('thread-1'),
        message: {
          messageId: asMessageId('message-user-1'),
          role: 'user',
          text: 'hello',
          attachments: [],
        },
        modelSelection: {
          provider: 'codex',
          model: 'gpt-5.3-codex',
          options: {
            reasoningEffort: 'high',
            fastMode: true,
          },
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: 'approval-required',
        createdAt: now,
      },
      readModel,
    })
  )

  expect(Array.isArray(result)).toBe(true)
  const events = Array.isArray(result) ? result : [result]
  expect(events).toHaveLength(2)
  expect(events[0]?.type).toBe('thread.message-sent')
  const turnStartEvent = events[1]
  expect(turnStartEvent?.type).toBe('thread.turn-start-requested')
  expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null)
  if (turnStartEvent?.type !== 'thread.turn-start-requested') {
    return
  }
  expect(turnStartEvent.payload).toMatchObject({
    threadId: ThreadId.makeUnsafe('thread-1'),
    messageId: asMessageId('message-user-1'),
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5.3-codex',
      options: {
        reasoningEffort: 'high',
        fastMode: true,
      },
    },
    runtimeMode: 'approval-required',
  })
})
