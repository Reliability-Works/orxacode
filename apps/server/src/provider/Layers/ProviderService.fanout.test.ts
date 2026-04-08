import { Effect, Fiber, Ref, Stream } from 'effect'
import { assert } from '@effect/vitest'

import { ProviderService } from '../Services/ProviderService.ts'
import type { ProviderRuntimeEvent } from '@orxa-code/contracts'
import {
  asEventId,
  asThreadId,
  asTurnId,
  type LegacyProviderRuntimeEvent,
  makeProviderServiceLayer,
  sleep,
} from './ProviderService.test.helpers.ts'

const fanout = makeProviderServiceLayer()
const codex = fanout.codex!

fanout.layer('ProviderServiceLive turn-completion fanout', it => {
  it.effect('fans out adapter turn completion events', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService
      const session = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        runtimeMode: 'full-access',
      })

      const eventsRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([])
      const consumer = yield* Stream.runForEach(provider.streamEvents, event =>
        Ref.update(eventsRef, current => [...current, event])
      ).pipe(Effect.forkChild)
      yield* sleep(50)

      const completedEvent: LegacyProviderRuntimeEvent = {
        type: 'turn.completed',
        eventId: asEventId('evt-1'),
        provider: 'codex',
        createdAt: new Date().toISOString(),
        threadId: session.threadId,
        turnId: asTurnId('turn-1'),
        status: 'completed',
      }

      codex.emit(completedEvent)
      yield* sleep(50)

      const events = yield* Ref.get(eventsRef)
      yield* Fiber.interrupt(consumer)

      assert.equal(
        events.some(entry => entry.type === 'turn.completed'),
        true
      )
    })
  )
})

fanout.layer('ProviderServiceLive ordered fanout', it => {
  it.effect('fans out canonical runtime events in emission order', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService
      const session = yield* provider.startSession(asThreadId('thread-seq'), {
        provider: 'codex',
        threadId: asThreadId('thread-seq'),
        runtimeMode: 'full-access',
      })

      const receivedRef = yield* Ref.make<Array<ProviderRuntimeEvent>>([])
      const consumer = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach(event => Ref.update(receivedRef, current => [...current, event])),
        Effect.forkChild
      )
      yield* sleep(50)

      codex.emit({
        type: 'tool.started',
        eventId: asEventId('evt-seq-1'),
        provider: 'codex',
        createdAt: new Date().toISOString(),
        threadId: session.threadId,
        turnId: asTurnId('turn-1'),
        toolKind: 'command',
        title: 'Ran command',
      })
      codex.emit({
        type: 'tool.completed',
        eventId: asEventId('evt-seq-2'),
        provider: 'codex',
        createdAt: new Date().toISOString(),
        threadId: session.threadId,
        turnId: asTurnId('turn-1'),
        toolKind: 'command',
        title: 'Ran command',
      })
      codex.emit({
        type: 'turn.completed',
        eventId: asEventId('evt-seq-3'),
        provider: 'codex',
        createdAt: new Date().toISOString(),
        threadId: session.threadId,
        turnId: asTurnId('turn-1'),
        status: 'completed',
      })

      yield* Fiber.join(consumer)
      const received = yield* Ref.get(receivedRef)
      assert.deepEqual(
        received.map(event => event.eventId),
        [asEventId('evt-seq-1'), asEventId('evt-seq-2'), asEventId('evt-seq-3')]
      )
    })
  )
})

fanout.layer('ProviderServiceLive fanout isolation', it => {
  it.effect('keeps subscriber delivery ordered and isolates failing subscribers', () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService
      const session = yield* provider.startSession(asThreadId('thread-1'), {
        provider: 'codex',
        threadId: asThreadId('thread-1'),
        runtimeMode: 'full-access',
      })

      const receivedByHealthy: string[] = []
      const expectedEventIds = new Set<string>(['evt-ordered-1', 'evt-ordered-2', 'evt-ordered-3'])
      const healthyFiber = yield* Stream.take(provider.streamEvents, 3).pipe(
        Stream.runForEach(event =>
          Effect.sync(() => {
            receivedByHealthy.push(event.eventId)
          })
        ),
        Effect.forkChild
      )
      const failingFiber = yield* Stream.take(provider.streamEvents, 1).pipe(
        Stream.runForEach(() => Effect.fail('listener crash')),
        Effect.forkChild
      )
      yield* sleep(50)

      const events: ReadonlyArray<LegacyProviderRuntimeEvent> = [
        {
          type: 'tool.completed',
          eventId: asEventId('evt-ordered-1'),
          provider: 'codex',
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId('turn-1'),
          toolKind: 'command',
          title: 'Ran command',
          detail: 'echo one',
        },
        {
          type: 'message.delta',
          eventId: asEventId('evt-ordered-2'),
          provider: 'codex',
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId('turn-1'),
          delta: 'hello',
        },
        {
          type: 'turn.completed',
          eventId: asEventId('evt-ordered-3'),
          provider: 'codex',
          createdAt: new Date().toISOString(),
          threadId: session.threadId,
          turnId: asTurnId('turn-1'),
          status: 'completed',
        },
      ]

      for (const event of events) {
        codex.emit(event)
      }

      const failingResult = yield* Effect.result(Fiber.join(failingFiber))
      assert.equal(failingResult._tag, 'Failure')
      yield* Fiber.join(healthyFiber)

      assert.deepEqual(
        receivedByHealthy.filter(eventId => expectedEventIds.has(eventId)).slice(0, 3),
        ['evt-ordered-1', 'evt-ordered-2', 'evt-ordered-3']
      )
    })
  )
})
