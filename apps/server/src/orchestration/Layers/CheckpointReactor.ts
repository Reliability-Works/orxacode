import type { OrchestrationEvent, ProviderRuntimeEvent } from '@orxa-code/contracts'
import { Cause, Effect, Layer, Stream } from 'effect'
import { makeDrainableWorker } from '@orxa-code/shared/DrainableWorker'

import { CheckpointStore } from '../../checkpointing/Services/CheckpointStore.ts'
import { ProviderService } from '../../provider/Services/ProviderService.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import { CheckpointReactor, type CheckpointReactorShape } from '../Services/CheckpointReactor.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import { RuntimeReceiptBus } from '../Services/RuntimeReceiptBus.ts'
import { isGitRepository } from '../../git/Utils.ts'
import { WorkspaceEntries } from '../../workspace/Services/WorkspaceEntries.ts'
import { createCheckpointCaptureHandlers } from './CheckpointReactor.capture.ts'
import { createHandleRevertRequested } from './CheckpointReactor.revert.ts'
import {
  createAppendCaptureFailureActivity,
  createAppendRevertFailureActivity,
  createResolveSessionRuntimeForThread,
  serverCommandId,
} from './CheckpointReactor.shared.ts'

type ReactorInput =
  | {
      readonly source: 'runtime'
      readonly event: ProviderRuntimeEvent
    }
  | {
      readonly source: 'domain'
      readonly event: OrchestrationEvent
    }

type CheckpointCaptureDomainEvent = Extract<
  OrchestrationEvent,
  {
    type: 'thread.turn-start-requested' | 'thread.message-sent' | 'thread.turn-diff-completed'
  }
>

type CheckpointRevertRequestedEvent = Extract<
  OrchestrationEvent,
  { type: 'thread.checkpoint-revert-requested' }
>

function startCheckpointReactorStreams(input: {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
  readonly enqueue: (input: ReactorInput) => Effect.Effect<void>
}) {
  return Effect.fn('start')(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(input.orchestrationEngine.streamDomainEvents, event => {
        if (
          event.type !== 'thread.turn-start-requested' &&
          event.type !== 'thread.message-sent' &&
          event.type !== 'thread.checkpoint-revert-requested' &&
          event.type !== 'thread.turn-diff-completed'
        ) {
          return Effect.void
        }
        return input.enqueue({ source: 'domain', event })
      })
    )

    yield* Effect.forkScoped(
      Stream.runForEach(input.providerService.streamEvents, event => {
        if (event.type !== 'turn.started' && event.type !== 'turn.completed') {
          return Effect.void
        }
        return input.enqueue({ source: 'runtime', event })
      })
    )
  })
}

function createCheckpointDomainEventProcessor<E1, R1, E2 extends { message: string }, R2>(input: {
  readonly processCaptureDomainEvent: (
    event: CheckpointCaptureDomainEvent
  ) => Effect.Effect<void, E1, R1>
  readonly handleRevertRequested: (
    event: CheckpointRevertRequestedEvent
  ) => Effect.Effect<void, E2, R2>
  readonly appendRevertFailureActivity: ReturnType<typeof createAppendRevertFailureActivity>
}) {
  return Effect.fnUntraced(function* (event: OrchestrationEvent) {
    if (event.type === 'thread.checkpoint-revert-requested') {
      yield* input.handleRevertRequested(event).pipe(
        Effect.catch(error =>
          input.appendRevertFailureActivity({
            threadId: event.payload.threadId,
            turnCount: event.payload.turnCount,
            detail: error.message,
            createdAt: new Date().toISOString(),
          })
        )
      )
      return
    }

    if (
      event.type === 'thread.turn-start-requested' ||
      event.type === 'thread.message-sent' ||
      event.type === 'thread.turn-diff-completed'
    ) {
      yield* input.processCaptureDomainEvent(event)
    }
  })
}

function createSafeCheckpointInputProcessor<E, R>(input: {
  readonly processInput: (input: ReactorInput) => Effect.Effect<void, E, R>
}) {
  return (reactorInput: ReactorInput) =>
    input.processInput(reactorInput).pipe(
      Effect.catchCause(cause => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause)
        }
        return Effect.logWarning('checkpoint reactor failed to process input', {
          source: reactorInput.source,
          eventType: reactorInput.event.type,
          cause: Cause.pretty(cause),
        })
      })
    )
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService
  const providerService = yield* ProviderService
  const checkpointStore = yield* CheckpointStore
  const receiptBus = yield* RuntimeReceiptBus
  const workspaceEntries = yield* WorkspaceEntries

  const appendRevertFailureActivity = createAppendRevertFailureActivity(orchestrationEngine)
  const appendCaptureFailureActivity = createAppendCaptureFailureActivity(orchestrationEngine)
  const resolveSessionRuntimeForThread = createResolveSessionRuntimeForThread({
    orchestrationEngine,
    providerService,
  })
  const isGitWorkspace = (cwd: string) => isGitRepository(cwd)

  const { processRuntimeEvent, processDomainEvent: processCaptureDomainEvent } =
    createCheckpointCaptureHandlers({
      orchestrationEngine,
      checkpointStore,
      receiptBus,
      workspaceEntries,
      appendCaptureFailureActivity,
      resolveSessionRuntimeForThread,
    })
  const handleRevertRequested = createHandleRevertRequested({
    orchestrationEngine,
    providerService,
    checkpointStore,
    workspaceEntries,
    resolveSessionRuntimeForThread,
    appendRevertFailureActivity,
    isGitWorkspace,
    serverCommandId,
  })

  const processDomainEvent = createCheckpointDomainEventProcessor({
    processCaptureDomainEvent,
    handleRevertRequested,
    appendRevertFailureActivity,
  })

  const processInput = (input: ReactorInput) =>
    input.source === 'domain' ? processDomainEvent(input.event) : processRuntimeEvent(input.event)
  const processInputSafely = createSafeCheckpointInputProcessor({ processInput })

  const worker = yield* makeDrainableWorker(processInputSafely)
  const start: CheckpointReactorShape['start'] = startCheckpointReactorStreams({
    orchestrationEngine,
    providerService,
    enqueue: worker.enqueue,
  })

  return {
    start,
    drain: worker.drain,
  } satisfies CheckpointReactorShape
})

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make)
