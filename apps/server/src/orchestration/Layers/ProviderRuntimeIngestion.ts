import type { ProviderRuntimeEvent, OrchestrationEvent } from '@orxa-code/contracts'
import { Cause, Effect, Layer, Stream } from 'effect'
import { makeDrainableWorker } from '@orxa-code/shared/DrainableWorker'

import { ProviderService } from '../../provider/Services/ProviderService.ts'
import { ProjectionTurnRepository } from '../../persistence/Services/ProjectionTurns.ts'
import { ProjectionTurnRepositoryLive } from '../../persistence/Layers/ProjectionTurns.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from '../Services/ProviderRuntimeIngestion.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import {
  createProviderRuntimeIngestionStateOps,
  makeProviderRuntimeIngestionCaches,
} from './ProviderRuntimeIngestion.state.ts'
import { createProcessRuntimeEvent } from './ProviderRuntimeIngestion.processEvent.ts'

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: 'thread.turn-start-requested' }
>

type RuntimeIngestionInput =
  | {
      source: 'runtime'
      event: ProviderRuntimeEvent
    }
  | {
      source: 'domain'
      event: TurnStartRequestedDomainEvent
    }

const make = Effect.fn('make')(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService
  const providerService = yield* ProviderService
  const projectionTurnRepository = yield* ProjectionTurnRepository
  const serverSettingsService = yield* ServerSettingsService

  const caches = yield* makeProviderRuntimeIngestionCaches()
  const stateOps = createProviderRuntimeIngestionStateOps(caches)

  const processRuntimeEvent = createProcessRuntimeEvent({
    orchestrationEngine,
    providerService,
    projectionTurnRepository,
    serverSettingsService,
    stateOps,
  })

  const processDomainEvent = () => Effect.void

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === 'runtime' ? processRuntimeEvent(input.event) : processDomainEvent()

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause(cause => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause)
        }
        return Effect.logWarning('provider runtime ingestion failed to process event', {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        })
      })
    )

  const worker = yield* makeDrainableWorker(processInputSafely)

  const start: ProviderRuntimeIngestionShape['start'] = Effect.fn('start')(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(providerService.streamEvents, event =>
        worker.enqueue({ source: 'runtime', event })
      )
    )
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, event => {
        if (event.type !== 'thread.turn-start-requested') {
          return Effect.void
        }
        return worker.enqueue({ source: 'domain', event })
      })
    )
  })

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape
})

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make()
).pipe(Layer.provide(ProjectionTurnRepositoryLive))
