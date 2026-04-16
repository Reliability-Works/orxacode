import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import { createEmptyReadModel, projectEvent } from './projector.ts'

export const asEventId = (value: string): EventId => EventId.makeUnsafe(value)
export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value)

export async function createProjectScriptsReadModel(now: string) {
  const initial = createEmptyReadModel(now)
  const withProject = await Effect.runPromise(
    projectEvent(initial, {
      sequence: 1,
      eventId: asEventId('evt-project-create'),
      aggregateKind: 'project',
      aggregateId: asProjectId('project-1'),
      type: 'project.created',
      occurredAt: now,
      commandId: CommandId.makeUnsafe('cmd-project-create'),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe('cmd-project-create'),
      metadata: {},
      payload: {
        projectId: asProjectId('project-1'),
        title: 'Project',
        workspaceRoot: '/tmp/project',
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    })
  )

  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId('evt-thread-create'),
      aggregateKind: 'thread',
      aggregateId: ThreadId.makeUnsafe('thread-1'),
      type: 'thread.created',
      occurredAt: now,
      commandId: CommandId.makeUnsafe('cmd-thread-create'),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe('cmd-thread-create'),
      metadata: {},
      payload: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        projectId: asProjectId('project-1'),
        title: 'Thread',
        modelSelection: {
          provider: 'codex',
          model: 'gpt-5-codex',
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: 'approval-required',
        branch: null,
        worktreePath: null,
        gitRoot: null,
        parentBranch: null,
        createdAt: now,
        updatedAt: now,
      },
    })
  )
}
