import { Effect } from 'effect'
import { expect, it } from 'vitest'

import { createEmptyReadModel, projectEvent } from './projector.ts'
import { makeEvent, makeThreadCreatedEvent } from './projector.test.helpers.ts'

it('tracks latest turn id from session lifecycle events', async () => {
  const createdAt = '2026-02-23T08:00:00.000Z'
  const startedAt = '2026-02-23T08:00:05.000Z'
  const model = createEmptyReadModel(createdAt)

  const afterCreate = await Effect.runPromise(
    projectEvent(model, makeThreadCreatedEvent({ occurredAt: createdAt }))
  )

  const afterRunning = await Effect.runPromise(
    projectEvent(
      afterCreate,
      makeEvent({
        sequence: 2,
        type: 'thread.session-set',
        aggregateKind: 'thread',
        aggregateId: 'thread-1',
        occurredAt: startedAt,
        commandId: 'cmd-running',
        payload: {
          threadId: 'thread-1',
          session: {
            threadId: 'thread-1',
            status: 'running',
            providerName: 'codex',
            providerSessionId: 'session-1',
            providerThreadId: 'provider-thread-1',
            runtimeMode: 'approval-required',
            activeTurnId: 'turn-1',
            lastError: null,
            updatedAt: startedAt,
          },
        },
      })
    )
  )

  const thread = afterRunning.threads[0]
  expect(thread?.latestTurn?.turnId).toBe('turn-1')
  expect(thread?.session?.status).toBe('running')
})

it('updates canonical thread runtime mode from thread.runtime-mode-set', async () => {
  const createdAt = '2026-02-23T08:00:00.000Z'
  const updatedAt = '2026-02-23T08:00:05.000Z'
  const model = createEmptyReadModel(createdAt)

  const afterCreate = await Effect.runPromise(
    projectEvent(model, makeThreadCreatedEvent({ occurredAt: createdAt }))
  )

  const afterUpdate = await Effect.runPromise(
    projectEvent(
      afterCreate,
      makeEvent({
        sequence: 2,
        type: 'thread.runtime-mode-set',
        aggregateKind: 'thread',
        aggregateId: 'thread-1',
        occurredAt: updatedAt,
        commandId: 'cmd-runtime-mode-set',
        payload: {
          threadId: 'thread-1',
          runtimeMode: 'approval-required',
          updatedAt,
        },
      })
    )
  )

  expect(afterUpdate.threads[0]?.runtimeMode).toBe('approval-required')
  expect(afterUpdate.threads[0]?.updatedAt).toBe(updatedAt)
})

it('marks assistant messages completed with non-streaming updates', async () => {
  const createdAt = '2026-02-23T09:00:00.000Z'
  const deltaAt = '2026-02-23T09:00:01.000Z'
  const completeAt = '2026-02-23T09:00:03.500Z'
  const model = createEmptyReadModel(createdAt)

  const afterCreate = await Effect.runPromise(
    projectEvent(model, makeThreadCreatedEvent({ occurredAt: createdAt }))
  )

  const afterDelta = await Effect.runPromise(
    projectEvent(
      afterCreate,
      makeEvent({
        sequence: 2,
        type: 'thread.message-sent',
        aggregateKind: 'thread',
        aggregateId: 'thread-1',
        occurredAt: deltaAt,
        commandId: 'cmd-delta',
        payload: {
          threadId: 'thread-1',
          messageId: 'assistant:msg-1',
          role: 'assistant',
          text: 'hello',
          turnId: 'turn-1',
          streaming: true,
          createdAt: deltaAt,
          updatedAt: deltaAt,
        },
      })
    )
  )

  const afterComplete = await Effect.runPromise(
    projectEvent(
      afterDelta,
      makeEvent({
        sequence: 3,
        type: 'thread.message-sent',
        aggregateKind: 'thread',
        aggregateId: 'thread-1',
        occurredAt: completeAt,
        commandId: 'cmd-complete',
        payload: {
          threadId: 'thread-1',
          messageId: 'assistant:msg-1',
          role: 'assistant',
          text: '',
          turnId: 'turn-1',
          streaming: false,
          createdAt: completeAt,
          updatedAt: completeAt,
        },
      })
    )
  )

  const message = afterComplete.threads[0]?.messages[0]
  expect(message?.id).toBe('assistant:msg-1')
  expect(message?.text).toBe('hello')
  expect(message?.streaming).toBe(false)
  expect(message?.updatedAt).toBe(completeAt)
})
