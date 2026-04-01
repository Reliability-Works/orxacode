/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC, type OrxaEvent } from '../../shared/ipc'
import { createMainWindowEventPublisher } from './main-window-event-publisher'

describe('createMainWindowEventPublisher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('batches high-frequency structured notifications onto the batch channel', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const publisher = createMainWindowEventPublisher(
      () =>
        ({
          isDestroyed: () => false,
          webContents: { send },
        }) as never
    )

    publisher.publish({
      type: 'codex.notification',
      payload: { method: 'turn/updated', params: { turnId: 't1' } },
    } satisfies OrxaEvent)
    publisher.publish({
      type: 'claude-chat.notification',
      payload: {
        sessionKey: 's1',
        method: 'assistant/partial',
        params: { turnId: 't1', content: 'Hi' },
      },
    } satisfies OrxaEvent)

    expect(send).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(IPC.eventsBatch, [
      expect.objectContaining({ type: 'codex.notification' }),
      expect.objectContaining({ type: 'claude-chat.notification' }),
    ])
  })

  it('flushes buffered structured notifications before immediate events', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const publisher = createMainWindowEventPublisher(
      () =>
        ({
          isDestroyed: () => false,
          webContents: { send },
        }) as never
    )

    publisher.publish({
      type: 'codex.notification',
      payload: { method: 'assistant/partial', params: { turnId: 't1', content: 'Hi' } },
    } satisfies OrxaEvent)

    publisher.publish({
      type: 'codex.approval',
      payload: {
        id: 1,
        method: 'commandExecution',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        reason: 'run command',
        command: ['echo', 'hi'],
        availableDecisions: ['approve'],
      },
    } as unknown as OrxaEvent)

    expect(send).toHaveBeenNthCalledWith(1, IPC.eventsBatch, [
      expect.objectContaining({ type: 'codex.notification' }),
    ])
    expect(send).toHaveBeenNthCalledWith(
      2,
      IPC.events,
      expect.objectContaining({ type: 'codex.approval' })
    )
  })
})
