import { CommandId, ProjectId, ThreadId } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { opencodeChildTurnId } from '../../opencodeChildThreads.ts'

import {
  asApprovalRequestId,
  asTurnId,
  createHarness,
  waitFor,
} from './ProviderCommandReactor.test.helpers.ts'

const setRunningSession = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  commandId: string,
  now: string
) => {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe(commandId),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'running',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-1'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
}

const findThread = async (harness: Awaited<ReturnType<typeof createHarness>>) =>
  (await Effect.runPromise(harness.engine.getReadModel())).threads.find(
    entry => entry.id === ThreadId.makeUnsafe('thread-1')
  )

const findThreadById = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  threadId: string
) =>
  (await Effect.runPromise(harness.engine.getReadModel())).threads.find(
    entry => entry.id === ThreadId.makeUnsafe(threadId)
  )

const createSubagentChildThread = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) => {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe('cmd-subagent-thread-create'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      projectId: ProjectId.makeUnsafe('project-1'),
      title: 'Code Reviewer',
      modelSelection: {
        provider: 'codex',
        model: 'gpt-5-codex',
      },
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      branch: null,
      worktreePath: null,
      gitRoot: null,
      parentLink: {
        parentThreadId: ThreadId.makeUnsafe('thread-1'),
        relationKind: 'subagent',
        parentTurnId: asTurnId('turn-1'),
        provider: 'codex',
        providerTaskId: null,
        providerChildThreadId: 'child-provider-1',
        agentLabel: 'code-reviewer',
        createdAt: now,
        completedAt: null,
      },
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-subagent-thread-session-set'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      session: {
        threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
        status: 'running',
        providerName: 'codex',
        providerSessionId: null,
        providerThreadId: 'child-provider-1',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-child-1'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
}

const createOpencodeSubagentChildThread = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) => {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe('cmd-opencode-subagent-thread-create'),
      threadId: ThreadId.makeUnsafe('opencode-child:thread-1:sess-child-1'),
      projectId: ProjectId.makeUnsafe('project-1'),
      title: 'Review task',
      modelSelection: {
        provider: 'opencode',
        model: 'anthropic/claude-sonnet-4-5',
        agentId: 'review',
      },
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      branch: null,
      worktreePath: null,
      gitRoot: null,
      parentLink: {
        parentThreadId: ThreadId.makeUnsafe('thread-1'),
        relationKind: 'subagent',
        parentTurnId: null,
        provider: 'opencode',
        providerTaskId: null,
        providerChildThreadId: 'sess-child-1',
        agentLabel: 'review',
        createdAt: now,
        completedAt: null,
      },
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-opencode-subagent-thread-session-set'),
      threadId: ThreadId.makeUnsafe('opencode-child:thread-1:sess-child-1'),
      session: {
        threadId: ThreadId.makeUnsafe('opencode-child:thread-1:sess-child-1'),
        status: 'running',
        providerName: 'opencode',
        providerSessionId: 'sess-child-1',
        providerThreadId: 'sess-child-1',
        runtimeMode: 'approval-required',
        activeTurnId: opencodeChildTurnId('sess-child-1'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
}

const createClaudeSubagentChildThread = async (
  harness: Awaited<ReturnType<typeof createHarness>>,
  now: string
) => {
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.create',
      commandId: CommandId.makeUnsafe('cmd-claude-subagent-thread-create'),
      threadId: ThreadId.makeUnsafe('claude-child:thread-1:tool-task-1'),
      projectId: ProjectId.makeUnsafe('project-1'),
      title: 'Explore',
      modelSelection: {
        provider: 'claudeAgent',
        model: 'claude-haiku-4-5',
      },
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      branch: null,
      worktreePath: null,
      gitRoot: null,
      parentLink: {
        parentThreadId: ThreadId.makeUnsafe('thread-1'),
        relationKind: 'subagent',
        parentTurnId: asTurnId('turn-root'),
        provider: 'claudeAgent',
        providerTaskId: null,
        providerChildThreadId: 'tool-task-1',
        agentLabel: 'Explore',
        createdAt: now,
        completedAt: null,
      },
      createdAt: now,
    })
  )
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-claude-subagent-thread-session-set'),
      threadId: ThreadId.makeUnsafe('claude-child:thread-1:tool-task-1'),
      session: {
        threadId: ThreadId.makeUnsafe('claude-child:thread-1:tool-task-1'),
        status: 'running',
        providerName: 'claudeAgent',
        providerSessionId: 'sdk-session-root',
        providerThreadId: 'tool-task-1',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
}

it('marks subagent child sessions interrupted when the parent turn is interrupted', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set', now)
  await createSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.interrupt',
      commandId: CommandId.makeUnsafe('cmd-turn-interrupt'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: asTurnId('turn-1'),
      createdAt: now,
    })
  )

  await waitFor(async () => {
    const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
    return childThread?.session?.status === 'interrupted'
  })
  const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
  expect(childThread?.session?.status).toBe('interrupted')
  expect(childThread?.session?.activeTurnId).toBeNull()
  expect(harness.interruptTurn.mock.calls).toEqual([
    [
      {
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    ],
    [
      {
        threadId: 'thread-1',
        turnId: 'turn-child-1',
        providerThreadId: 'child-provider-1',
      },
    ],
  ])
})

it('routes subagent child turn interrupts through the parent provider session', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set', now)
  await createSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.interrupt',
      commandId: CommandId.makeUnsafe('cmd-turn-interrupt-child'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      turnId: asTurnId('turn-child-1'),
      createdAt: now,
    })
  )

  await waitFor(() => harness.interruptTurn.mock.calls.length === 1)
  expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
    threadId: 'thread-1',
    turnId: 'turn-child-1',
    providerThreadId: 'child-provider-1',
  })

  await waitFor(async () => {
    const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
    const parentThread = await findThread(harness)
    return (
      childThread?.session?.status === 'interrupted' && parentThread?.session?.status === 'running'
    )
  })
  const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
  expect(childThread?.session?.status).toBe('interrupted')
  const parentThread = await findThread(harness)
  expect(parentThread?.session?.status).toBe('running')
})

it('routes subagent child approval responses through the parent provider session', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set-for-child-approval', now)
  await createSubagentChildThread(harness, now)
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.approval.respond',
      commandId: CommandId.makeUnsafe('cmd-approval-respond-child'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      requestId: asApprovalRequestId('approval-request-child-1'),
      decision: 'accept',
      createdAt: now,
    })
  )

  await waitFor(() => harness.respondToRequest.mock.calls.length === 1)
  expect(harness.respondToRequest.mock.calls[0]?.[0]).toEqual({
    threadId: 'thread-1',
    requestId: 'approval-request-child-1',
    decision: 'accept',
  })
})

it('routes subagent child user-input responses through the parent provider session', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set-for-child-user-input', now)
  await createSubagentChildThread(harness, now)
  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.user-input.respond',
      commandId: CommandId.makeUnsafe('cmd-user-input-respond-child'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      requestId: asApprovalRequestId('user-input-request-child-1'),
      answers: {
        sandbox_mode: 'workspace-write',
      },
      createdAt: now,
    })
  )

  await waitFor(() => harness.respondToUserInput.mock.calls.length === 1)
  expect(harness.respondToUserInput.mock.calls[0]?.[0]).toEqual({
    threadId: 'thread-1',
    requestId: 'user-input-request-child-1',
    answers: {
      sandbox_mode: 'workspace-write',
    },
  })
})

it('routes subagent child session stops through the parent provider session', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await setRunningSession(harness, 'cmd-session-set-for-child-stop', now)
  await createSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.stop',
      commandId: CommandId.makeUnsafe('cmd-session-stop-child'),
      threadId: ThreadId.makeUnsafe('codex-child:thread-1:child-provider-1'),
      createdAt: now,
    })
  )

  await waitFor(() => harness.stopSession.mock.calls.length === 1)
  expect(harness.stopSession.mock.calls[0]?.[0]).toEqual({
    threadId: 'thread-1',
  })

  await waitFor(async () => {
    const parentThread = await findThread(harness)
    const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
    return parentThread?.session?.status === 'stopped' && childThread?.session?.status === 'stopped'
  })
  const parentThread = await findThread(harness)
  const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
  expect(parentThread?.session?.status).toBe('stopped')
  expect(childThread?.session?.status).toBe('stopped')
})

it('marks subagent child sessions stopped when the parent session stops', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-session-set-for-stop'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'ready',
        providerName: 'codex',
        runtimeMode: 'approval-required',
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  await createSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.stop',
      commandId: CommandId.makeUnsafe('cmd-session-stop'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      createdAt: now,
    })
  )

  await waitFor(async () => {
    const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
    return childThread?.session?.status === 'stopped'
  })
  const childThread = await findThreadById(harness, 'codex-child:thread-1:child-provider-1')
  expect(childThread?.session?.status).toBe('stopped')
  expect(childThread?.session?.activeTurnId).toBeNull()
})

it('fans out parent interrupts to running Opencode child sessions', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-opencode-session-set'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'running',
        providerName: 'opencode',
        providerSessionId: 'sess-root',
        providerThreadId: 'sess-root',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-root'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  await createOpencodeSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.interrupt',
      commandId: CommandId.makeUnsafe('cmd-opencode-parent-turn-interrupt'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: asTurnId('turn-root'),
      createdAt: now,
    })
  )

  await waitFor(() => harness.interruptTurn.mock.calls.length === 2)
  expect(harness.interruptTurn.mock.calls).toEqual([
    [
      {
        threadId: 'thread-1',
        providerThreadId: 'sess-root',
        turnId: 'turn-root',
      },
    ],
    [
      {
        threadId: 'thread-1',
        providerThreadId: 'sess-child-1',
        turnId: opencodeChildTurnId('sess-child-1'),
      },
    ],
  ])
})

it('treats Claude child-thread interrupts as parent-session interrupts', async () => {
  const harness = await createHarness()
  const now = new Date().toISOString()

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.session.set',
      commandId: CommandId.makeUnsafe('cmd-claude-session-set'),
      threadId: ThreadId.makeUnsafe('thread-1'),
      session: {
        threadId: ThreadId.makeUnsafe('thread-1'),
        status: 'running',
        providerName: 'claudeAgent',
        providerSessionId: 'sdk-session-root',
        providerThreadId: 'sdk-session-root',
        runtimeMode: 'approval-required',
        activeTurnId: asTurnId('turn-root'),
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    })
  )
  await createClaudeSubagentChildThread(harness, now)

  await Effect.runPromise(
    harness.engine.dispatch({
      type: 'thread.turn.interrupt',
      commandId: CommandId.makeUnsafe('cmd-claude-child-turn-interrupt'),
      threadId: ThreadId.makeUnsafe('claude-child:thread-1:tool-task-1'),
      createdAt: now,
    })
  )

  await waitFor(() => harness.interruptTurn.mock.calls.length === 1)
  expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
    threadId: 'thread-1',
    providerThreadId: 'tool-task-1',
  })

  await waitFor(async () => {
    const parentThread = await findThread(harness)
    const childThread = await findThreadById(harness, 'claude-child:thread-1:tool-task-1')
    return (
      parentThread?.session?.status === 'interrupted' &&
      childThread?.session?.status === 'interrupted'
    )
  })
  const parentThread = await findThread(harness)
  const childThread = await findThreadById(harness, 'claude-child:thread-1:tool-task-1')
  expect(parentThread?.session?.status).toBe('interrupted')
  expect(childThread?.session?.status).toBe('interrupted')
})
