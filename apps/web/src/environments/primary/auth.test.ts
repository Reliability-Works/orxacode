import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchSessionState,
  refreshPrimaryAuthSession,
  resetPrimaryAuthGateStateForTests,
  resolveInitialPrimaryAuthGateState,
  resolvePrimaryWebSocketConnectionUrl,
} from './auth'
import { resetPrimaryEnvironmentTargetForTests } from './target'

const DESKTOP_BOOTSTRAP = {
  environment: {
    environmentId: 'environment-local',
    label: 'Local environment',
    kind: 'local-desktop' as const,
  },
  target: {
    httpBaseUrl: 'http://127.0.0.1:3773/',
    wsBaseUrl: 'ws://127.0.0.1:3773/',
  },
  bootstrapToken: 'desktop-bootstrap-token',
}

function installDesktopBootstrap() {
  Object.assign(window, {
    desktopBridge: {
      getLocalEnvironmentBootstrap: async () => DESKTOP_BOOTSTRAP,
    },
  })
}

function mockSuccessfulBootstrapFetch(sessionToken = 'fresh-session-token') {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        authenticated: true,
        role: 'owner',
        sessionMethod: 'browser-session-cookie',
        expiresAt: '2026-05-01T12:00:00.000Z',
        sessionToken,
      }),
      {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      }
    )
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function expectBootstrapFetch(fetchMock: ReturnType<typeof mockSuccessfulBootstrapFetch>) {
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:3773/api/auth/bootstrap',
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ credential: 'desktop-bootstrap-token' }),
      signal: expect.any(AbortSignal),
    })
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: new URL('http://localhost:5733/'),
      history: {
        replaceState: vi.fn(),
      },
      desktopBridge: undefined,
    },
  })
})

afterEach(() => {
  resetPrimaryAuthGateStateForTests()
  resetPrimaryEnvironmentTargetForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('primary auth session bootstrap behavior', () => {
  it('treats same-origin html auth responses as unauthenticated instead of crashing bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          headers: {
            'content-type': 'text/html',
          },
          status: 200,
        })
      )
    )

    await expect(fetchSessionState()).resolves.toEqual({
      authenticated: false,
      auth: {
        mode: 'token',
      },
    })
  })

  it('resolves the primary websocket url without a separate auth bootstrap request', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolvePrimaryWebSocketConnectionUrl('ws://127.0.0.1:3773/')).resolves.toBe(
      'ws://127.0.0.1:3773/ws'
    )

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('primary auth session recovery', () => {
  it('can refresh the desktop-managed primary auth session explicitly', async () => {
    installDesktopBootstrap()
    const fetchMock = mockSuccessfulBootstrapFetch()

    await refreshPrimaryAuthSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectBootstrapFetch(fetchMock)
  })

  it('falls back to requires-auth when desktop-managed session bootstrap fetch fails', async () => {
    installDesktopBootstrap()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    )

    await expect(resolveInitialPrimaryAuthGateState()).resolves.toEqual({
      status: 'requires-auth',
      auth: {
        mode: 'token',
      },
      errorMessage: 'Failed to fetch',
    })
  })
})
