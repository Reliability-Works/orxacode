type WsEventType = 'open' | 'message' | 'close' | 'error'
type WsEvent = { code?: number; data?: unknown; reason?: string; type?: string }
type WsListener = (event?: WsEvent) => void

export const sockets: MockWebSocket[] = []

export class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
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

export function getSocket(): MockWebSocket {
  const socket = sockets.at(-1)
  if (!socket) {
    throw new Error('Expected a websocket instance')
  }
  return socket
}

export function parseRequestMessages(socket: MockWebSocket) {
  return socket.sent
    .map(message => JSON.parse(message) as { _tag?: string; id?: string; tag?: string })
    .filter(
      (message): message is { _tag: 'Request'; id: string; tag: string } =>
        message._tag === 'Request'
    )
}

export function emitRequestChunk(socket: MockWebSocket, requestId: string, value: unknown) {
  socket.serverMessage(
    JSON.stringify({
      _tag: 'Chunk',
      requestId,
      values: [value],
    })
  )
}

export function emitSuccessfulExit(socket: MockWebSocket, requestId: string) {
  emitSuccessfulExitWithValue(socket, requestId, null)
}

export function emitSuccessfulExitWithValue(
  socket: MockWebSocket,
  requestId: string,
  value: unknown
) {
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

export function createWelcomeEvent(sequence: number, cwd: string, projectName: string) {
  return {
    version: 1,
    sequence,
    type: 'welcome',
    payload: {
      cwd,
      projectName,
    },
  } as const
}
