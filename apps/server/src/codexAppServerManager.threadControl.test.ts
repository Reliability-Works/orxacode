import { expect, it } from 'vitest'

import { asThreadId, createThreadControlHarness } from './codexAppServerManager.test.helpers'

it('reads thread turns from thread/read', async () => {
  const { manager, context, requireSession, sendRequest } = createThreadControlHarness()
  sendRequest.mockResolvedValue({
    thread: {
      id: 'thread_1',
      turns: [
        {
          id: 'turn_1',
          items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }],
        },
      ],
    },
  })

  const result = await manager.readThread(asThreadId('thread_1'))

  expect(requireSession).toHaveBeenCalledWith('thread_1')
  expect(sendRequest).toHaveBeenCalledWith(context, 'thread/read', {
    threadId: 'thread_1',
    includeTurns: true,
  })
  expect(result).toEqual({
    threadId: 'thread_1',
    turns: [
      {
        id: 'turn_1',
        items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }],
      },
    ],
  })
})

it('reads thread turns from flat thread/read responses', async () => {
  const { manager, context, sendRequest } = createThreadControlHarness()
  sendRequest.mockResolvedValue({
    threadId: 'thread_1',
    turns: [
      {
        id: 'turn_1',
        items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }],
      },
    ],
  })

  const result = await manager.readThread(asThreadId('thread_1'))

  expect(sendRequest).toHaveBeenCalledWith(context, 'thread/read', {
    threadId: 'thread_1',
    includeTurns: true,
  })
  expect(result).toEqual({
    threadId: 'thread_1',
    turns: [
      {
        id: 'turn_1',
        items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hello' }] }],
      },
    ],
  })
})

it('rolls back turns via thread/rollback and resets session running state', async () => {
  const { manager, context, sendRequest, updateSession } = createThreadControlHarness()
  sendRequest.mockResolvedValue({
    thread: {
      id: 'thread_1',
      turns: [],
    },
  })

  const result = await manager.rollbackThread(asThreadId('thread_1'), 2)

  expect(sendRequest).toHaveBeenCalledWith(context, 'thread/rollback', {
    threadId: 'thread_1',
    numTurns: 2,
  })
  expect(updateSession).toHaveBeenCalledWith(context, {
    status: 'ready',
    activeTurnId: undefined,
  })
  expect(result).toEqual({
    threadId: 'thread_1',
    turns: [],
  })
})
