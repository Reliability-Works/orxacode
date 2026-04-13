import {
  DEFAULT_MODEL_BY_PROVIDER,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
} from '@orxa-code/contracts'
import { expect, it } from 'vitest'

import { syncServerReadModel, type AppState } from './store'
import {
  makeReadModel,
  makeReadModelProject,
  makeReadModelThread,
  makeState,
  makeThread,
} from './store.test.helpers'

it('marks bootstrap complete after snapshot sync', () => {
  const initialState: AppState = {
    ...makeState(makeThread()),
    bootstrapComplete: false,
  }

  const next = syncServerReadModel(initialState, makeReadModel(makeReadModelThread({})))

  expect(next.bootstrapComplete).toBe(true)
})

it('preserves claude model slugs without an active session', () => {
  const initialState = makeState(makeThread())
  const readModel = makeReadModel(
    makeReadModelThread({
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
      },
    })
  )

  const next = syncServerReadModel(initialState, readModel)

  expect(next.threads[0]?.modelSelection.model).toBe('claude-opus-4-6')
})

it('resolves claude aliases when session provider is claudeAgent', () => {
  const initialState = makeState(makeThread())
  const readModel = makeReadModel(
    makeReadModelThread({
      modelSelection: {
        provider: 'claudeAgent',
        model: 'sonnet',
      },
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'claudeAgent',
        providerSessionId: null,
        providerThreadId: 'claude-thread-1',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: '2026-02-27T00:00:00.000Z',
      },
    })
  )

  const next = syncServerReadModel(initialState, readModel)

  expect(next.threads[0]?.modelSelection.model).toBe('claude-sonnet-4-6')
})

it('preserves project and thread updatedAt timestamps from the read model', () => {
  const initialState = makeState(makeThread())
  const readModel = makeReadModel(
    makeReadModelThread({
      updatedAt: '2026-02-27T00:05:00.000Z',
    })
  )

  const next = syncServerReadModel(initialState, readModel)

  expect(next.projects[0]?.updatedAt).toBe('2026-02-27T00:00:00.000Z')
  expect(next.threads[0]?.updatedAt).toBe('2026-02-27T00:05:00.000Z')
})

it('maps provider session and thread identifiers from the read model session', () => {
  const initialState = makeState(makeThread())
  const next = syncServerReadModel(
    initialState,
    makeReadModel(
      makeReadModelThread({
        session: {
          threadId: ThreadId.makeUnsafe('thread-1'),
          status: 'ready',
          providerName: 'opencode',
          providerSessionId: 'sess-opencode-1',
          providerThreadId: 'thread-provider-1',
          runtimeMode: 'full-access',
          activeTurnId: null,
          lastError: null,
          updatedAt: '2026-02-27T00:00:00.000Z',
        },
      })
    )
  )

  expect(next.threads[0]?.session?.providerSessionId).toBe('sess-opencode-1')
  expect(next.threads[0]?.session?.providerThreadId).toBe('thread-provider-1')
})

it('maps archivedAt from the read model', () => {
  const initialState = makeState(makeThread())
  const archivedAt = '2026-02-28T00:00:00.000Z'
  const next = syncServerReadModel(
    initialState,
    makeReadModel(
      makeReadModelThread({
        archivedAt,
      })
    )
  )

  expect(next.threads[0]?.archivedAt).toBe(archivedAt)
})

it('replaces projects using snapshot order during recovery', () => {
  const project1 = ProjectId.makeUnsafe('project-1')
  const project2 = ProjectId.makeUnsafe('project-2')
  const project3 = ProjectId.makeUnsafe('project-3')
  const initialState: AppState = {
    projects: [
      {
        id: project2,
        name: 'Project 2',
        cwd: '/tmp/project-2',
        defaultModelSelection: {
          provider: 'codex',
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        scripts: [],
      },
      {
        id: project1,
        name: 'Project 1',
        cwd: '/tmp/project-1',
        defaultModelSelection: {
          provider: 'codex',
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        scripts: [],
      },
    ],
    threads: [],
    activeEnvironmentId: null,
    bootstrapComplete: true,
  }
  const readModel: OrchestrationReadModel = {
    snapshotSequence: 2,
    updatedAt: '2026-02-27T00:00:00.000Z',
    projects: [
      makeReadModelProject({
        id: project1,
        title: 'Project 1',
        workspaceRoot: '/tmp/project-1',
      }),
      makeReadModelProject({
        id: project2,
        title: 'Project 2',
        workspaceRoot: '/tmp/project-2',
      }),
      makeReadModelProject({
        id: project3,
        title: 'Project 3',
        workspaceRoot: '/tmp/project-3',
      }),
    ],
    threads: [],
  }

  const next = syncServerReadModel(initialState, readModel)

  expect(next.projects.map(project => project.id)).toEqual([project1, project2, project3])
})
