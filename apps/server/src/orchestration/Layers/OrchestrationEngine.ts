import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from '@orxa-code/contracts'
import { OrchestrationCommand } from '@orxa-code/contracts'
import { Deferred, Effect, Layer, Option, PubSub, Queue, Schema, Stream } from 'effect'
import * as SqlClient from 'effect/unstable/sql/SqlClient'

import { toPersistenceSqlError } from '../../persistence/Errors.ts'
import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationCommandReceiptRepository } from '../../persistence/Services/OrchestrationCommandReceipts.ts'
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  type OrchestrationDispatchError,
} from '../Errors.ts'
import { decideOrchestrationCommand } from '../decider.ts'
import { createEmptyReadModel, projectEvent } from '../projector.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'
import { ProjectionSnapshotQuery } from '../Services/ProjectionSnapshotQuery.ts'
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from '../Services/OrchestrationEngine.ts'

interface CommandEnvelope {
  command: OrchestrationCommand
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>
}

interface EngineState {
  readModel: OrchestrationReadModel
}

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: 'project' | 'thread'
  readonly aggregateId: ProjectId | ThreadId
} {
  switch (command.type) {
    case 'project.create':
    case 'project.meta.update':
    case 'project.delete':
      return {
        aggregateKind: 'project',
        aggregateId: command.projectId,
      }
    default:
      return {
        aggregateKind: 'thread',
        aggregateId: command.threadId,
      }
  }
}

const reconcileReadModelAfterDispatchFailure = ({
  dispatchStartSequence,
  eventPubSub,
  eventStore,
  state,
}: {
  dispatchStartSequence: number
  eventPubSub: PubSub.PubSub<OrchestrationEvent>
  eventStore: typeof OrchestrationEventStore.Service
  state: EngineState
}) =>
  Effect.gen(function* () {
    const persistedEvents = yield* Stream.runCollect(
      eventStore.readFromSequence(dispatchStartSequence)
    ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)))
    if (persistedEvents.length === 0) {
      return
    }

    let nextReadModel = state.readModel
    for (const persistedEvent of persistedEvents) {
      nextReadModel = yield* projectEvent(nextReadModel, persistedEvent)
    }
    state.readModel = nextReadModel

    for (const persistedEvent of persistedEvents) {
      yield* PubSub.publish(eventPubSub, persistedEvent)
    }
  })

const resolveExistingReceipt = ({
  command,
  commandReceiptRepository,
  result,
}: {
  command: OrchestrationCommand
  commandReceiptRepository: typeof OrchestrationCommandReceiptRepository.Service
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>
}) =>
  Effect.gen(function* () {
    const existingReceipt = yield* commandReceiptRepository.getByCommandId({
      commandId: command.commandId,
    })
    if (Option.isNone(existingReceipt)) {
      return false
    }

    if (existingReceipt.value.status === 'accepted') {
      yield* Deferred.succeed(result, {
        sequence: existingReceipt.value.resultSequence,
      })
      return true
    }

    yield* Deferred.fail(
      result,
      new OrchestrationCommandPreviouslyRejectedError({
        commandId: command.commandId,
        detail: existingReceipt.value.error ?? 'Previously rejected.',
      })
    )
    return true
  })

const commitCommandTransaction = ({
  command,
  commandReceiptRepository,
  eventStore,
  projectionPipeline,
  readModel,
  sql,
}: {
  command: OrchestrationCommand
  commandReceiptRepository: typeof OrchestrationCommandReceiptRepository.Service
  eventStore: typeof OrchestrationEventStore.Service
  projectionPipeline: typeof OrchestrationProjectionPipeline.Service
  readModel: OrchestrationReadModel
  sql: SqlClient.SqlClient
}) =>
  Effect.gen(function* () {
    const eventBase = yield* decideOrchestrationCommand({
      command,
      readModel,
    })
    const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase]

    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const committedEvents: OrchestrationEvent[] = []
          let nextReadModel = readModel

          for (const nextEvent of eventBases) {
            const savedEvent = yield* eventStore.append(nextEvent)
            nextReadModel = yield* projectEvent(nextReadModel, savedEvent)
            yield* projectionPipeline.projectEvent(savedEvent)
            committedEvents.push(savedEvent)
          }

          const lastSavedEvent = committedEvents.at(-1) ?? null
          if (lastSavedEvent === null) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: 'Command produced no events.',
            })
          }

          yield* commandReceiptRepository.upsert({
            commandId: command.commandId,
            aggregateKind: lastSavedEvent.aggregateKind,
            aggregateId: lastSavedEvent.aggregateId,
            acceptedAt: lastSavedEvent.occurredAt,
            resultSequence: lastSavedEvent.sequence,
            status: 'accepted',
            error: null,
          })

          return {
            committedEvents,
            lastSequence: lastSavedEvent.sequence,
            nextReadModel,
          } as const
        })
      )
      .pipe(
        Effect.catchTag('SqlError', sqlError =>
          Effect.fail(
            toPersistenceSqlError('OrchestrationEngine.processEnvelope:transaction')(sqlError)
          )
        )
      )
  })

const persistRejectedInvariantReceipt = ({
  command,
  commandReceiptRepository,
  errorMessage,
  state,
}: {
  command: OrchestrationCommand
  commandReceiptRepository: typeof OrchestrationCommandReceiptRepository.Service
  errorMessage: string
  state: EngineState
}) => {
  const aggregateRef = commandToAggregateRef(command)
  return commandReceiptRepository
    .upsert({
      commandId: command.commandId,
      aggregateKind: aggregateRef.aggregateKind,
      aggregateId: aggregateRef.aggregateId,
      acceptedAt: new Date().toISOString(),
      resultSequence: state.readModel.snapshotSequence,
      status: 'rejected',
      error: errorMessage,
    })
    .pipe(Effect.catch(() => Effect.void))
}

const publishCommittedCommand = ({
  committedCommand,
  eventPubSub,
  result,
  state,
}: {
  committedCommand: {
    committedEvents: OrchestrationEvent[]
    lastSequence: number
    nextReadModel: OrchestrationReadModel
  }
  eventPubSub: PubSub.PubSub<OrchestrationEvent>
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>
  state: EngineState
}) =>
  Effect.gen(function* () {
    state.readModel = committedCommand.nextReadModel
    for (const event of committedCommand.committedEvents) {
      yield* PubSub.publish(eventPubSub, event)
    }
    yield* Deferred.succeed(result, { sequence: committedCommand.lastSequence })
  })

const createDispatchFailureHandler =
  ({
    command,
    commandReceiptRepository,
    dispatchStartSequence,
    eventPubSub,
    eventStore,
    result,
    state,
  }: {
    command: OrchestrationCommand
    commandReceiptRepository: typeof OrchestrationCommandReceiptRepository.Service
    dispatchStartSequence: number
    eventPubSub: PubSub.PubSub<OrchestrationEvent>
    eventStore: typeof OrchestrationEventStore.Service
    result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>
    state: EngineState
  }) =>
  (error: OrchestrationDispatchError) =>
    Effect.gen(function* () {
      yield* reconcileReadModelAfterDispatchFailure({
        dispatchStartSequence,
        eventPubSub,
        eventStore,
        state,
      }).pipe(
        Effect.catch(() =>
          Effect.logWarning(
            'failed to reconcile orchestration read model after dispatch failure'
          ).pipe(
            Effect.annotateLogs({
              commandId: command.commandId,
              snapshotSequence: state.readModel.snapshotSequence,
            })
          )
        )
      )

      if (Schema.is(OrchestrationCommandInvariantError)(error)) {
        yield* persistRejectedInvariantReceipt({
          command,
          commandReceiptRepository,
          errorMessage: error.message,
          state,
        })
      }

      yield* Deferred.fail(result, error)
    })

const createProcessEnvelope =
  ({
    commandReceiptRepository,
    eventPubSub,
    eventStore,
    projectionPipeline,
    sql,
    state,
  }: {
    commandReceiptRepository: typeof OrchestrationCommandReceiptRepository.Service
    eventPubSub: PubSub.PubSub<OrchestrationEvent>
    eventStore: typeof OrchestrationEventStore.Service
    projectionPipeline: typeof OrchestrationProjectionPipeline.Service
    sql: SqlClient.SqlClient
    state: EngineState
  }) =>
  (envelope: CommandEnvelope): Effect.Effect<void> => {
    const dispatchStartSequence = state.readModel.snapshotSequence

    return Effect.gen(function* () {
      const handledExistingReceipt = yield* resolveExistingReceipt({
        command: envelope.command,
        commandReceiptRepository,
        result: envelope.result,
      })
      if (handledExistingReceipt) {
        return
      }

      const committedCommand = yield* commitCommandTransaction({
        command: envelope.command,
        commandReceiptRepository,
        eventStore,
        projectionPipeline,
        readModel: state.readModel,
        sql,
      })

      yield* publishCommittedCommand({
        committedCommand,
        eventPubSub,
        result: envelope.result,
        state,
      })
    }).pipe(
      Effect.catch(
        createDispatchFailureHandler({
          command: envelope.command,
          commandReceiptRepository,
          dispatchStartSequence,
          eventPubSub,
          eventStore,
          result: envelope.result,
          state,
        })
      )
    )
  }

const createEngineAccessors = ({
  commandQueue,
  eventPubSub,
  eventStore,
  state,
}: {
  commandQueue: Queue.Queue<CommandEnvelope>
  eventPubSub: PubSub.PubSub<OrchestrationEvent>
  eventStore: typeof OrchestrationEventStore.Service
  state: EngineState
}): OrchestrationEngineShape => ({
  getReadModel: () => Effect.sync((): OrchestrationReadModel => state.readModel),
  readEvents: fromSequenceExclusive => eventStore.readFromSequence(fromSequenceExclusive),
  dispatch: command =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, OrchestrationDispatchError>()
      yield* Queue.offer(commandQueue, { command, result })
      return yield* Deferred.await(result)
    }),
  get streamDomainEvents(): OrchestrationEngineShape['streamDomainEvents'] {
    return Stream.fromPubSub(eventPubSub)
  },
})

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const eventStore = yield* OrchestrationEventStore
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository
  const projectionPipeline = yield* OrchestrationProjectionPipeline
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery

  const state: EngineState = {
    readModel: createEmptyReadModel(new Date().toISOString()),
  }

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>()
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>()
  const processEnvelope = createProcessEnvelope({
    commandReceiptRepository,
    eventPubSub,
    eventStore,
    projectionPipeline,
    sql,
    state,
  })

  yield* projectionPipeline.bootstrap
  state.readModel = yield* projectionSnapshotQuery.getSnapshot()

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)))
  yield* Effect.forkScoped(worker)
  yield* Effect.logDebug('orchestration engine started').pipe(
    Effect.annotateLogs({ sequence: state.readModel.snapshotSequence })
  )

  return createEngineAccessors({
    commandQueue,
    eventPubSub,
    eventStore,
    state,
  })
})

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine
)
