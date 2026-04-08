import { WsRpcGroup } from '@orxa-code/contracts'
import { Effect, Layer } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'

import { resolveServerUrl } from '../lib/utils'

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup)

type RpcClientFactory = typeof makeWsRpcProtocolClient
export type WsRpcProtocolClient = Effect.Success<RpcClientFactory>

export function createWsRpcProtocolLayer(url?: string) {
  const resolvedUrl = resolveServerUrl({
    url,
    protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
    pathname: '/ws',
  })
  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal)
  )

  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson))
  )
}
