import {
  CheckpointRef,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'
import { Effect, Layer, ManagedRuntime, Option, Stream } from 'effect'

import { PersistenceSqlError } from '../../persistence/Errors.ts'
import { OrchestrationCommandReceiptRepositoryLive } from '../../persistence/Layers/OrchestrationCommandReceipts.ts'
import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from '../../persistence/Services/OrchestrationEventStore.ts'
import { ServerConfig } from '../../config.ts'
import { OrchestrationEngineLive } from './OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from '../Services/ProjectionPipeline.ts'
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from '../Services/ProjectionSnapshotQuery.ts'
import * as NodeServices from '@effect/platform-node/NodeServices'

export const DEFAULT_MODEL_SELECTION = {
  provider: 'codex' as const,
  model: 'gpt-5-codex',
}

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)
export const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value)

export function now() {
  return new Date().toISOString()
}

export interface OrchestrationTestSystem {
  readonly engine: typeof OrchestrationEngineService.Service
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>
  readonly dispose: () => Promise<void>
}

interface CreateOrchestrationSystemOptions {
  readonly eventStore?: OrchestrationEventStoreShape
  readonly projectionPipeline?: OrchestrationProjectionPipelineShape
  readonly snapshotQuery?: ProjectionSnapshotQueryShape
}

export async function createOrchestrationSystem(
  options: CreateOrchestrationSystemOptions = {}
): Promise<OrchestrationTestSystem> {
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: 'orxa-orchestration-engine-test-',
  })
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(
      options.snapshotQuery
        ? Layer.succeed(ProjectionSnapshotQuery, options.snapshotQuery)
        : OrchestrationProjectionSnapshotQueryLive
    ),
    Layer.provide(
      options.projectionPipeline
        ? Layer.succeed(OrchestrationProjectionPipeline, options.projectionPipeline)
        : OrchestrationProjectionPipelineLive
    ),
    Layer.provide(
      options.eventStore
        ? Layer.succeed(OrchestrationEventStore, options.eventStore)
        : OrchestrationEventStoreLive
    ),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer)
  )
  const runtime = ManagedRuntime.make(orchestrationLayer)
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService))

  return {
    engine,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  }
}

export type StoredEvent = OrchestrationEvent & { sequence: number }
type AppendedEventInput = Parameters<OrchestrationEventStoreShape['append']>[0]

export function createStoredEventStore(
  shouldFailAppend?: (event: AppendedEventInput) => PersistenceSqlError | undefined
): {
  readonly events: StoredEvent[]
  readonly store: OrchestrationEventStoreShape
} {
  const events: StoredEvent[] = []
  let nextSequence = 1

  return {
    events,
    store: {
      append(event) {
        const maybeError = shouldFailAppend?.(event)
        if (maybeError) {
          return Effect.fail(maybeError)
        }

        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent
        nextSequence += 1
        events.push(savedEvent)
        return Effect.succeed(savedEvent)
      },
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter(event => event.sequence > sequenceExclusive))
      },
      readAll() {
        return Stream.fromIterable(events)
      },
    },
  }
}

export function createFailingProjectionPipeline(input: {
  readonly operation: string
  readonly detail: string
  readonly shouldFail: (event: OrchestrationEvent) => boolean
}): OrchestrationProjectionPipelineShape {
  let failed = false

  return {
    bootstrap: Effect.void,
    projectEvent: event => {
      if (!failed && input.shouldFail(event)) {
        failed = true
        return Effect.fail(
          new PersistenceSqlError({
            operation: input.operation,
            detail: input.detail,
          })
        )
      }

      return Effect.void
    },
  }
}

export function createProjectCommand(projectId: string, title: string, createdAt: string) {
  return {
    type: 'project.create' as const,
    commandId: CommandId.makeUnsafe(`cmd-project-${projectId}`),
    projectId: asProjectId(projectId),
    title,
    workspaceRoot: `/tmp/${projectId}`,
    defaultModelSelection: DEFAULT_MODEL_SELECTION,
    createdAt,
  }
}

export function createThreadCommand(input: {
  readonly commandId: string
  readonly threadId: string
  readonly projectId: string
  readonly title: string
  readonly createdAt: string
  readonly runtimeMode?: 'approval-required' | 'full-access'
}) {
  return {
    type: 'thread.create' as const,
    commandId: CommandId.makeUnsafe(input.commandId),
    threadId: ThreadId.makeUnsafe(input.threadId),
    projectId: asProjectId(input.projectId),
    title: input.title,
    modelSelection: DEFAULT_MODEL_SELECTION,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: input.runtimeMode ?? 'approval-required',
    branch: null,
    worktreePath: null,
    createdAt: input.createdAt,
  }
}

export function createTurnStartCommand(input: {
  readonly commandId: string
  readonly threadId: string
  readonly messageId: string
  readonly text: string
  readonly createdAt: string
}) {
  return {
    type: 'thread.turn.start' as const,
    commandId: CommandId.makeUnsafe(input.commandId),
    threadId: ThreadId.makeUnsafe(input.threadId),
    message: {
      messageId: asMessageId(input.messageId),
      role: 'user' as const,
      text: input.text,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: 'approval-required' as const,
    createdAt: input.createdAt,
  }
}

export function createThreadMetaUpdateCommand(commandId: string, threadId: string, title: string) {
  return {
    type: 'thread.meta.update' as const,
    commandId: CommandId.makeUnsafe(commandId),
    threadId: ThreadId.makeUnsafe(threadId),
    title,
  }
}

export async function readAllEvents(
  system: OrchestrationTestSystem
): Promise<OrchestrationEvent[]> {
  return system.run(
    Stream.runCollect(system.engine.readEvents(0)).pipe(
      Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk))
    )
  )
}

export const emptySnapshotQuery: ProjectionSnapshotQueryShape = {
  getSnapshot: () =>
    Effect.succeed({
      snapshotSequence: 0,
      updatedAt: now(),
      projects: [],
      threads: [],
    } satisfies OrchestrationReadModel),
  getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
  getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
}
