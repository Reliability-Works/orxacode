import { Effect, FileSystem } from 'effect'

import { OrchestrationEventStore } from '../../persistence/Services/OrchestrationEventStore.ts'
import { OrchestrationProjectionPipeline } from '../Services/ProjectionPipeline.ts'

export const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const fileInfo = yield* Effect.result(fileSystem.stat(filePath))
    return fileInfo._tag === 'Success'
  })

export type EventStoreAppendInput = Parameters<
  (typeof OrchestrationEventStore)['Service']['append']
>[0]

export const makeAppendAndProject = () =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore
    const projectionPipeline = yield* OrchestrationProjectionPipeline
    return (event: EventStoreAppendInput) =>
      eventStore
        .append(event)
        .pipe(Effect.flatMap(savedEvent => projectionPipeline.projectEvent(savedEvent)))
  })
