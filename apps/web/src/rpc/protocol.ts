import { WsRpcGroup } from '@orxa-code/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'

import { resolveServerUrl } from '../lib/utils'

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup)

type RpcClientFactory = typeof makeWsRpcProtocolClient
export type WsRpcProtocolClient = Effect.Success<RpcClientFactory>

const MOBILE_SYNC_TRACE_REVISION = 'mobile-reopen-probe-1'
const NATIVE_SOCKET_OPEN_TIMEOUT_MS = 3_000
type LoggedWebSocketConstructor = (url: string, protocols?: string | string[]) => WebSocket

function logSocketEvent(event: string, data: Record<string, unknown>) {
  console.info('[mobile-sync] socket', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event,
    ...data,
  })
}

function logSocketError(event: string, data: Record<string, unknown>) {
  console.error('[mobile-sync] socket', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event,
    ...data,
  })
}

function redactWsUrl(url: string) {
  const loggedUrl = new URL(url)
  if (loggedUrl.searchParams.has('token')) {
    loggedUrl.searchParams.set('token', '[redacted]')
  }
  return loggedUrl.toString()
}

export function createLoggedWebSocketConstructor(
  webSocketConstructor: typeof WebSocket = globalThis.WebSocket
): LoggedWebSocketConstructor {
  return (url: string, protocols?: string | string[]) => {
    const ws = new webSocketConstructor(url, protocols)
    const loggedUrl = redactWsUrl(url)
    const connectingReadyState = webSocketConstructor.CONNECTING ?? 0
    let openTimeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      openTimeoutId = null
      if (ws.readyState !== connectingReadyState) {
        return
      }
      logSocketError('native-open-timeout', {
        timeoutMs: NATIVE_SOCKET_OPEN_TIMEOUT_MS,
        url: loggedUrl,
      })
      try {
        ws.close()
      } catch {
        // Ignore close errors while force-failing a stalled socket.
      }
    }, NATIVE_SOCKET_OPEN_TIMEOUT_MS)
    const clearOpenTimeout = () => {
      if (openTimeoutId !== null) {
        clearTimeout(openTimeoutId)
        openTimeoutId = null
      }
    }
    logSocketEvent('native-construct', { url: loggedUrl })
    ws.addEventListener('open', () => {
      clearOpenTimeout()
      logSocketEvent('native-open', { url: loggedUrl })
    })
    ws.addEventListener('error', () => {
      clearOpenTimeout()
      logSocketError('native-error', { url: loggedUrl, readyState: ws.readyState })
    })
    ws.addEventListener('close', event => {
      clearOpenTimeout()
      logSocketEvent('native-close', {
        code: event.code,
        reason: event.reason,
        url: loggedUrl,
        wasClean: event.wasClean,
      })
    })
    return ws
  }
}

function createLoggedWebSocketConstructorLayer() {
  return Layer.succeed(Socket.WebSocketConstructor)(createLoggedWebSocketConstructor())
}

export function buildWsRpcUrl(url?: string) {
  return resolveServerUrl({
    url,
    protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
    pathname: '/ws',
  })
}

export function createWsRpcProtocolLayer(url?: string) {
  const resolvedUrl = buildWsRpcUrl(url)
  const rawLoggedUrl = new URL(resolvedUrl)
  const hasToken = rawLoggedUrl.searchParams.has('token')
  if (hasToken) {
    rawLoggedUrl.searchParams.set('token', '[redacted]')
  }
  console.info('[mobile-sync] creating ws protocol layer', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    hasToken,
    wsUrl: rawLoggedUrl.toString(),
  })
  const resolvedSocketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(createLoggedWebSocketConstructorLayer())
  )

  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(resolvedSocketLayer, RpcSerialization.layerJson))
  )
}
