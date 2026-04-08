import { WsRpcGroup } from '@orxa-code/contracts'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { AtomRpc } from 'effect/unstable/reactivity'

import { createWsRpcProtocolLayer } from './protocol'

export class WsRpcAtomClient extends AtomRpc.Service<WsRpcAtomClient>()('WsRpcAtomClient', {
  group: WsRpcGroup,
  protocol: Layer.suspend(() => createWsRpcProtocolLayer()),
}) {}

let sharedRuntime: ManagedRuntime.ManagedRuntime<WsRpcAtomClient, never> | null = null

function getRuntime() {
  if (sharedRuntime !== null) {
    return sharedRuntime
  }

  sharedRuntime = ManagedRuntime.make(WsRpcAtomClient.layer)
  return sharedRuntime
}

export function runRpc<TSuccess, TError = never>(
  execute: (client: typeof WsRpcAtomClient.Service) => Effect.Effect<TSuccess, TError, never>
): Promise<TSuccess> {
  return getRuntime().runPromise(Effect.flatMap(WsRpcAtomClient.asEffect(), execute))
}

export async function resetWsRpcAtomClientForTests() {
  const runtime = sharedRuntime
  sharedRuntime = null
  await runtime?.dispose()
}
