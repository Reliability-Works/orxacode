import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'
import { Effect, Option, Queue, Stream } from 'effect'
import { expect, it } from 'vitest'

import { type OrchestrationEventStoreShape } from '../../persistence/Services/OrchestrationEventStore.ts'
import { PersistenceSqlError } from '../../persistence/Errors.ts'
import { type OrchestrationProjectionPipelineShape } from '../Services/ProjectionPipeline.ts'
import {
  asCheckpointRef,
  asProjectId,
  asTurnId,
  createOrchestrationSystem,
  createProjectCommand,
  createThreadCommand,
  createTurnStartCommand,
} from './OrchestrationEngine.test.helpers.ts'

it('bootstraps the in-memory read model from persisted projections', async () => {
  const failOnHistoricalReplayStore: OrchestrationEventStoreShape = {
    append: () =>
      Effect.fail(
        new PersistenceSqlError({
          operation: 'test.append',
          detail: 'append should not be called during bootstrap',
        })
      ),
    readFromSequence: () => Stream.empty,
    readAll: () =>
      Stream.fail(
        new PersistenceSqlError({
          operation: 'test.readAll',
          detail: 'historical replay should not be used during bootstrap',
        })
      ),
  }

  const projectionSnapshot = {
    snapshotSequence: 7,
    updatedAt: '2026-03-03T00:00:04.000Z',
    projects: [
      {
        id: asProjectId('project-bootstrap'),
        title: 'Bootstrap Project',
        workspaceRoot: '/tmp/project-bootstrap',
        defaultModelSelection: {
          provider: 'codex' as const,
          model: 'gpt-5-codex',
        },
        scripts: [],
        createdAt: '2026-03-03T00:00:00.000Z',
        updatedAt: '2026-03-03T00:00:01.000Z',
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.makeUnsafe('thread-bootstrap'),
        projectId: asProjectId('project-bootstrap'),
        title: 'Bootstrap Thread',
        modelSelection: {
          provider: 'codex' as const,
          model: 'gpt-5-codex',
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: 'full-access' as const,
        branch: null,
        worktreePath: null,
        gitRoot: null,
        handoff: null,
        parentLink: null,
        latestTurn: null,
        createdAt: '2026-03-03T00:00:02.000Z',
        updatedAt: '2026-03-03T00:00:03.000Z',
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
  }

  const system = await createBootstrapSystem(failOnHistoricalReplayStore, projectionSnapshot)

  const readModel = await system.run(system.engine.getReadModel())
  expect(readModel.snapshotSequence).toBe(7)
  expect(readModel.projects[0]?.title).toBe('Bootstrap Project')
  expect(readModel.threads[0]?.title).toBe('Bootstrap Thread')

  await system.dispose()
})

async function createBootstrapSystem(
  eventStore: OrchestrationEventStoreShape,
  projectionSnapshot: OrchestrationReadModel
) {
  return createOrchestrationSystem({
    eventStore,
    projectionPipeline: {
      bootstrap: Effect.void,
      projectEvent: () => Effect.void,
    } satisfies OrchestrationProjectionPipelineShape,
    snapshotQuery: {
      getSnapshot: () => Effect.succeed(projectionSnapshot),
      getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 1 }),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    },
  })
}

async function createSubagentArchiveScenario(
  system: Awaited<ReturnType<typeof createOrchestrationSystem>>,
  createdAt: string
) {
  await system.run(
    system.engine.dispatch(
      createProjectCommand('project-subagent-archive', 'Project Subagent Archive', createdAt)
    )
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-parent-create',
        threadId: 'thread-parent',
        projectId: 'project-subagent-archive',
        title: 'Parent',
        createdAt,
        runtimeMode: 'full-access',
      })
    )
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-child-create',
        threadId: 'thread-child',
        projectId: 'project-subagent-archive',
        title: 'Child',
        createdAt,
        runtimeMode: 'full-access',
        parentLink: {
          parentThreadId: ThreadId.makeUnsafe('thread-parent'),
          relationKind: 'subagent',
          parentTurnId: null,
          provider: 'codex',
          providerTaskId: null,
          providerChildThreadId: 'provider-child-1',
          agentLabel: 'code-reviewer',
          createdAt,
          completedAt: null,
        },
      })
    )
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-grandchild-create',
        threadId: 'thread-grandchild',
        projectId: 'project-subagent-archive',
        title: 'Grandchild',
        createdAt,
        runtimeMode: 'full-access',
        parentLink: {
          parentThreadId: ThreadId.makeUnsafe('thread-child'),
          relationKind: 'subagent',
          parentTurnId: null,
          provider: 'codex',
          providerTaskId: null,
          providerChildThreadId: 'provider-child-2',
          agentLabel: 'researcher',
          createdAt,
          completedAt: null,
        },
      })
    )
  )
}

async function assertArchivedThreadIds(
  system: Awaited<ReturnType<typeof createOrchestrationSystem>>,
  threadIds: string[]
) {
  const readModel = await system.run(system.engine.getReadModel())
  for (const threadId of threadIds) {
    expect(readModel.threads.find(thread => thread.id === threadId)?.archivedAt).not.toBeNull()
  }
}

it('returns deterministic read models for repeated reads', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await system.run(
    system.engine.dispatch(createProjectCommand('project-1', 'Project 1', createdAt))
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-1-create',
        threadId: 'thread-1',
        projectId: 'project-1',
        title: 'Thread',
        createdAt,
      })
    )
  )
  await system.run(
    system.engine.dispatch(
      createTurnStartCommand({
        commandId: 'cmd-turn-start-1',
        threadId: 'thread-1',
        messageId: 'msg-1',
        text: 'hello',
        createdAt,
      })
    )
  )

  const readModelA = await system.run(system.engine.getReadModel())
  const readModelB = await system.run(system.engine.getReadModel())
  expect(readModelB).toEqual(readModelA)

  await system.dispose()
})

it('archives and unarchives threads through orchestration commands', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await system.run(
    system.engine.dispatch(createProjectCommand('project-archive', 'Project Archive', createdAt))
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-archive-create',
        threadId: 'thread-archive',
        projectId: 'project-archive',
        title: 'Archive me',
        createdAt,
        runtimeMode: 'full-access',
      })
    )
  )
  await system.run(
    system.engine.dispatch({
      type: 'thread.archive',
      commandId: CommandId.makeUnsafe('cmd-thread-archive'),
      threadId: ThreadId.makeUnsafe('thread-archive'),
    })
  )
  expect(
    (await system.run(system.engine.getReadModel())).threads.find(
      thread => thread.id === 'thread-archive'
    )?.archivedAt
  ).not.toBeNull()

  await system.run(
    system.engine.dispatch({
      type: 'thread.unarchive',
      commandId: CommandId.makeUnsafe('cmd-thread-unarchive'),
      threadId: ThreadId.makeUnsafe('thread-archive'),
    })
  )
  expect(
    (await system.run(system.engine.getReadModel())).threads.find(
      thread => thread.id === 'thread-archive'
    )?.archivedAt
  ).toBeNull()

  await system.dispose()
})

it('archives descendant subagent threads when the parent thread is archived', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await createSubagentArchiveScenario(system, createdAt)

  await system.run(
    system.engine.dispatch({
      type: 'thread.archive',
      commandId: CommandId.makeUnsafe('cmd-thread-parent-archive'),
      threadId: ThreadId.makeUnsafe('thread-parent'),
    })
  )

  await assertArchivedThreadIds(system, ['thread-parent', 'thread-child', 'thread-grandchild'])

  await system.dispose()
})

it('replays append-only events from sequence', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await system.run(
    system.engine.dispatch(createProjectCommand('project-replay', 'Replay Project', createdAt))
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-replay-create',
        threadId: 'thread-replay',
        projectId: 'project-replay',
        title: 'replay',
        createdAt,
      })
    )
  )
  await system.run(
    system.engine.dispatch({
      type: 'thread.delete',
      commandId: CommandId.makeUnsafe('cmd-thread-replay-delete'),
      threadId: ThreadId.makeUnsafe('thread-replay'),
    })
  )

  const events = await system.run(
    Stream.runCollect(system.engine.readEvents(0)).pipe(
      Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk))
    )
  )
  expect(events.map(event => event.type)).toEqual([
    'project.created',
    'thread.created',
    'thread.deleted',
  ])

  await system.dispose()
})

it('streams persisted domain events in order', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()
  const eventTypes: string[] = []

  await system.run(
    system.engine.dispatch(createProjectCommand('project-stream', 'Stream Project', createdAt))
  )
  await system.run(
    Effect.gen(function* () {
      const eventQueue = yield* Queue.unbounded<OrchestrationEvent>()
      yield* Effect.forkScoped(
        Stream.take(system.engine.streamDomainEvents, 2).pipe(
          Stream.runForEach(event => Queue.offer(eventQueue, event).pipe(Effect.asVoid))
        )
      )
      yield* Effect.sleep('10 millis')
      yield* system.engine.dispatch(
        createThreadCommand({
          commandId: 'cmd-stream-thread-create',
          threadId: 'thread-stream',
          projectId: 'project-stream',
          title: 'domain-stream',
          createdAt,
        })
      )
      yield* system.engine.dispatch({
        type: 'thread.meta.update',
        commandId: CommandId.makeUnsafe('cmd-stream-thread-update'),
        threadId: ThreadId.makeUnsafe('thread-stream'),
        title: 'domain-stream-updated',
      })
      eventTypes.push((yield* Queue.take(eventQueue)).type)
      eventTypes.push((yield* Queue.take(eventQueue)).type)
    }).pipe(Effect.scoped)
  )

  expect(eventTypes).toEqual(['thread.created', 'thread.meta-updated'])
  await system.dispose()
})

it('stores completed checkpoint summaries even when no files changed', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await system.run(
    system.engine.dispatch(
      createProjectCommand('project-turn-diff', 'Turn Diff Project', createdAt)
    )
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-turn-diff-create',
        threadId: 'thread-turn-diff',
        projectId: 'project-turn-diff',
        title: 'Turn diff thread',
        createdAt,
      })
    )
  )
  await system.run(
    system.engine.dispatch({
      type: 'thread.turn.diff.complete',
      commandId: CommandId.makeUnsafe('cmd-turn-diff-complete'),
      threadId: ThreadId.makeUnsafe('thread-turn-diff'),
      turnId: asTurnId('turn-1'),
      completedAt: createdAt,
      checkpointRef: asCheckpointRef('refs/orxacode/checkpoints/thread-turn-diff/turn/1'),
      status: 'ready',
      files: [],
      checkpointTurnCount: 1,
      createdAt,
    })
  )

  const thread = (await system.run(system.engine.getReadModel())).threads.find(
    entry => entry.id === 'thread-turn-diff'
  )
  expect(thread?.checkpoints).toEqual([
    {
      turnId: asTurnId('turn-1'),
      checkpointTurnCount: 1,
      checkpointRef: asCheckpointRef('refs/orxacode/checkpoints/thread-turn-diff/turn/1'),
      status: 'ready',
      files: [],
      assistantMessageId: null,
      completedAt: createdAt,
    },
  ])

  await system.dispose()
})
