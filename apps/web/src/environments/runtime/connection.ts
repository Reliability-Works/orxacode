import type { NativeApi } from '@orxa-code/contracts'

import type { WsRpcClient } from '../../wsRpcClient'

export interface ActiveEnvironmentConnection {
  readonly connectionId: number
  readonly authRevision: string | null
  readonly environmentId: string
  readonly kind: 'primary' | 'saved'
  readonly label: string
  readonly httpBaseUrl: string
  readonly wsBaseUrl: string
  readonly bearerToken: string | null
  readonly client: WsRpcClient
  readonly nativeApi: NativeApi
  readonly dispose: () => Promise<void>
}
