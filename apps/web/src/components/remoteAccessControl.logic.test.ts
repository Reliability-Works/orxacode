import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopRemoteAccessSnapshot,
  DesktopRemoteAccessPreferences,
} from '@orxa-code/contracts'

import { updateRemoteAccessPreference } from './remoteAccessControl.logic'

function buildSnapshot(
  input: Pick<DesktopRemoteAccessSnapshot, 'enabled' | 'status' | 'bootstrapUrl'>
): DesktopRemoteAccessSnapshot {
  return {
    enabled: input.enabled,
    status: input.status,
    environment: {
      environmentId: 'env-1',
      label: 'Orxa Code (Desktop)',
      kind: 'local-desktop',
    },
    bootstrapUrl: input.bootstrapUrl ?? null,
    port: 4000,
    endpoints: [],
  }
}

function buildPreferences(enabled: boolean): DesktopRemoteAccessPreferences {
  return {
    enabled,
    environmentId: 'env-1',
  }
}

describe('updateRemoteAccessPreference', () => {
  it('throws when the desktop bridge is unavailable', async () => {
    await expect(
      updateRemoteAccessPreference({
        bridge: undefined,
        enabled: true,
        reconnect: vi.fn(async () => undefined),
      })
    ).rejects.toThrow('Remote access is only available from the desktop app.')
  })

  it('refreshes the snapshot and triggers an immediate reconnect after updating preferences', async () => {
    const snapshot = buildSnapshot({
      enabled: true,
      status: 'available',
      bootstrapUrl: 'http://127.0.0.1:4000/pair',
    })
    const bridge = {
      setRemoteAccessPreferences: vi.fn(async () => buildPreferences(true)),
      getRemoteAccessSnapshot: vi.fn(async () => snapshot),
    }
    const reconnect = vi.fn(async () => undefined)

    await expect(
      updateRemoteAccessPreference({
        bridge,
        enabled: true,
        reconnect,
      })
    ).resolves.toEqual(snapshot)

    expect(bridge.setRemoteAccessPreferences).toHaveBeenCalledWith({ enabled: true })
    expect(bridge.getRemoteAccessSnapshot).toHaveBeenCalledTimes(1)
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the snapshot update successful even if reconnect fails', async () => {
    const snapshot = buildSnapshot({
      enabled: false,
      status: 'disabled',
      bootstrapUrl: null,
    })

    await expect(
      updateRemoteAccessPreference({
        bridge: {
          setRemoteAccessPreferences: vi.fn(async () => buildPreferences(false)),
          getRemoteAccessSnapshot: vi.fn(async () => snapshot),
        },
        enabled: false,
        reconnect: vi.fn(async () => {
          throw new Error('reconnect failed')
        }),
      })
    ).resolves.toEqual(snapshot)
  })
})
