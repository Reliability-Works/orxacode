import { DEFAULT_SERVER_SETTINGS, WS_METHODS } from '@orxa-code/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WsTransport } from './wsTransport'

type WsEventType = 'open' | 'message' | 'close' | 'error'
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

function getSocket(): MockWebSocket {
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

function emitRequestChunk(socket: MockWebSocket, requestId: string, value: unknown) {
  socket.serverMessage(
    JSON.stringify({
      _tag: 'Chunk',
      requestId,
      values: [value],
    })
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

function createWelcomeEvent(sequence: number) {
  return {
    version: 1,
    sequence,
    type: 'welcome',
    payload: {
      cwd: '/tmp/workspace',
      projectName: 'workspace',
    },
  } as const
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
  vi.restoreAllMocks()
})

describe('WsTransport subscription cancellation', () => {
  it('does not start a cancelled subscription after the socket finishes opening', async () => {
    const transport = new WsTransport('ws://localhost:3020')
    const firstListener = vi.fn()
    const secondListener = vi.fn()

    const firstUnsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      firstListener
    )

    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })

    firstUnsubscribe()

    const secondUnsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      secondListener
    )

    const socket = getSocket()
    socket.open()

    await waitFor(() => {
      const [handshakeRequest] = parseRequestMessages(socket)
      expect(handshakeRequest?.tag).toBe(WS_METHODS.serverGetSettings)
    })

    const handshakeRequest = parseRequestMessages(socket)[0]
    if (!handshakeRequest) {
      throw new Error('Expected a bootstrap handshake request')
    }
    emitSuccessfulExitWithValue(socket, handshakeRequest.id, DEFAULT_SERVER_SETTINGS)

    await waitFor(() => {
      expect(parseRequestMessages(socket)).toHaveLength(2)
    })

    const requestMessage = parseRequestMessages(socket)[1]
    if (!requestMessage) {
      throw new Error('Expected a live stream request')
    }

    const welcomeEvent = createWelcomeEvent(1)
    emitRequestChunk(socket, requestMessage.id, welcomeEvent)

    await waitFor(() => {
      expect(secondListener).toHaveBeenCalledWith(welcomeEvent)
    })
    expect(firstListener).not.toHaveBeenCalled()

    secondUnsubscribe()
    await transport.dispose()
  })
})
