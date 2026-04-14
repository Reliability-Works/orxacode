import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLoggedWebSocketConstructor } from './protocol'

type WsEventType = 'open' | 'close' | 'error'
type WsEvent = { code?: number; reason?: string; type?: string; wasClean?: boolean }
type WsListener = (event?: WsEvent) => void

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  closeCalls = 0
  readonly url: string
  private readonly listeners = new Map<WsEventType, Set<WsListener>>()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close(code = 1000, reason = '') {
    this.closeCalls += 1
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code, reason, type: 'close', wasClean: false })
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', { type: 'open' })
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type)
    if (!listeners) {
      return
    }
    for (const listener of listeners) {
      listener(event)
    }
  }
}

describe('createLoggedWebSocketConstructor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('force-closes sockets that never reach open', async () => {
    const constructor = createLoggedWebSocketConstructor(
      MockWebSocket as unknown as typeof WebSocket
    )
    const socket = constructor('ws://localhost:3020/ws') as unknown as MockWebSocket

    await vi.advanceTimersByTimeAsync(3_100)

    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(socket.closeCalls).toBe(1)
  })

  it('does not close sockets that reach open before the timeout', async () => {
    const constructor = createLoggedWebSocketConstructor(
      MockWebSocket as unknown as typeof WebSocket
    )
    const socket = constructor('ws://localhost:3020/ws') as unknown as MockWebSocket

    socket.open()
    await vi.advanceTimersByTimeAsync(3_100)

    expect(socket.readyState).toBe(MockWebSocket.OPEN)
    expect(socket.closeCalls).toBe(0)
  })
})
