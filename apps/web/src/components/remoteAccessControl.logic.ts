import type { DesktopBridge, DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'

import { completeExpectedReconnectWindow } from '../rpc/wsConnectionState'

export async function updateRemoteAccessPreference(input: {
  readonly bridge:
    | Pick<DesktopBridge, 'setRemoteAccessPreferences' | 'getRemoteAccessSnapshot'>
    | undefined
  readonly enabled: boolean
  readonly reconnect: () => Promise<void>
}): Promise<DesktopRemoteAccessSnapshot> {
  const bridge = input.bridge
  if (!bridge?.setRemoteAccessPreferences || !bridge.getRemoteAccessSnapshot) {
    throw new Error('Remote access is only available from the desktop app.')
  }

  await bridge.setRemoteAccessPreferences({ enabled: input.enabled })
  const snapshot = await bridge.getRemoteAccessSnapshot()
  completeExpectedReconnectWindow()
  await input.reconnect().catch(() => undefined)
  return snapshot
}
