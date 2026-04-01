/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import type { OrxaEvent } from '../../shared/ipc'
import { createIpcEventHub } from './ipc-event-hub'

class TinyEmitter {
  private listeners = new Map<
    string,
    Set<(event: unknown, payload: OrxaEvent | OrxaEvent[]) => void>
  >()

  on(event: string, listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void) {
    const entries =
      this.listeners.get(event) ??
      new Set<(event: unknown, payload: OrxaEvent | OrxaEvent[]) => void>()
    entries.add(listener)
    this.listeners.set(event, entries)
  }

  removeListener(
    event: string,
    listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void
  ) {
    const entries = this.listeners.get(event)
    if (!entries) return
    entries.delete(listener)
    if (entries.size === 0) {
      this.listeners.delete(event)
    }
  }

  emit(event: string, payload: OrxaEvent | OrxaEvent[]) {
    const entries = this.listeners.get(event)
    if (!entries) return
    for (const listener of entries) {
      listener(undefined, payload)
    }
  }
}

function createMockIpc(emitter: TinyEmitter) {
  return {
    on: (channel: string, listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void) => {
      emitter.on(channel, listener)
    },
    removeListener: (channel: string, listener: (event: unknown, payload: OrxaEvent | OrxaEvent[]) => void) => {
      emitter.removeListener(channel, listener)
    },
  }
}

describe('createIpcEventHub', () => {
  it('attaches ipc listener once and removes it when idle', () => {
    const emitter = new TinyEmitter()
    const onSpy = vi.spyOn(emitter, 'on')
    const removeSpy = vi.spyOn(emitter, 'removeListener')

    const hub = createIpcEventHub(createMockIpc(emitter), 'orxa:events')

    const stopA = hub.subscribe(() => undefined)
    const stopB = hub.subscribe(() => undefined)

    expect(onSpy).toHaveBeenCalledTimes(1)
    expect(hub.listenerCount()).toBe(2)

    stopA()
    expect(removeSpy).toHaveBeenCalledTimes(0)

    stopB()
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(hub.listenerCount()).toBe(0)
  })

  it('fans out high-volume event streams without drops', () => {
    const emitter = new TinyEmitter()
    const hub = createIpcEventHub(createMockIpc(emitter), 'orxa:events')

    const seenByFirst: number[] = []
    const seenBySecond: number[] = []

    const stopFirst = hub.subscribe(event => {
      if (event.type === 'runtime.status' && event.payload.baseUrl) {
        seenByFirst.push(Number(event.payload.baseUrl))
      }
    })
    hub.subscribe(event => {
      if (event.type === 'runtime.status' && event.payload.baseUrl) {
        seenBySecond.push(Number(event.payload.baseUrl))
      }
    })

    const totalEvents = 3_000
    for (let index = 0; index < totalEvents; index += 1) {
      emitter.emit('orxa:events', {
        type: 'runtime.status',
        payload: {
          status: 'connected',
          managedServer: false,
          baseUrl: String(index),
        },
      } satisfies OrxaEvent)
    }

    expect(seenByFirst).toHaveLength(totalEvents)
    expect(seenBySecond).toHaveLength(totalEvents)
    expect(seenByFirst[0]).toBe(0)
    expect(seenByFirst.at(-1)).toBe(totalEvents - 1)

    stopFirst()
  })

  it('fans out batched payloads in order', () => {
    const emitter = new TinyEmitter()
    const hub = createIpcEventHub(createMockIpc(emitter), ['orxa:events', 'orxa:events:batch'])

    const seen: string[] = []
    hub.subscribe(event => {
      seen.push(event.type)
    })

    const payload = [
      { type: 'codex.notification', payload: { method: 'assistant/partial', params: {} } },
      {
        type: 'claude-chat.notification',
        payload: { sessionKey: 's1', method: 'assistant/partial', params: {} },
      },
    ] as OrxaEvent[]

    emitter.emit('orxa:events:batch', payload)

    expect(seen).toEqual(['codex.notification', 'claude-chat.notification'])
  })
})
