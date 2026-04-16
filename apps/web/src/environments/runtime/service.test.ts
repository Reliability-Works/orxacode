// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  connectRemoteEnvironment,
  getEnvironmentRuntimeDebugState,
  initializeSavedRemoteEnvironmentRuntime,
  resetEnvironmentRuntimeForTests,
} from './service'
import {
  getSavedEnvironmentRecord,
  readSavedEnvironmentSecret,
  resetSavedEnvironmentRegistryForTests,
} from './catalog'

function mockPairingFetchSequence(
  responses: ReadonlyArray<{
    readonly environmentId: string
    readonly label: string
    readonly sessionToken: string
  }>
) {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environmentId: response.environmentId,
            label: response.label,
            kind: 'local-desktop',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            role: 'client',
            sessionMethod: 'bearer-session-token',
            expiresAt: '2026-05-01T12:00:00.000Z',
            sessionToken: response.sessionToken,
          }),
          { status: 200 }
        )
      )
  }
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  window.localStorage.clear()
  void resetEnvironmentRuntimeForTests()
  vi.restoreAllMocks()
})

afterEach(() => {
  void resetEnvironmentRuntimeForTests()
  resetSavedEnvironmentRegistryForTests()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('saved remote runtime connections', () => {
  it('connects from pairing input and persists the remote credential for reuse', async () => {
    mockPairingFetchSequence([
      {
        environmentId: 'environment-remote',
        label: 'Remote environment',
        sessionToken: 'bearer-token',
      },
    ])

    const connection = await connectRemoteEnvironment(
      {
        pairingUrl: 'https://remote.example.com/pair#token=PAIR1234CODE',
      },
      'test-pair'
    )

    expect(connection.environmentId).toBe('environment-remote')
    expect(getSavedEnvironmentRecord('environment-remote')).toMatchObject({
      environmentId: 'environment-remote',
      httpBaseUrl: 'https://remote.example.com/',
      wsBaseUrl: 'wss://remote.example.com/',
      label: 'Remote environment',
    })
    expect(readSavedEnvironmentSecret('environment-remote')).toBe('PAIR1234CODE')
  })

  it('reuses a saved remote credential to resume without a new pairing token', async () => {
    mockPairingFetchSequence([
      {
        environmentId: 'environment-remote',
        label: 'Remote environment',
        sessionToken: 'bearer-first',
      },
      {
        environmentId: 'environment-remote',
        label: 'Remote environment',
        sessionToken: 'bearer-second',
      },
    ])

    const firstConnection = await connectRemoteEnvironment(
      {
        pairingUrl: 'https://remote.example.com/pair#token=PAIR1234CODE',
      },
      'test-first'
    )
    const debugAfterFirst = getEnvironmentRuntimeDebugState()
    const secondConnection = await initializeSavedRemoteEnvironmentRuntime('test-resume')
    const debugAfterSecond = getEnvironmentRuntimeDebugState()

    expect(secondConnection).not.toBe(firstConnection)
    expect(secondConnection.connectionId).not.toBe(firstConnection.connectionId)
    expect(debugAfterSecond.runtimeGeneration).toBeGreaterThan(debugAfterFirst.runtimeGeneration)
    expect(getSavedEnvironmentRecord('environment-remote')).toMatchObject({
      environmentId: 'environment-remote',
      httpBaseUrl: 'https://remote.example.com/',
      wsBaseUrl: 'wss://remote.example.com/',
      label: 'Remote environment',
    })
    expect(readSavedEnvironmentSecret('environment-remote')).toBe('PAIR1234CODE')
  })
})
