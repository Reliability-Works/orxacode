import { DEFAULT_SERVER_SETTINGS, WS_METHODS } from '@orxa-code/contracts'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WsTransport } from './wsTransport'
import {
  createWelcomeEvent,
  emitRequestChunk,
  emitSuccessfulExit,
  emitSuccessfulExitWithValue,
  getSocket,
  MockWebSocket,
  parseRequestMessages,
  sockets,
} from './wsTransport.test.helpers'

const originalWebSocket = globalThis.WebSocket

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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function createHangingThenResolvedUrlProvider() {
  return vi
    .fn<() => Promise<string>>()
    .mockImplementationOnce(() => new Promise<string>(() => undefined))
    .mockResolvedValue('ws://localhost:3020')
}

function subscribeServerLifecycle(transport: WsTransport, listener?: () => void) {
  return transport.subscribe(
    client => client[WS_METHODS.subscribeServerLifecycle]({}),
    listener ?? (() => undefined)
  )
}

async function waitForSingleSocket() {
  await waitFor(() => {
    expect(sockets).toHaveLength(1)
  })
}

async function openSocketAndWaitForLifecycleRequest(socket: MockWebSocket) {
  socket.open()
  await waitFor(() => {
    const [requestMessage] = parseRequestMessages(socket)
    expect(requestMessage?.tag).toBe(WS_METHODS.serverGetSettings)
  })
  const handshakeRequest = parseRequestMessages(socket)[0]
  if (!handshakeRequest) throw new Error('Expected a bootstrap handshake request')
  emitSuccessfulExitWithValue(socket, handshakeRequest.id, DEFAULT_SERVER_SETTINGS)
  await waitFor(() => {
    const lifecycleRequest = parseRequestMessages(socket)[1]
    expect(lifecycleRequest?.tag).toBe(WS_METHODS.subscribeServerLifecycle)
  })
}

async function openSocketAndCompleteHandshake(socket: MockWebSocket) {
  socket.open()
  await waitFor(() => {
    const [requestMessage] = parseRequestMessages(socket)
    expect(requestMessage?.tag).toBe(WS_METHODS.serverGetSettings)
  })
  const handshakeRequest = parseRequestMessages(socket)[0]
  if (!handshakeRequest) throw new Error('Expected a bootstrap handshake request')
  emitSuccessfulExitWithValue(socket, handshakeRequest.id, DEFAULT_SERVER_SETTINGS)
}

describe('WsTransport connection setup', () => {
  it('normalizes root websocket urls to /ws and preserves query params', async () => {
    const transport = new WsTransport('ws://localhost:3020/?token=secret-token')
    const unsubscribe = subscribeServerLifecycle(transport)
    await waitForSingleSocket()
    expect(getSocket().url).toBe('ws://localhost:3020/ws?token=secret-token')
    await openSocketAndCompleteHandshake(getSocket())
    unsubscribe()
    await transport.dispose()
  })

  it('uses wss when falling back to an https page origin', async () => {
    Object.assign(window.location, {
      origin: 'https://app.example.com',
      hostname: 'app.example.com',
      port: '',
      protocol: 'https:',
    })

    const transport = new WsTransport()
    const unsubscribe = subscribeServerLifecycle(transport)
    await waitForSingleSocket()
    expect(getSocket().url).toBe('wss://app.example.com/ws')
    await openSocketAndCompleteHandshake(getSocket())
    unsubscribe()
    await transport.dispose()
  })

  it('times out a hung connection url bootstrap and retries with a fresh connection attempt', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const urlProvider = createHangingThenResolvedUrlProvider()
    const transport = new WsTransport(urlProvider)
    const unsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { retryDelay: 1 }
    )
    await vi.advanceTimersByTimeAsync(10_100)
    expect(urlProvider).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)

    const socket = getSocket()
    await openSocketAndCompleteHandshake(socket)
    await vi.advanceTimersByTimeAsync(0)

    unsubscribe()
    await transport.dispose()
  })

  it('allows reconnect to replace a hung bootstrap without waiting for the original promise', async () => {
    const urlProvider = createHangingThenResolvedUrlProvider()
    const transport = new WsTransport(urlProvider)
    void transport.request(client =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: 'terminal.toggle',
        key: 'ctrl+k',
      })
    )

    await waitFor(() => {
      expect(urlProvider).toHaveBeenCalledTimes(1)
    })
    const reconnectPromise = transport.reconnect()

    await waitFor(() => {
      expect(urlProvider).toHaveBeenCalledTimes(2)
      expect(sockets).toHaveLength(1)
    })
    const socket = getSocket()
    await openSocketAndCompleteHandshake(socket)
    await expect(reconnectPromise).resolves.toBeUndefined()

    const listener = vi.fn()
    const unsubscribe = subscribeServerLifecycle(transport, listener)
    await waitFor(() => {
      const lifecycleRequest = parseRequestMessages(socket)[1]
      expect(lifecycleRequest?.tag).toBe(WS_METHODS.subscribeServerLifecycle)
    })
    unsubscribe()
    await transport.dispose()
  })
})

describe('WsTransport unary requests', () => {
  it('sends unary RPC requests and resolves successful exits', async () => {
    const transport = new WsTransport('ws://localhost:3020')

    const requestPromise = transport.request(client =>
      client[WS_METHODS.serverUpsertKeybinding]({
        command: 'terminal.toggle',
        key: 'ctrl+k',
      })
    )

    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })

    const socket = getSocket()
    await openSocketAndCompleteHandshake(socket)
    await waitFor(() => {
      expect(socket.sent).toHaveLength(2)
    })

    const requestMessage = JSON.parse(socket.sent[1] ?? '{}') as {
      _tag: string
      id: string
      payload: unknown
      tag: string
    }
    expect(requestMessage).toMatchObject({
      _tag: 'Request',
      tag: WS_METHODS.serverUpsertKeybinding,
      payload: {
        command: 'terminal.toggle',
        key: 'ctrl+k',
      },
    })

    socket.serverMessage(
      JSON.stringify({
        _tag: 'Exit',
        requestId: requestMessage.id,
        exit: {
          _tag: 'Success',
          value: {
            keybindings: [],
            issues: [],
          },
        },
      })
    )

    await expect(requestPromise).resolves.toEqual({
      keybindings: [],
      issues: [],
    })
    await transport.dispose()
  })
})

describe('WsTransport streaming subscriptions bootstrap retry', () => {
  it('retries subscription bootstrap when the connection URL provider fails once', async () => {
    const listener = vi.fn()
    const urlProvider = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('Failed to fetch remote auth endpoint'))
      .mockResolvedValue('ws://localhost:3020')
    const transport = new WsTransport(urlProvider)
    const unsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener,
      { retryDelay: 1 }
    )
    await waitFor(() => {
      expect(urlProvider).toHaveBeenCalledTimes(2)
      expect(sockets).toHaveLength(1)
    }, 3_000)
    const socket = getSocket()
    await openSocketAndWaitForLifecycleRequest(socket)
    const requestMessage = parseRequestMessages(socket)[1]
    if (!requestMessage) {
      throw new Error('Expected a subscription request message.')
    }
    const welcomeEvent = createWelcomeEvent(1, '/tmp/workspace', 'orxa-code')
    emitRequestChunk(socket, requestMessage.id, welcomeEvent)
    await waitFor(() => {
      expect(listener).toHaveBeenCalledWith(welcomeEvent)
    })
    unsubscribe()
    await transport.dispose()
  })
})

describe('WsTransport streaming subscriptions', () => {
  it('delivers stream chunks to subscribers', async () => {
    const transport = new WsTransport('ws://localhost:3020')
    const listener = vi.fn()
    const unsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener
    )
    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })

    const socket = getSocket()
    await openSocketAndWaitForLifecycleRequest(socket)

    const requestMessage = parseRequestMessages(socket)[1]
    if (!requestMessage) {
      throw new Error('Expected a stream request')
    }
    expect(requestMessage.tag).toBe(WS_METHODS.subscribeServerLifecycle)
    const welcomeEvent = createWelcomeEvent(1, '/tmp/workspace', 'workspace')
    emitRequestChunk(socket, requestMessage.id, welcomeEvent)
    await waitFor(() => {
      expect(listener).toHaveBeenCalledWith(welcomeEvent)
    })
    unsubscribe()
    await transport.dispose()
  })
})

describe('WsTransport streaming subscriptions resubscribe', () => {
  it('re-subscribes stream listeners after the stream exits', async () => {
    const transport = new WsTransport('ws://localhost:3020')
    const listener = vi.fn()
    const unsubscribe = transport.subscribe(
      client => client[WS_METHODS.subscribeServerLifecycle]({}),
      listener
    )
    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })

    const socket = getSocket()
    await openSocketAndWaitForLifecycleRequest(socket)

    const firstRequest = parseRequestMessages(socket)[1]
    if (!firstRequest) {
      throw new Error('Expected an initial stream request')
    }
    emitRequestChunk(socket, firstRequest.id, createWelcomeEvent(1, '/tmp/one', 'one'))
    emitSuccessfulExit(socket, firstRequest.id)

    await waitFor(() => {
      const nextRequest = parseRequestMessages(socket).find(
        message =>
          message.id !== firstRequest.id && message.tag === WS_METHODS.subscribeServerLifecycle
      )
      expect(nextRequest).toBeDefined()
    })

    const secondRequest = parseRequestMessages(socket).find(
      message =>
        message.id !== firstRequest.id && message.tag === WS_METHODS.subscribeServerLifecycle
    )
    if (!secondRequest) {
      throw new Error('Expected a resubscribe request')
    }
    expect(secondRequest.tag).toBe(WS_METHODS.subscribeServerLifecycle)
    expect(secondRequest.id).not.toBe(firstRequest.id)
    const secondEvent = createWelcomeEvent(2, '/tmp/two', 'two')
    emitRequestChunk(socket, secondRequest.id, secondEvent)
    await waitFor(() => {
      expect(listener).toHaveBeenLastCalledWith(secondEvent)
    })
    unsubscribe()
    await transport.dispose()
  })
})

describe('WsTransport finite streams', () => {
  it('streams finite request events without re-subscribing', async () => {
    const transport = new WsTransport('ws://localhost:3020')
    const listener = vi.fn()
    const requestPromise = transport.requestStream(
      client =>
        client[WS_METHODS.gitRunStackedAction]({
          actionId: 'action-1',
          cwd: '/repo',
          action: 'commit',
        }),
      listener
    )

    await waitFor(() => {
      expect(sockets).toHaveLength(1)
    })
    const socket = getSocket()
    await openSocketAndCompleteHandshake(socket)

    await waitFor(() => {
      expect(socket.sent).toHaveLength(2)
    })

    const requestMessage = parseRequestMessages(socket)[1]
    if (!requestMessage) {
      throw new Error('Expected a finite stream request')
    }
    const progressEvent = {
      actionId: 'action-1',
      cwd: '/repo',
      action: 'commit',
      kind: 'phase_started',
      phase: 'commit',
      label: 'Committing...',
    } as const
    emitRequestChunk(socket, requestMessage.id, progressEvent)
    emitSuccessfulExit(socket, requestMessage.id)
    await expect(requestPromise).resolves.toBeUndefined()
    expect(listener).toHaveBeenCalledWith(progressEvent)
    expect(
      socket.sent.filter(message => {
        const parsed = JSON.parse(message) as { _tag?: string; tag?: string }
        return parsed._tag === 'Request' && parsed.tag === WS_METHODS.gitRunStackedAction
      })
    ).toHaveLength(1)
    await transport.dispose()
  })
})

describe('WsTransport disposal', () => {
  it('closes the client scope on the transport runtime before disposing the runtime', async () => {
    const callOrder: string[] = []
    let resolveClose!: () => void
    const closePromise = new Promise<void>(resolve => {
      resolveClose = resolve
    })

    const runtime = {
      runPromise: vi.fn(async () => {
        callOrder.push('close:start')
        await closePromise
        callOrder.push('close:done')
        return undefined
      }),
      dispose: vi.fn(async () => {
        callOrder.push('runtime:dispose')
      }),
    }
    const transport = new WsTransport('ws://localhost:3020')
    ;(
      transport as unknown as {
        connectionPromise: Promise<{
          clientPromise: Promise<unknown>
          clientScope: Scope.Closeable
          runtime: typeof runtime
        }>
        disposed: boolean
        resetPromise: Promise<void> | null
      }
    ).connectionPromise = Promise.resolve({
      clientPromise: Promise.resolve({}),
      clientScope: {} as Scope.Closeable,
      runtime,
    })
    ;(
      transport as unknown as {
        disposed: boolean
        resetPromise: Promise<void> | null
      }
    ).resetPromise = null
    void transport.dispose()
    await waitFor(() => {
      expect(runtime.runPromise).toHaveBeenCalledTimes(1)
    })
    expect(runtime.dispose).not.toHaveBeenCalled()
    expect((transport as unknown as { disposed: boolean }).disposed).toBe(true)
    resolveClose()
    await waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledTimes(1)
    })
    expect(callOrder).toEqual(['close:start', 'close:done', 'runtime:dispose'])
  })
})
