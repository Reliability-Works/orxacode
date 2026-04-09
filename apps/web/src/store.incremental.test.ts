import {
  CheckpointRef,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { afterEach, expect, it, vi } from 'vitest'

import {
  applyOrchestrationEvent,
  applyOrchestrationEvents,
  logOpencodeStartupTelemetryForEvent,
  type AppState,
} from './store'
import { makeEvent, makeState, makeThread } from './store.test.helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

it('does not mark bootstrap complete for incremental events', () => {
  const state: AppState = {
    ...makeState(makeThread()),
    bootstrapComplete: false,
  }

  const next = applyOrchestrationEvent(
    state,
    makeEvent('thread.meta-updated', {
      threadId: ThreadId.makeUnsafe('thread-1'),
      title: 'Updated title',
      updatedAt: '2026-02-27T00:00:01.000Z',
    })
  )

  expect(next.bootstrapComplete).toBe(false)
})

it('preserves state identity for no-op project and thread deletes', () => {
  const thread = makeThread()
  const state = makeState(thread)

  const nextAfterProjectDelete = applyOrchestrationEvent(
    state,
    makeEvent('project.deleted', {
      projectId: ProjectId.makeUnsafe('project-missing'),
      deletedAt: '2026-02-27T00:00:01.000Z',
    })
  )
  const nextAfterThreadDelete = applyOrchestrationEvent(
    state,
    makeEvent('thread.deleted', {
      threadId: ThreadId.makeUnsafe('thread-missing'),
      deletedAt: '2026-02-27T00:00:01.000Z',
    })
  )

  expect(nextAfterProjectDelete).toBe(state)
  expect(nextAfterThreadDelete).toBe(state)
})

it('reuses an existing project row when project.created arrives with a new id for the same cwd', () => {
  const originalProjectId = ProjectId.makeUnsafe('project-1')
  const recreatedProjectId = ProjectId.makeUnsafe('project-2')
  const state: AppState = {
    projects: [
      {
        id: originalProjectId,
        name: 'Project',
        cwd: '/tmp/project',
        defaultModelSelection: {
          provider: 'codex',
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        scripts: [],
      },
    ],
    threads: [],
    bootstrapComplete: true,
  }

  const next = applyOrchestrationEvent(
    state,
    makeEvent('project.created', {
      projectId: recreatedProjectId,
      title: 'Project Recreated',
      workspaceRoot: '/tmp/project',
      defaultModelSelection: {
        provider: 'codex',
        model: DEFAULT_MODEL_BY_PROVIDER.codex,
      },
      scripts: [],
      createdAt: '2026-02-27T00:00:01.000Z',
      updatedAt: '2026-02-27T00:00:01.000Z',
    })
  )

  expect(next.projects).toHaveLength(1)
  expect(next.projects[0]?.id).toBe(recreatedProjectId)
  expect(next.projects[0]?.cwd).toBe('/tmp/project')
  expect(next.projects[0]?.name).toBe('Project Recreated')
})

it('updates only the affected thread for message events', () => {
  const thread1 = makeThread({
    id: ThreadId.makeUnsafe('thread-1'),
    messages: [
      {
        id: MessageId.makeUnsafe('message-1'),
        role: 'assistant',
        text: 'hello',
        turnId: TurnId.makeUnsafe('turn-1'),
        createdAt: '2026-02-27T00:00:00.000Z',
        completedAt: '2026-02-27T00:00:00.000Z',
        streaming: false,
      },
    ],
  })
  const thread2 = makeThread({ id: ThreadId.makeUnsafe('thread-2') })
  const state: AppState = {
    ...makeState(thread1),
    threads: [thread1, thread2],
  }

  const next = applyOrchestrationEvent(
    state,
    makeEvent('thread.message-sent', {
      threadId: thread1.id,
      messageId: MessageId.makeUnsafe('message-1'),
      role: 'assistant',
      text: ' world',
      turnId: TurnId.makeUnsafe('turn-1'),
      streaming: true,
      createdAt: '2026-02-27T00:00:01.000Z',
      updatedAt: '2026-02-27T00:00:01.000Z',
    })
  )

  expect(next.threads[0]?.messages[0]?.text).toBe('hello world')
  expect(next.threads[0]?.latestTurn?.state).toBe('running')
  expect(next.threads[1]).toBe(thread2)
})

it('applies replay batches in sequence and updates session state', () => {
  const thread = makeThread({
    latestTurn: {
      turnId: TurnId.makeUnsafe('turn-1'),
      state: 'running',
      requestedAt: '2026-02-27T00:00:00.000Z',
      startedAt: '2026-02-27T00:00:00.000Z',
      completedAt: null,
      assistantMessageId: null,
    },
  })
  const state = makeState(thread)

  const next = applyOrchestrationEvents(state, [
    makeEvent(
      'thread.session-set',
      {
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: 'running',
          providerName: 'codex',
          runtimeMode: 'full-access',
          activeTurnId: TurnId.makeUnsafe('turn-1'),
          lastError: null,
          updatedAt: '2026-02-27T00:00:02.000Z',
        },
      },
      { sequence: 2 }
    ),
    makeEvent(
      'thread.message-sent',
      {
        threadId: thread.id,
        messageId: MessageId.makeUnsafe('assistant-1'),
        role: 'assistant',
        text: 'done',
        turnId: TurnId.makeUnsafe('turn-1'),
        streaming: false,
        createdAt: '2026-02-27T00:00:03.000Z',
        updatedAt: '2026-02-27T00:00:03.000Z',
      },
      { sequence: 3 }
    ),
  ])

  expect(next.threads[0]?.session?.status).toBe('running')
  expect(next.threads[0]?.latestTurn?.state).toBe('completed')
  expect(next.threads[0]?.messages).toHaveLength(1)
})

it('logs Opencode startup telemetry to the devtools console when the activity arrives', () => {
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const thread = makeThread()
  const state = makeState(thread)

  const event = makeEvent('thread.activity-appended', {
    threadId: thread.id,
    activity: {
      id: EventId.makeUnsafe('activity-opencode-startup'),
      createdAt: '2026-02-27T00:00:02.000Z',
      turnId: TurnId.makeUnsafe('turn-1'),
      tone: 'info',
      kind: 'task.progress',
      summary: 'Reasoning update',
      payload: {
        taskId: 'opencode-startup-turn-1',
        summary: 'First response token received after 3689ms.',
        detail: 'First response token received after 3689ms.',
      },
    },
  })
  logOpencodeStartupTelemetryForEvent(event)
  const next = applyOrchestrationEvent(state, event)

  expect(debugSpy).toHaveBeenCalledWith('[orxacode][opencode-startup]', {
    threadId: thread.id,
    activityId: 'activity-opencode-startup',
    createdAt: '2026-02-27T00:00:02.000Z',
    message: 'First response token received after 3689ms.',
  })
  expect(next.threads[0]?.activities.some(activity => activity.id === 'activity-opencode-startup')).toBe(
    true
  )
})

it('does not regress latestTurn when an older turn diff completes late', () => {
  const state = makeState(
    makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe('turn-2'),
        state: 'running',
        requestedAt: '2026-02-27T00:00:02.000Z',
        startedAt: '2026-02-27T00:00:03.000Z',
        completedAt: null,
        assistantMessageId: null,
      },
    })
  )

  const next = applyOrchestrationEvent(
    state,
    makeEvent('thread.turn-diff-completed', {
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: TurnId.makeUnsafe('turn-1'),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.makeUnsafe('checkpoint-1'),
      status: 'ready',
      files: [],
      assistantMessageId: MessageId.makeUnsafe('assistant-1'),
      completedAt: '2026-02-27T00:00:04.000Z',
    })
  )

  expect(next.threads[0]?.turnDiffSummaries).toHaveLength(1)
  expect(next.threads[0]?.latestTurn).toEqual(state.threads[0]?.latestTurn)
})

it('rebinds live turn diffs to the authoritative assistant message when it arrives later', () => {
  const turnId = TurnId.makeUnsafe('turn-1')
  const state = makeState(
    makeThread({
      latestTurn: {
        turnId,
        state: 'completed',
        requestedAt: '2026-02-27T00:00:00.000Z',
        startedAt: '2026-02-27T00:00:00.000Z',
        completedAt: '2026-02-27T00:00:02.000Z',
        assistantMessageId: MessageId.makeUnsafe('assistant:turn-1'),
      },
      turnDiffSummaries: [
        {
          turnId,
          completedAt: '2026-02-27T00:00:02.000Z',
          status: 'ready',
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.makeUnsafe('checkpoint-1'),
          assistantMessageId: MessageId.makeUnsafe('assistant:turn-1'),
          files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
        },
      ],
    })
  )

  const next = applyOrchestrationEvent(
    state,
    makeEvent('thread.message-sent', {
      threadId: ThreadId.makeUnsafe('thread-1'),
      messageId: MessageId.makeUnsafe('assistant-real'),
      role: 'assistant',
      text: 'final answer',
      turnId,
      streaming: false,
      createdAt: '2026-02-27T00:00:03.000Z',
      updatedAt: '2026-02-27T00:00:03.000Z',
    })
  )

  expect(next.threads[0]?.turnDiffSummaries[0]?.assistantMessageId).toBe(
    MessageId.makeUnsafe('assistant-real')
  )
  expect(next.threads[0]?.latestTurn?.assistantMessageId).toBe(
    MessageId.makeUnsafe('assistant-real')
  )
})
