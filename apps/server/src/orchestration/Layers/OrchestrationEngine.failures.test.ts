import { CommandId } from '@orxa-code/contracts'
import { expect, it } from 'vitest'

import {
  createFailingProjectionPipeline,
  createOrchestrationSystem,
  createProjectCommand,
  createStoredEventStore,
  createThreadCommand,
  createThreadMetaUpdateCommand,
  createTurnStartCommand,
  readAllEvents,
} from './OrchestrationEngine.test.helpers.ts'
import { PersistenceSqlError } from '../../persistence/Errors.ts'

it('keeps processing queued commands after a storage failure', async () => {
  let shouldFailFirstAppend = true
  const { store } = createStoredEventStore(event => {
    if (shouldFailFirstAppend && event.commandId === CommandId.makeUnsafe('cmd-flaky-1')) {
      shouldFailFirstAppend = false
      return new PersistenceSqlError({
        operation: 'test.append',
        detail: 'append failed',
      })
    }
    return undefined
  })

  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem({ eventStore: store })

  await system.run(
    system.engine.dispatch(createProjectCommand('project-flaky', 'Flaky Project', createdAt))
  )
  await expect(
    system.run(
      system.engine.dispatch(
        createThreadCommand({
          commandId: 'cmd-flaky-1',
          threadId: 'thread-flaky-fail',
          projectId: 'project-flaky',
          title: 'flaky-fail',
          createdAt,
        })
      )
    )
  ).rejects.toThrow('append failed')

  const result = await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-flaky-2',
        threadId: 'thread-flaky-ok',
        projectId: 'project-flaky',
        title: 'flaky-ok',
        createdAt,
      })
    )
  )
  expect(result.sequence).toBe(2)
  expect((await system.run(system.engine.getReadModel())).snapshotSequence).toBe(2)

  await system.dispose()
})

it('rolls back all events for a multi-event command when projection fails mid-dispatch', async () => {
  const createdAt = new Date().toISOString()
  const turnStartCommand = createTurnStartCommand({
    commandId: 'cmd-turn-start-atomic',
    threadId: 'thread-atomic',
    messageId: 'msg-atomic-1',
    text: 'hello',
    createdAt,
  })
  const system = await createOrchestrationSystem({
    projectionPipeline: createFailingProjectionPipeline({
      operation: 'test.projection',
      detail: 'projection failed',
      shouldFail: event =>
        event.commandId === CommandId.makeUnsafe('cmd-turn-start-atomic') &&
        event.type === 'thread.turn-start-requested',
    }),
  })

  await system.run(
    system.engine.dispatch(createProjectCommand('project-atomic', 'Atomic Project', createdAt))
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-atomic-create',
        threadId: 'thread-atomic',
        projectId: 'project-atomic',
        title: 'atomic',
        createdAt,
      })
    )
  )

  await expect(system.run(system.engine.dispatch(turnStartCommand))).rejects.toThrow(
    'projection failed'
  )
  expect((await readAllEvents(system)).map(event => event.type)).toEqual([
    'project.created',
    'thread.created',
  ])
  expect((await system.run(system.engine.getReadModel())).snapshotSequence).toBe(2)

  const retryResult = await system.run(system.engine.dispatch(turnStartCommand))
  expect(retryResult.sequence).toBe(4)

  const eventsAfterRetry = await readAllEvents(system)
  expect(eventsAfterRetry.map(event => event.type)).toEqual([
    'project.created',
    'thread.created',
    'thread.message-sent',
    'thread.turn-start-requested',
  ])
  expect(
    eventsAfterRetry.filter(event => event.commandId === turnStartCommand.commandId)
  ).toHaveLength(2)

  await system.dispose()
})

it('reconciles in-memory state when append persists but projection fails', async () => {
  const { store } = createStoredEventStore()
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem({
    eventStore: store,
    projectionPipeline: createFailingProjectionPipeline({
      operation: 'test.projection',
      detail: 'projection failed',
      shouldFail: event => event.commandId === CommandId.makeUnsafe('cmd-thread-meta-sync-fail'),
    }),
  })

  await system.run(
    system.engine.dispatch(createProjectCommand('project-sync', 'Sync Project', createdAt))
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-sync-create',
        threadId: 'thread-sync',
        projectId: 'project-sync',
        title: 'sync-before',
        createdAt,
      })
    )
  )

  await expect(
    system.run(
      system.engine.dispatch(
        createThreadMetaUpdateCommand(
          'cmd-thread-meta-sync-fail',
          'thread-sync',
          'sync-after-failed-projection'
        )
      )
    )
  ).rejects.toThrow('projection failed')

  const readModelAfterFailure = await system.run(system.engine.getReadModel())
  expect(readModelAfterFailure.snapshotSequence).toBe(3)
  expect(readModelAfterFailure.threads.find(thread => thread.id === 'thread-sync')?.title).toBe(
    'sync-after-failed-projection'
  )

  await system.dispose()
})

it('fails command dispatch when command invariants are violated', async () => {
  const system = await createOrchestrationSystem()

  await expect(
    system.run(
      system.engine.dispatch(
        createTurnStartCommand({
          commandId: 'cmd-invariant-missing-thread',
          threadId: 'thread-missing',
          messageId: 'msg-missing',
          text: 'hello',
          createdAt: new Date().toISOString(),
        })
      )
    )
  ).rejects.toThrow("Thread 'thread-missing' does not exist")

  await system.dispose()
})

it('rejects duplicate thread creation', async () => {
  const createdAt = new Date().toISOString()
  const system = await createOrchestrationSystem()

  await system.run(
    system.engine.dispatch(
      createProjectCommand('project-duplicate', 'Duplicate Project', createdAt)
    )
  )
  await system.run(
    system.engine.dispatch(
      createThreadCommand({
        commandId: 'cmd-thread-duplicate-1',
        threadId: 'thread-duplicate',
        projectId: 'project-duplicate',
        title: 'duplicate',
        createdAt,
      })
    )
  )

  await expect(
    system.run(
      system.engine.dispatch(
        createThreadCommand({
          commandId: 'cmd-thread-duplicate-2',
          threadId: 'thread-duplicate',
          projectId: 'project-duplicate',
          title: 'duplicate',
          createdAt,
        })
      )
    )
  ).rejects.toThrow('already exists')

  await system.dispose()
})
