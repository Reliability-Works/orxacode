import { Effect, Fiber, Queue } from 'effect'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'

import { type AuthenticatedSession, ServerAuth } from './auth/service'

type RpcHeaders = ReadonlyArray<readonly [string, string | ReadonlyArray<string> | undefined]>
type RpcMessage = {
  _tag?: string
  headers?: RpcHeaders
}
type TrackedClient = {
  readonly write: (response: unknown) => Effect.Effect<void>
  readonly close: (closeEvent?: Socket.CloseEvent) => Effect.Effect<void>
}
type WriteRequest = (clientId: number, data: unknown) => Effect.Effect<void>
type TrackedClientRegistry = {
  readonly disconnects: Queue.Queue<number>
  readonly clientIds: Set<number>
  readonly clients: Map<number, TrackedClient>
}
type TrackedProtocolState = {
  nextClientId: number
  writeRequest: WriteRequest
}
type RpcParser = ReturnType<typeof RpcSerialization.json.makeUnsafe>

const createClose =
  (connectionFiber: Fiber.Fiber<unknown, unknown>) =>
  (closeEvent = new Socket.CloseEvent(1000)) => {
    void closeEvent
    return Fiber.interrupt(connectionFiber).pipe(Effect.forkDetach, Effect.asVoid)
  }

const createClientWrite =
  ({
    close,
    parser,
    writeRaw,
  }: {
    readonly close: (closeEvent?: Socket.CloseEvent) => Effect.Effect<void>
    readonly parser: RpcParser
    readonly writeRaw: (
      chunk: Uint8Array | string | Socket.CloseEvent
    ) => Effect.Effect<void, Socket.SocketError>
  }) =>
  (response: unknown) => {
    try {
      const encoded = parser.encode(response)
      if (encoded === undefined) {
        return Effect.void
      }
      return writeRaw(encoded).pipe(Effect.orDie)
    } catch {
      return close(new Socket.CloseEvent(1011, 'RPC encoding failed'))
    }
  }

const dispatchDecodedMessages = ({
  clientId,
  decoded,
  headers,
  writeRequest,
}: {
  readonly clientId: number
  readonly decoded: Array<RpcMessage>
  readonly headers: RpcHeaders
  readonly writeRequest: WriteRequest
}) => {
  let index = 0
  return Effect.whileLoop({
    while: () => index < decoded.length,
    body: () => {
      const message = decoded[index++]!
      if (message._tag === 'Request') {
        message.headers = headers.concat(message.headers ?? [])
      }
      return writeRequest(clientId, message)
    },
    step: () => undefined,
  })
}

const createSocketMessageHandler =
  ({
    clientId,
    close,
    headers,
    parser,
    protocolState,
  }: {
    readonly clientId: number
    readonly close: (closeEvent?: Socket.CloseEvent) => Effect.Effect<void>
    readonly headers: RpcHeaders
    readonly parser: RpcParser
    readonly protocolState: TrackedProtocolState
  }) =>
  (data: string | Uint8Array) => {
    try {
      const decoded = parser.decode(data) as Array<RpcMessage>
      if (decoded.length === 0) {
        return Effect.void
      }
      return dispatchDecodedMessages({
        clientId,
        decoded,
        headers,
        writeRequest: protocolState.writeRequest,
      })
    } catch {
      return close(new Socket.CloseEvent(1011, 'RPC decoding failed'))
    }
  }

const createOnSocket =
  ({
    protocolState,
    registry,
    serverAuth,
  }: {
    readonly protocolState: TrackedProtocolState
    readonly registry: TrackedClientRegistry
    readonly serverAuth: typeof ServerAuth.Service
  }) =>
  (
    socket: Socket.Socket,
    headers: RpcHeaders,
    session: AuthenticatedSession,
    connectionFiber: Fiber.Fiber<unknown, unknown>
  ) =>
    Effect.gen(function* () {
      const parser = RpcSerialization.json.makeUnsafe()
      const clientId = protocolState.nextClientId++
      const writeRaw = yield* socket.writer
      const close = createClose(connectionFiber)
      const connectionId = yield* serverAuth.registerLiveSocket({
        sessionId: session.sessionId,
        role: session.role,
        close,
      })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          registry.clients.delete(clientId)
          registry.clientIds.delete(clientId)
          yield* serverAuth.unregisterLiveSocket(connectionId)
          yield* Queue.offer(registry.disconnects, clientId)
        })
      )

      const write = createClientWrite({ close, parser, writeRaw })
      registry.clients.set(clientId, { write, close })
      registry.clientIds.add(clientId)

      yield* socket
        .runRaw(
          createSocketMessageHandler({
            clientId,
            close,
            headers,
            parser,
            protocolState,
          })
        )
        .pipe(
          Effect.catchTag('SocketError', () => Effect.void),
          Effect.orDie
        )
    })

const createProtocol = ({
  protocolState,
  registry,
}: {
  readonly protocolState: TrackedProtocolState
  readonly registry: TrackedClientRegistry
}) =>
  RpcServer.Protocol.make(writeRequest => {
    protocolState.writeRequest = writeRequest as WriteRequest
    return Effect.succeed({
      disconnects: registry.disconnects,
      send: (clientId, response) => registry.clients.get(clientId)?.write(response) ?? Effect.void,
      end: clientId =>
        registry.clients
          .get(clientId)
          ?.close(new Socket.CloseEvent(1000, 'RPC connection ended')) ?? Effect.void,
      clientIds: Effect.sync(() => registry.clientIds),
      initialMessage: Effect.succeedNone,
      supportsAck: true,
      supportsTransferables: false,
      supportsSpanPropagation: true,
    })
  })

export const createTrackedWebSocketProtocol = (serverAuth: typeof ServerAuth.Service) =>
  Effect.gen(function* () {
    const registry: TrackedClientRegistry = {
      disconnects: yield* Queue.make<number>(),
      clientIds: new Set<number>(),
      clients: new Map<number, TrackedClient>(),
    }
    const protocolState: TrackedProtocolState = {
      nextClientId: 0,
      writeRequest: () => Effect.void,
    }

    return {
      protocol: yield* createProtocol({ protocolState, registry }),
      onSocket: createOnSocket({ protocolState, registry, serverAuth }),
    } as const
  })
