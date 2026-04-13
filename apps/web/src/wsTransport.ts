import { WS_METHODS } from '@orxa-code/contracts'
import { Duration, Effect, Exit, ManagedRuntime, Option, Scope, Stream } from 'effect'

import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsRpcProtocolClient,
} from './rpc/protocol'
import { RpcClient } from 'effect/unstable/rpc'
import { isTransportConnectionErrorMessage } from './rpc/transportError'
import {
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionErrored,
  recordWsConnectionOpened,
} from './rpc/wsConnectionState'

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input
  readonly onResubscribe?: () => void
}

interface RequestOptions {
  readonly timeout?: Option.Option<Duration.Input>
}

const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250)
const CONNECTION_URL_RESOLUTION_TIMEOUT_MS = 10_000
const CONNECTION_OPEN_TIMEOUT_MS = 10_000
const CONNECTION_HANDSHAKE_TIMEOUT_MS = 10_000

type WsTransportUrlProvider = string | (() => string | Promise<string>)

function notifyResubscribe(options?: SubscribeOptions) {
  try {
    options?.onResubscribe?.()
  } catch {
    // Swallow reconnect hook errors so the stream can recover.
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return String(error)
}

function errorStatusCode(error: unknown): number | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { readonly status?: unknown }).status === 'number'
  ) {
    return (error as { readonly status: number }).status
  }
  return null
}

function isRetryableConnectionBootstrapError(error: unknown): boolean {
  const message = formatErrorMessage(error)
  const status =
    errorStatusCode(error) ??
    (() => {
      const match = message.match(/\((\d{3})\)\.?\s*$/)
      return match ? Number(match[1]) : null
    })()
  if (status !== null) {
    return status === 408 || status === 425 || status === 429 || status >= 500
  }

  if (isTransportConnectionErrorMessage(message)) {
    return true
  }

  return (
    /Failed to fetch remote auth endpoint/i.test(message) ||
    /\btimed out\b/i.test(message) ||
    /\bfetch failed\b/i.test(message) ||
    /\bNetworkError\b/i.test(message)
  )
}

function logTransport(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.info('[mobile-sync] transport', {
    event,
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

function logTransportError(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.error('[mobile-sync] transport', {
    event,
    revision: 'mobile-reopen-probe-1',
    ...data,
  })
}

async function withTimeout<T>(input: {
  readonly label: string
  readonly ms: number
  readonly promise: Promise<T>
}): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      input.promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${input.label} timed out after ${input.ms}ms.`))
        }, input.ms)
      }),
    ])
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

function createSubscriptionCompletion<TValue>(params: {
  activeRef: () => boolean
  connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>
  connection: {
    runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
    clientScope: Scope.Closeable
    clientPromise: Promise<WsRpcProtocolClient>
  }
  listener: (value: TValue) => void
  isDisposed: () => boolean
  onCancelCurrent: (cancel: () => void) => void
  onTransportResult: (result: { disconnected: boolean; shouldRetry: boolean }) => void
}) {
  return new Promise<void>(resolve => {
    params.onCancelCurrent(
      params.connection.runtime.runCallback(
        Effect.promise(() => params.connection.clientPromise).pipe(
          Effect.flatMap(client =>
            Stream.runForEach(params.connect(client), value =>
              Effect.sync(() => {
                if (!params.activeRef()) {
                  return
                }
                try {
                  params.listener(value)
                } catch {
                  // Swallow listener errors so the stream stays live.
                }
              })
            )
          ),
          Effect.catch(error => {
            const formattedError = formatErrorMessage(error)
            const disconnected = isTransportConnectionErrorMessage(formattedError)
            if (disconnected) {
              recordWsConnectionErrored(formattedError)
              recordWsConnectionClosed({ reason: formattedError })
            }
            params.onTransportResult({ disconnected, shouldRetry: disconnected })
            if (!params.activeRef() || params.isDisposed()) {
              return Effect.interrupt
            }
            return Effect.sync(() => {
              console.warn('WebSocket RPC subscription disconnected', {
                error: formattedError,
              })
            })
          }),
          Effect.ensuring(Effect.sync(resolve))
        )
      )
    )
  })
}

async function runSubscriptionLoop<TValue>(params: {
  activeRef: () => boolean
  connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>
  getConnection: () => Promise<{
    runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
    clientScope: Scope.Closeable
    clientPromise: Promise<WsRpcProtocolClient>
  }>
  isDisposed: () => boolean
  listener: (value: TValue) => void
  options: SubscribeOptions | undefined
  resetConnection: () => Promise<void>
  retryDelayMs: Duration.Input
  onCancelCurrent: (cancel: () => void) => void
}) {
  let hasCompletedFirstAttempt = false

  while (params.activeRef() && !params.isDisposed()) {
    let connection: Awaited<ReturnType<typeof params.getConnection>>
    try {
      connection = await params.getConnection()
    } catch (error) {
      if (!params.activeRef() || params.isDisposed()) {
        break
      }
      if (!isRetryableConnectionBootstrapError(error)) {
        throw error
      }
      await new Promise(resolve =>
        setTimeout(resolve, Duration.toMillis(Duration.fromInputUnsafe(params.retryDelayMs)))
      )
      continue
    }

    if (!params.activeRef() || params.isDisposed()) {
      break
    }

    if (hasCompletedFirstAttempt) {
      notifyResubscribe(params.options)
    }

    let disconnected = false
    let shouldRetry = true
    await createSubscriptionCompletion({
      activeRef: params.activeRef,
      connect: params.connect,
      connection,
      isDisposed: params.isDisposed,
      listener: params.listener,
      onCancelCurrent: params.onCancelCurrent,
      onTransportResult: result => {
        disconnected = result.disconnected
        shouldRetry = result.shouldRetry
      },
    })

    hasCompletedFirstAttempt = true
    if (!params.activeRef() || params.isDisposed()) {
      break
    }
    if (disconnected) {
      await params.resetConnection()
    }
    if (!shouldRetry) {
      break
    }
    await new Promise(resolve =>
      setTimeout(resolve, Duration.toMillis(Duration.fromInputUnsafe(params.retryDelayMs)))
    )
  }
}

export class WsTransport {
  private connectionPromise: Promise<{
    runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
    clientScope: Scope.Closeable
    clientPromise: Promise<WsRpcProtocolClient>
  }> | null = null
  private readonly urlProvider: WsTransportUrlProvider | undefined
  private disposed = false
  private resetPromise: Promise<void> | null = null

  constructor(url?: WsTransportUrlProvider) {
    this.urlProvider = url
  }

  private async resolveConnectionUrl(): Promise<string | undefined> {
    logTransport('resolve-connection-url-start', {
      hasUrlProvider: this.urlProvider !== undefined,
      urlProviderType: typeof this.urlProvider,
    })
    if (typeof this.urlProvider === 'function') {
      const resolvedUrl = await withTimeout({
        label: 'resolve connection url',
        ms: CONNECTION_URL_RESOLUTION_TIMEOUT_MS,
        promise: Promise.resolve(this.urlProvider()),
      })
      logTransport('resolve-connection-url-done', {
        hasResolvedUrl: typeof resolvedUrl === 'string' && resolvedUrl.length > 0,
      })
      return resolvedUrl
    }

    logTransport('resolve-connection-url-done', {
      hasResolvedUrl: typeof this.urlProvider === 'string' && this.urlProvider.length > 0,
    })
    return this.urlProvider
  }

  private async createConnection() {
    logTransport('create-connection-start', {
      disposed: this.disposed,
    })
    let connection:
      | {
          runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
          clientScope: Scope.Closeable
          clientPromise: Promise<WsRpcProtocolClient>
        }
      | null = null
    try {
      const resolvedUrl = await this.resolveConnectionUrl()
      recordWsConnectionAttempt(resolvedUrl ?? window.location.origin)
      const runtime = ManagedRuntime.make(createWsRpcProtocolLayer(resolvedUrl))
      const clientScope = runtime.runSync(Scope.make())
      const clientPromise = runtime.runPromise(Scope.provide(clientScope)(makeWsRpcProtocolClient))
      connection = { runtime, clientScope, clientPromise }

      await withTimeout({
        label: 'create websocket rpc client',
        ms: CONNECTION_OPEN_TIMEOUT_MS,
        promise: clientPromise,
      })

      const client = await clientPromise
      await withTimeout({
        label: 'open websocket rpc connection',
        ms: CONNECTION_HANDSHAKE_TIMEOUT_MS,
        promise: runtime.runPromise(client[WS_METHODS.serverGetSettings]({})),
      })

      recordWsConnectionOpened()
      logTransport('create-connection-done', {
        hasResolvedUrl: typeof resolvedUrl === 'string' && resolvedUrl.length > 0,
      })
      return connection
    } catch (error) {
      logTransportError('create-connection-error', {
        message: formatErrorMessage(error),
      })
      if (connection) {
        await this.disposeConnection(connection).catch(() => undefined)
      }
      throw error
    }
  }

  private async disposeConnection(
    connection: Awaited<NonNullable<WsTransport['connectionPromise']>>
  ) {
    await connection.runtime
      .runPromise(Scope.close(connection.clientScope, Exit.void))
      .finally(() => {
        connection.runtime.dispose()
      })
  }

  private async getConnection() {
    if (!this.connectionPromise) {
      const nextPromise = this.createConnection()
      const connectionPromise = nextPromise.catch(error => {
        if (this.connectionPromise === connectionPromise) {
          this.connectionPromise = null
        }
        recordWsConnectionErrored(formatErrorMessage(error))
        throw error
      })
      this.connectionPromise = connectionPromise
    }
    return this.connectionPromise
  }

  private async resetConnection() {
    if (this.disposed) {
      await this.resetPromise
      return
    }
    if (this.resetPromise) {
      return
    }

    const previousConnectionPromise = this.connectionPromise
    this.connectionPromise = null
    if (previousConnectionPromise) {
      void previousConnectionPromise
        .then(previousConnection => this.disposeConnection(previousConnection))
        .catch(() => undefined)
    }
    this.resetPromise = Promise.resolve().finally(() => {
      this.resetPromise = null
    })
  }

  async reconnect() {
    await this.resetConnection()
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    options?: RequestOptions
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error('Transport disposed')
    }

    void options
    const connection = await this.getConnection()
    const client = await connection.clientPromise
    try {
      return await connection.runtime.runPromise(Effect.suspend(() => execute(client)))
    } catch (error) {
      if (isTransportConnectionErrorMessage(formatErrorMessage(error))) {
        recordWsConnectionErrored(formatErrorMessage(error))
        recordWsConnectionClosed({ reason: formatErrorMessage(error) })
        await this.resetConnection()
      }
      throw error
    }
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void
  ): Promise<void> {
    if (this.disposed) {
      throw new Error('Transport disposed')
    }

    const connection = await this.getConnection()
    const client = await connection.clientPromise
    try {
      await connection.runtime.runPromise(
        Stream.runForEach(connect(client), value =>
          Effect.sync(() => {
            try {
              listener(value)
            } catch {
              // Swallow listener errors so the stream can finish cleanly.
            }
          })
        )
      )
    } catch (error) {
      if (isTransportConnectionErrorMessage(formatErrorMessage(error))) {
        recordWsConnectionErrored(formatErrorMessage(error))
        recordWsConnectionClosed({ reason: formatErrorMessage(error) })
        await this.resetConnection()
      }
      throw error
    }
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions
  ): () => void {
    if (this.disposed) {
      return () => undefined
    }

    let active = true
    const retryDelayMs = options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS
    let cancelCurrent: () => void = () => undefined
    void runSubscriptionLoop({
      activeRef: () => active,
      connect,
      getConnection: () => this.getConnection(),
      isDisposed: () => this.disposed,
      listener,
      options,
      resetConnection: () => this.resetConnection(),
      retryDelayMs,
      onCancelCurrent: cancel => {
        cancelCurrent = cancel
      },
    })

    return () => {
      active = false
      cancelCurrent()
    }
  }

  async dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    await this.resetPromise
    const connection = this.connectionPromise ? await this.connectionPromise : null
    if (connection) {
      await this.disposeConnection(connection)
    }
    this.connectionPromise = null
  }
}
