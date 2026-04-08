import type { OrchestrationEvent } from '@orxa-code/contracts'
import { expect, it } from 'vitest'

import { createEmptyReadModel } from './projector.ts'
import {
  applyEvent,
  applyEvents,
  makeEvent,
  makeThreadCreatedEvent,
} from './projector.test.helpers.ts'

it('caps message and checkpoint retention for long-lived threads', async () => {
  const createdAt = '2026-03-01T10:00:00.000Z'
  const afterCreate = await applyEvent(
    createEmptyReadModel(createdAt),
    makeThreadCreatedEvent({
      occurredAt: createdAt,
      aggregateId: 'thread-capped',
      threadId: 'thread-capped',
      title: 'capped',
      model: 'gpt-5-codex',
      commandId: 'cmd-create-capped',
    })
  )

  const messageEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
    { length: 2_100 },
    (_, index) =>
      makeEvent({
        sequence: index + 2,
        type: 'thread.message-sent',
        aggregateKind: 'thread',
        aggregateId: 'thread-capped',
        occurredAt: `2026-03-01T10:00:${String(index % 60).padStart(2, '0')}.000Z`,
        commandId: `cmd-message-${index}`,
        payload: {
          threadId: 'thread-capped',
          messageId: `msg-${index}`,
          role: 'assistant',
          text: `message-${index}`,
          turnId: `turn-${index}`,
          streaming: false,
          createdAt: `2026-03-01T10:00:${String(index % 60).padStart(2, '0')}.000Z`,
          updatedAt: `2026-03-01T10:00:${String(index % 60).padStart(2, '0')}.000Z`,
        },
      })
  )
  const afterMessages = await applyEvents(afterCreate, messageEvents)

  const checkpointEvents: ReadonlyArray<OrchestrationEvent> = Array.from(
    { length: 600 },
    (_, index) =>
      makeEvent({
        sequence: index + 2_102,
        type: 'thread.turn-diff-completed',
        aggregateKind: 'thread',
        aggregateId: 'thread-capped',
        occurredAt: `2026-03-01T10:30:${String(index % 60).padStart(2, '0')}.000Z`,
        commandId: `cmd-checkpoint-${index}`,
        payload: {
          threadId: 'thread-capped',
          turnId: `turn-${index}`,
          checkpointTurnCount: index + 1,
          checkpointRef: `refs/orxacode/checkpoints/thread-capped/turn/${index + 1}`,
          status: 'ready',
          files: [],
          assistantMessageId: `msg-${index}`,
          completedAt: `2026-03-01T10:30:${String(index % 60).padStart(2, '0')}.000Z`,
        },
      })
  )
  const finalState = await applyEvents(afterMessages, checkpointEvents)

  const thread = finalState.threads[0]
  expect(thread?.messages).toHaveLength(2_000)
  expect(thread?.messages[0]?.id).toBe('msg-100')
  expect(thread?.messages.at(-1)?.id).toBe('msg-2099')
  expect(thread?.checkpoints).toHaveLength(500)
  expect(thread?.checkpoints[0]?.turnId).toBe('turn-100')
  expect(thread?.checkpoints.at(-1)?.turnId).toBe('turn-599')
})
