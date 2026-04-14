import { DEFAULT_SERVER_SETTINGS, WS_METHODS } from '@orxa-code/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WsTransport } from './wsTransport'

type WsEventType = 'open' | 'message' | 'close'
type WsEvent = { code?: number; data?: unknown; reason?: string; type?: string }
type WsListener = (event?: WsEvent) => void

const sockets: MockWebSocket[] = []

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  readonly sent: string[] = []
  readonly url: string
  private readonly listeners = new Map<WsEventType, Set<WsListener>>()

  constructor(url: string) {
    this.url = url
    sockets.push(this)
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code, reason, type: 'close' })
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', { type: 'open' })
  }

  serverMessage(data: unknown) {
    this.emit('message', { data, type: 'message' })
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type)
    if (!listeners) return
    for (const listener of listeners) {
      listener(event)
    }
  }
}

const originalWebSocket = globalThis.WebSocket

function getSocket() {
  const socket = sockets.at(-1)
  if (!socket) {
    throw new Error('Expected a websocket instance')
  }
  return socket
}

function parseRequestMessages(socket: MockWebSocket) {
  return socket.sent
    .map(message => JSON.parse(message) as { _tag?: string; id?: string; tag?: string })
    .filter(
      (message): message is { _tag: 'Request'; id: string; tag: string } =>
        message._tag === 'Request'
    )
}

function emitSuccessfulExitWithValue(socket: MockWebSocket, requestId: string, value: unknown) {
  socket.serverMessage(
    JSON.stringify({
      _tag: 'Exit',
      requestId,
      exit: {
        _tag: 'Success',
        value,
      },
    })
  )
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
}

async function openSocketAndCompleteHandshake(socket: MockWebSocket) {
  socket.open()
  await waitFor(() => {
    const [requestMessage] = parseRequestMessages(socket)
    expect(requestMessage?.tag).toBe(WS_METHODS.serverGetSettings)
  })
  const handshakeRequest = parseRequestMessages(socket)[0]
  if (!handshakeRequest) {
    throw new Error('Expected a bootstrap handshake request')
  }
  emitSuccessfulExitWithValue(socket, handshakeRequest.id, DEFAULT_SERVER_SETTINGS)
}

function subscribeServerLifecycle(transport: WsTransport) {
  return transport.subscribe(
    client => client[WS_METHODS.subscribeServerLifecycle]({}),
    () => undefined
  )
}

beforeEach(() => {
  sockets.length = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'http://localhost:3020',
        hostname: 'localhost',
        port: '3020',
        protocol: 'http:',
      },
      desktopBridge: undefined,
    },
  })
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
})

describe('WsTransport reconnect', () => {
  it('eagerly reopens the websocket during reconnect', async () => {
    const transport = new WsTransport('ws://localhost:3020')
    const unsubscribe = subscribeServerLifecycle(transport)

    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })
    const firstSocket = getSocket()
    await openSocketAndCompleteHandshake(firstSocket)

    const reconnectPromise = transport.reconnect()
    await waitFor(() => {
      expect(sockets).toHaveLength(2)
    })
    const secondSocket = getSocket()
    expect(secondSocket).not.toBe(firstSocket)
    await openSocketAndCompleteHandshake(secondSocket)
    await expect(reconnectPromise).resolves.toBeUndefined()

    unsubscribe()
    await transport.dispose()
  })
})
