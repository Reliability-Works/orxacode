import { Effect, Exit, PubSub, Scope, Stream } from 'effect'
import { WS_METHODS, WsRpcGroup } from '@orxa-code/contracts'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
const STREAM_METHODS = new Set([
  WS_METHODS.gitRunStackedAction,
  WS_METHODS.subscribeOrchestrationDomainEvents,
  WS_METHODS.subscribeTerminalEvents,
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.subscribeServerLifecycle,
])
const ALL_RPC_METHODS = Array.from(WsRpcGroup.requests.keys())
function normalizeRequest(tag, payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      _tag: tag,
      ...payload,
    }
  }
  return { _tag: tag, payload }
}
function asEffect(result) {
  if (result instanceof Promise) {
    return Effect.promise(() => result)
  }
  return Effect.succeed(result)
}
export class BrowserWsRpcHarness {
  requests = []
  parser = RpcSerialization.json.makeUnsafe()
  client = null
  scope = null
  serverReady = null
  resolveUnary = () => ({})
  getInitialStreamValues = () => []
  streamPubSubs = new Map()
  async reset(options) {
    await this.disconnect()
    this.requests.length = 0
    this.resolveUnary = options?.resolveUnary ?? (() => ({}))
    this.getInitialStreamValues = options?.getInitialStreamValues ?? (() => [])
    this.initializeStreamPubSubs()
  }
  connect(client) {
    if (this.scope) {
      void Effect.runPromise(Scope.close(this.scope, Exit.void)).catch(() => undefined)
    }
    if (this.streamPubSubs.size === 0) {
      this.initializeStreamPubSubs()
    }
    this.client = client
    this.scope = Effect.runSync(Scope.make())
    this.serverReady = Effect.runPromise(
      Scope.provide(this.scope)(
        RpcServer.makeNoSerialization(WsRpcGroup, this.makeServerOptions())
      ).pipe(Effect.provide(this.makeLayer()))
    )
  }
  async disconnect() {
    if (this.scope) {
      await Effect.runPromise(Scope.close(this.scope, Exit.void)).catch(() => undefined)
      this.scope = null
    }
    for (const pubsub of this.streamPubSubs.values()) {
      Effect.runSync(PubSub.shutdown(pubsub))
    }
    this.streamPubSubs.clear()
    this.serverReady = null
    this.client = null
  }
  initializeStreamPubSubs() {
    this.streamPubSubs = new Map(
      Array.from(STREAM_METHODS, method => [method, Effect.runSync(PubSub.unbounded())])
    )
  }
  async onMessage(rawData) {
    const server = await this.serverReady
    if (!server) {
      throw new Error('RPC test server is not connected')
    }
    const messages = this.parser.decode(rawData)
    for (const message of messages) {
      await Effect.runPromise(server.write(0, message))
    }
  }
  emitStreamValue(method, value) {
    const pubsub = this.streamPubSubs.get(method)
    if (!pubsub) {
      throw new Error(`No stream registered for ${method}`)
    }
    Effect.runSync(PubSub.publish(pubsub, value))
  }
  makeLayer() {
    const handlers = {}
    for (const method of ALL_RPC_METHODS) {
      handlers[method] = STREAM_METHODS.has(method)
        ? payload => this.handleStream(method, payload)
        : payload => this.handleUnary(method, payload)
    }
    return WsRpcGroup.toLayer(handlers)
  }
  makeServerOptions() {
    return {
      onFromServer: response =>
        Effect.sync(() => {
          if (!this.client) {
            return
          }
          const encoded = this.parser.encode(response)
          if (typeof encoded === 'string') {
            this.client.send(encoded)
          }
        }),
    }
  }
  handleUnary(method, payload) {
    const request = normalizeRequest(method, payload)
    this.requests.push(request)
    return asEffect(this.resolveUnary(request))
  }
  handleStream(method, payload) {
    const request = normalizeRequest(method, payload)
    this.requests.push(request)
    const pubsub = this.streamPubSubs.get(method)
    if (!pubsub) {
      throw new Error(`No stream registered for ${method}`)
    }
    return Stream.fromIterable(this.getInitialStreamValues(request) ?? []).pipe(
      Stream.concat(Stream.fromPubSub(pubsub))
    )
  }
}
