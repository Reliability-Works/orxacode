import * as Crypto from 'node:crypto'

import type { DesktopRemoteAccessPreferencesStore } from './remoteAccessPreferences'

export interface RemoteAccessRuntimeState {
  readonly environmentId: string
  readonly bootstrapToken: string | undefined
}

export function resolveRemoteAccessRuntimeState(input: {
  readonly store: DesktopRemoteAccessPreferencesStore
  readonly previousBootstrapToken?: string | undefined
}): RemoteAccessRuntimeState {
  const remoteAccessState = input.store.get()
  const environmentId = remoteAccessState.environmentId ?? 'local-desktop'
  const persistedBootstrapToken = input.store.getBootstrapToken()
  const bootstrapToken = remoteAccessState.enabled
    ? (persistedBootstrapToken ??
      input.previousBootstrapToken ??
      Crypto.randomBytes(24).toString('hex'))
    : undefined

  input.store.setBootstrapToken(bootstrapToken)

  return {
    environmentId,
    bootstrapToken,
  }
}
