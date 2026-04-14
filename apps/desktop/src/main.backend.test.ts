import { describe, expect, it } from 'vitest'

import { createDesktopBootstrapPayload, shouldRestartBackendAfterExit } from './main.backend'

describe('createDesktopBootstrapPayload', () => {
  it('binds the desktop backend on all interfaces for local phone access', () => {
    const payload = createDesktopBootstrapPayload({
      host: {
        config: {
          baseDir: '/tmp/orxa',
          appRunId: 'run-1',
        },
        logging: {} as never,
        isQuitting: () => false,
        resolveBackendEntry: () => '/tmp/server.mjs',
        resolveBackendCwd: () => '/tmp',
        getBackendPort: () => 3773,
        getBackendAuthToken: () => 'secret-token',
        getRemoteAccessBootstrapToken: () => 'bootstrap-token',
        getRemoteAccessEnvironmentId: () => 'environment-1',
      },
      process: null,
      restartTimer: null,
      restartAttempt: 0,
      expectedExitChildren: new WeakSet(),
    } as Parameters<typeof createDesktopBootstrapPayload>[0])

    expect(payload).toMatchObject({
      mode: 'desktop',
      host: '0.0.0.0',
      noBrowser: true,
      port: 3773,
      orxaHome: '/tmp/orxa',
      authToken: 'secret-token',
      remoteAccessBootstrapToken: 'bootstrap-token',
      remoteAccessEnvironmentId: 'environment-1',
    })
  })
})

describe('shouldRestartBackendAfterExit', () => {
  it('skips restart for intentional backend stops', () => {
    expect(
      shouldRestartBackendAfterExit({
        expectedExit: true,
        isQuitting: false,
      })
    ).toBe(false)
  })

  it('restarts unexpected backend exits while the app is still running', () => {
    expect(
      shouldRestartBackendAfterExit({
        expectedExit: false,
        isQuitting: false,
      })
    ).toBe(true)
  })
})
