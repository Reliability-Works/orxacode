import { expect, it } from 'vitest'

import { createEmptyReadModel } from './projector.ts'
import { makePruningRevertEvents } from './projector.revert.fixtures.ts'
import { applyEvent, applyEvents, makeThreadCreatedEvent } from './projector.test.helpers.ts'

it('prunes reverted turn messages from in-memory thread snapshot', async () => {
  const createdAt = '2026-02-23T10:00:00.000Z'
  const afterCreate = await applyEvent(
    createEmptyReadModel(createdAt),
    makeThreadCreatedEvent({ occurredAt: createdAt })
  )

  const afterRevert = await applyEvents(afterCreate, makePruningRevertEvents())

  const thread = afterRevert.threads[0]
  expect(thread?.messages.map(message => ({ role: message.role, text: message.text }))).toEqual([
    { role: 'user', text: 'First edit' },
    { role: 'assistant', text: 'Updated README to v2.\n' },
  ])
  expect(
    thread?.activities.map(activity => ({ id: activity.id, turnId: activity.turnId }))
  ).toEqual([{ id: 'activity-1', turnId: 'turn-1' }])
  expect(thread?.checkpoints.map(checkpoint => checkpoint.checkpointTurnCount)).toEqual([1])
  expect(thread?.latestTurn?.turnId).toBe('turn-1')
})
