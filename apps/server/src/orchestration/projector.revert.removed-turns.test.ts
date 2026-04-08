import { expect, it } from 'vitest'

import { createEmptyReadModel } from './projector.ts'
import { makeRemovedTurnRevertEvents } from './projector.revert.fixtures.ts'
import { applyEvent, applyEvents, makeThreadCreatedEvent } from './projector.test.helpers.ts'

it('does not fallback-retain messages tied to removed turn IDs', async () => {
  const createdAt = '2026-02-26T12:00:00.000Z'
  const afterCreate = await applyEvent(
    createEmptyReadModel(createdAt),
    makeThreadCreatedEvent({
      occurredAt: createdAt,
      aggregateId: 'thread-revert',
      threadId: 'thread-revert',
      commandId: 'cmd-create-revert',
    })
  )

  const afterRevert = await applyEvents(afterCreate, makeRemovedTurnRevertEvents())

  const thread = afterRevert.threads[0]
  expect(
    thread?.messages.map(message => ({
      id: message.id,
      role: message.role,
      turnId: message.turnId,
    }))
  ).toEqual([{ id: 'assistant-keep', role: 'assistant', turnId: 'turn-1' }])
})
