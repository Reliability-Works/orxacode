import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor,
  resolveRemoteWebSocketConnectionUrl,
} from './api'
import { resolveRemotePairingTarget } from './target'

function installRemoteTestWindow() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'https://app.example.com',
      },
    },
  })
}

function createRemoteFetchMock() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          role: 'client',
          sessionMethod: 'bearer-session-token',
          expiresAt: '2026-05-01T12:00:00.000Z',
          sessionToken: 'bearer-token',
        }),
        { status: 200 }
      )
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(BASE_DESCRIPTOR), {
        status: 200,
      })
    )
}

beforeEach(() => {
  installRemoteTestWindow()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('remote pairing target', () => {
  it('derives backend urls and token from a pairing url', () => {
    expect(
      resolveRemotePairingTarget({
        pairingUrl: 'https://remote.example.com/pair#token=pairing-token',
      })
    ).toEqual({
      credential: 'pairing-token',
      httpBaseUrl: 'https://remote.example.com/',
      wsBaseUrl: 'wss://remote.example.com/',
    })
  })
})

describe('remote environment api', () => {
  it('bootstraps bearer auth and resolves websocket urls via the persisted session token', async () => {
    const fetchMock = createRemoteFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      bootstrapRemoteBearerSession({
        httpBaseUrl: 'https://remote.example.com/',
        credential: 'pairing-token',
      })
    ).resolves.toMatchObject({
      sessionMethod: 'bearer-session-token',
      sessionToken: 'bearer-token',
    })

    await expect(
      fetchRemoteEnvironmentDescriptor({
        httpBaseUrl: 'https://remote.example.com/',
      })
    ).resolves.toMatchObject({
      environmentId: 'environment-remote',
      label: 'Remote environment',
    })

    await expect(
      resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: 'wss://remote.example.com/',
        bearerToken: 'bearer-token',
      })
    ).resolves.toBe('wss://remote.example.com/ws?token=bearer-token')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

const BASE_DESCRIPTOR = {
  environmentId: 'environment-remote',
  label: 'Remote environment',
  kind: 'local-desktop' as const,
}
