import {
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'

import type { AppState } from './store'
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from './types'
import { createMakeThread } from './test-helpers/makeThreadFixture'

export const makeThread = createMakeThread({
  model: 'gpt-5-codex',
  createdAt: '2026-02-13T00:00:00.000Z',
})

export function makeState(thread: Thread): AppState {
  return {
    projects: [
      {
        id: ProjectId.makeUnsafe('project-1'),
        name: 'Project',
        cwd: '/tmp/project',
        defaultModelSelection: {
          provider: 'codex',
          model: 'gpt-5-codex',
        },
        scripts: [],
      },
    ],
    threads: [thread],
    bootstrapComplete: true,
  }
}

export function makeEvent<T extends OrchestrationEvent['type']>(
  type: T,
  payload: Extract<OrchestrationEvent, { type: T }>['payload'],
  overrides: Partial<Extract<OrchestrationEvent, { type: T }>> = {}
): Extract<OrchestrationEvent, { type: T }> {
  const sequence = overrides.sequence ?? 1
  return {
    sequence,
    eventId: EventId.makeUnsafe(`event-${sequence}`),
    aggregateKind: 'thread',
    aggregateId:
      'threadId' in payload
        ? payload.threadId
        : 'projectId' in payload
          ? payload.projectId
          : ProjectId.makeUnsafe('project-1'),
    occurredAt: '2026-02-27T00:00:00.000Z',
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
    ...overrides,
  } as Extract<OrchestrationEvent, { type: T }>
}

export function makeReadModelThread(overrides: Partial<OrchestrationReadModel['threads'][number]>) {
  return {
    id: ThreadId.makeUnsafe('thread-1'),
    projectId: ProjectId.makeUnsafe('project-1'),
    title: 'Thread',
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5.3-codex',
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    ...overrides,
    handoff: overrides.handoff ?? null,
    parentLink: overrides.parentLink ?? null,
    latestTurn: overrides.latestTurn ?? null,
    createdAt: overrides.createdAt ?? '2026-02-27T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-02-27T00:00:00.000Z',
    archivedAt: overrides.archivedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    messages: overrides.messages ?? [],
    activities: overrides.activities ?? [],
    proposedPlans: overrides.proposedPlans ?? [],
    checkpoints: overrides.checkpoints ?? [],
    session: overrides.session ?? null,
  } satisfies OrchestrationReadModel['threads'][number]
}

export function makeReadModel(
  thread: OrchestrationReadModel['threads'][number]
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: '2026-02-27T00:00:00.000Z',
    projects: [
      {
        id: ProjectId.makeUnsafe('project-1'),
        title: 'Project',
        workspaceRoot: '/tmp/project',
        defaultModelSelection: {
          provider: 'codex',
          model: 'gpt-5.3-codex',
        },
        createdAt: '2026-02-27T00:00:00.000Z',
        updatedAt: '2026-02-27T00:00:00.000Z',
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  }
}

export function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel['projects'][number]>
): OrchestrationReadModel['projects'][number] {
  return {
    id: ProjectId.makeUnsafe('project-1'),
    title: 'Project',
    workspaceRoot: '/tmp/project',
    defaultModelSelection: {
      provider: 'codex',
      model: DEFAULT_MODEL_BY_PROVIDER.codex,
    },
    createdAt: '2026-02-27T00:00:00.000Z',
    updatedAt: '2026-02-27T00:00:00.000Z',
    deletedAt: null,
    scripts: [],
    ...overrides,
  }
}
