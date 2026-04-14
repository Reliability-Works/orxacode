// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  connectRemoteEnvironment,
  getEnvironmentRuntimeDebugState,
  resetEnvironmentRuntimeForTests,
} from './service'
import {
  getSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken,
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

describe('ephemeral remote runtime connections', () => {
  it('connects from pairing input without persisting remote credentials', async () => {
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
    expect(getSavedEnvironmentRecord('environment-remote')).toBeNull()
    expect(readSavedEnvironmentBearerToken('environment-remote')).toBeNull()
  })

  it('replaces the active remote connection on a new pairing session', async () => {
    mockPairingFetchSequence([
      {
        environmentId: 'environment-one',
        label: 'Remote one',
        sessionToken: 'bearer-one',
      },
      {
        environmentId: 'environment-two',
        label: 'Remote two',
        sessionToken: 'bearer-two',
      },
    ])

    const firstConnection = await connectRemoteEnvironment(
      {
        pairingUrl: 'https://remote-one.example.com/pair#token=PAIR1111',
      },
      'test-first'
    )
    const debugAfterFirst = getEnvironmentRuntimeDebugState()
    const secondConnection = await connectRemoteEnvironment(
      {
        pairingUrl: 'https://remote-two.example.com/pair#token=PAIR2222',
      },
      'test-second'
    )
    const debugAfterSecond = getEnvironmentRuntimeDebugState()

    expect(secondConnection).not.toBe(firstConnection)
    expect(secondConnection.connectionId).not.toBe(firstConnection.connectionId)
    expect(debugAfterSecond.runtimeGeneration).toBeGreaterThan(debugAfterFirst.runtimeGeneration)
    expect(getSavedEnvironmentRecord('environment-one')).toBeNull()
    expect(getSavedEnvironmentRecord('environment-two')).toBeNull()
  })
})
