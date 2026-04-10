import { WsRpcGroup } from '@orxa-code/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'

import { resolveServerUrl } from '../lib/utils'

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup)

type RpcClientFactory = typeof makeWsRpcProtocolClient
export type WsRpcProtocolClient = Effect.Success<RpcClientFactory>

export const REMOTE_ACCESS_TOKEN_STORAGE_KEY = 'orxa:remote-access-token'

export function resolveRemoteAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const searchToken = new URLSearchParams(window.location.search).get('token')
  if (searchToken && searchToken.length > 0) {
    try {
      window.sessionStorage.setItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY, searchToken)
    } catch {
      // Ignore storage failures in restricted browser contexts.
    }
    return searchToken
  }

  try {
    const storedToken = window.sessionStorage.getItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY)
    return storedToken && storedToken.length > 0 ? storedToken : null
  } catch {
    return null
  }
}

export function createWsRpcProtocolLayer(url?: string) {
  const resolvedUrl = resolveServerUrl({
    url,
    protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
    pathname: '/ws',
  })
  const token = resolveRemoteAccessToken()
  const wsUrl = new URL(resolvedUrl)
  if (token && !wsUrl.searchParams.has('token')) {
    wsUrl.searchParams.set('token', token)
  }
  const resolvedSocketLayer = Socket.layerWebSocket(wsUrl.toString()).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )

  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(resolvedSocketLayer, RpcSerialization.layerJson))
  )
}
