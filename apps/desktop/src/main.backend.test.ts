import { describe, expect, it } from 'vitest'

import { createDesktopBootstrapPayload } from './main.backend'

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
        getRemoteAccessToken: () => 'remote-secret-token',
      },
      process: null,
      restartTimer: null,
      restartAttempt: 0,
    } as Parameters<typeof createDesktopBootstrapPayload>[0])

    expect(payload).toMatchObject({
      mode: 'desktop',
      host: '0.0.0.0',
      noBrowser: true,
      port: 3773,
      orxaHome: '/tmp/orxa',
      authToken: 'secret-token',
      remoteAccessToken: 'remote-secret-token',
    })
  })
})
