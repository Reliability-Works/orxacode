import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getPrimaryKnownEnvironment,
  resetPrimaryEnvironmentDescriptorForTests,
  resolveInitialPrimaryEnvironmentDescriptor,
  tryResolveInitialPrimaryEnvironmentDescriptor,
  writePrimaryEnvironmentDescriptor,
} from './index'
import { resetPrimaryEnvironmentTargetForTests, resolvePrimaryEnvironmentBootstrap } from './target'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
    ...init,
  })
}

const BASE_ENVIRONMENT = {
  environmentId: 'environment-local',
  label: 'Local environment',
  kind: 'local-desktop' as const,
}

const DESKTOP_BOOTSTRAP = {
  environment: BASE_ENVIRONMENT,
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

describe('primary environment bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: new URL('http://localhost/'),
        history: {
          replaceState: vi.fn(),
        },
        desktopBridge: undefined,
      },
    })
  })

  afterEach(() => {
    resetPrimaryEnvironmentDescriptorForTests()
    resetPrimaryEnvironmentTargetForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('attaches the bootstrapped environment descriptor to the desktop-managed primary environment', async () => {
    installDesktopBootstrap()

    writePrimaryEnvironmentDescriptor(BASE_ENVIRONMENT)
    await resolvePrimaryEnvironmentBootstrap()

    expect(getPrimaryKnownEnvironment()).toEqual({
      id: 'environment-local',
      label: 'Local environment',
      source: 'desktop-managed',
      environmentId: 'environment-local',
      target: {
        httpBaseUrl: 'http://127.0.0.1:3773/',
        wsBaseUrl: 'ws://127.0.0.1:3773/',
      },
    })
  })

  it('reuses an in-flight descriptor bootstrap request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(BASE_ENVIRONMENT))
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      resolveInitialPrimaryEnvironmentDescriptor(),
      resolveInitialPrimaryEnvironmentDescriptor(),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost/.well-known/orxa/environment')
  })

  it('treats same-origin html responses as an unavailable primary environment', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        headers: {
          'content-type': 'text/html',
        },
        status: 200,
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(tryResolveInitialPrimaryEnvironmentDescriptor()).resolves.toBeNull()
  })

  it('treats desktop-managed fetch failures as an unavailable descriptor instead of crashing boot', async () => {
    installDesktopBootstrap()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(tryResolveInitialPrimaryEnvironmentDescriptor()).resolves.toBeNull()
  })
})
