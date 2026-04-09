import { expect, it } from 'vitest'

import { createCollabNotificationHarness } from './codexAppServerManager.test.helpers'

it('routes child notifications onto a deterministic child thread id', () => {
  const { manager, context, emitEvent } = createCollabNotificationHarness()

  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'item/completed',
    params: {
      item: {
        type: 'collabAgentToolCall',
        id: 'call_collab_1',
        receiverThreadIds: ['child_provider_1'],
      },
      threadId: 'provider_parent',
      turnId: 'turn_parent',
    },
  })
  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'child_provider_1',
      turnId: 'turn_child_1',
      itemId: 'msg_child_1',
      delta: 'working',
    },
  })

  expect(emitEvent).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: 'item/agentMessage/delta',
      threadId: 'codex-child:thread_1:child_provider_1',
      turnId: 'turn_child_1',
      itemId: 'msg_child_1',
    })
  )
})

it('emits child lifecycle notifications without mutating the parent session state', () => {
  const { manager, context, emitEvent, updateSession } = createCollabNotificationHarness()

  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'item/completed',
    params: {
      item: {
        type: 'collabAgentToolCall',
        id: 'call_collab_1',
        receiverThreadIds: ['child_provider_1'],
      },
      threadId: 'provider_parent',
      turnId: 'turn_parent',
    },
  })
  emitEvent.mockClear()
  updateSession.mockClear()
  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'turn/started',
    params: {
      threadId: 'child_provider_1',
      turn: { id: 'turn_child_1' },
    },
  })
  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'turn/completed',
    params: {
      threadId: 'child_provider_1',
      turn: { id: 'turn_child_1', status: 'completed' },
    },
  })

  expect(emitEvent).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      method: 'turn/started',
      threadId: 'codex-child:thread_1:child_provider_1',
    })
  )
  expect(emitEvent).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      method: 'turn/completed',
      threadId: 'codex-child:thread_1:child_provider_1',
    })
  )
  expect(updateSession).not.toHaveBeenCalled()
})

it('routes child approval requests onto the child thread', () => {
  const { manager, context, emitEvent } = createCollabNotificationHarness()

  ;(
    manager as unknown as {
      handleServerNotification: (context: unknown, notification: Record<string, unknown>) => void
    }
  ).handleServerNotification(context, {
    method: 'item/completed',
    params: {
      item: {
        type: 'collabAgentToolCall',
        id: 'call_collab_1',
        receiverThreadIds: ['child_provider_1'],
      },
      threadId: 'provider_parent',
      turnId: 'turn_parent',
    },
  })
  emitEvent.mockClear()
  ;(
    manager as unknown as {
      handleServerRequest: (context: unknown, request: Record<string, unknown>) => void
    }
  ).handleServerRequest(context, {
    id: 42,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'child_provider_1',
      turnId: 'turn_child_1',
      itemId: 'call_child_1',
      command: 'bun install',
    },
  })

  expect(Array.from(context.pendingApprovals.values())[0]).toEqual(
    expect.objectContaining({
      threadId: 'codex-child:thread_1:child_provider_1',
      turnId: 'turn_child_1',
      itemId: 'call_child_1',
    })
  )
  expect(emitEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'item/commandExecution/requestApproval',
      threadId: 'codex-child:thread_1:child_provider_1',
      turnId: 'turn_child_1',
      itemId: 'call_child_1',
    })
  )
})
