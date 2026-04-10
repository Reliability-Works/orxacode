import * as Crypto from 'node:crypto'

import type { DesktopRemoteAccessPreferences } from '@orxa-code/contracts'

import type { DesktopRemoteAccessPreferencesStore } from './remoteAccessPreferences'

export interface RemoteAccessRuntimeHost {
  readonly store: DesktopRemoteAccessPreferencesStore
  writeLog(message: string): void
  restartBackend(): Promise<void>
  setRemoteAccessToken(token: string | undefined): void
}

export function resolveRemoteAccessToken(enabled: boolean): string | undefined {
  return enabled ? Crypto.randomBytes(24).toString('hex') : undefined
}

export async function applyRemoteAccessPreferences(
  host: RemoteAccessRuntimeHost,
  input: Partial<DesktopRemoteAccessPreferences>
): Promise<DesktopRemoteAccessPreferences> {
  const previous = host.store.get()
  const next = host.store.set(input)
  if (previous.enabled === next.enabled) {
    return next
  }

  host.setRemoteAccessToken(resolveRemoteAccessToken(next.enabled))
  host.writeLog(`remote access ${next.enabled ? 'enabled' : 'disabled'}; restarting backend`)
  await host.restartBackend()
  return next
}
