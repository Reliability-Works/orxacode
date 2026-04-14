import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  beginExpectedReconnectWindow,
  getWsConnectionStatus,
  getWsConnectionUiState,
  recordWsConnectionAttempt,
  recordWsConnectionClosed,
  recordWsConnectionOpened,
  resetWsConnectionStateForTests,
} from './wsConnectionState'

describe('wsConnectionState expected reconnect window', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-14T00:00:00.000Z'))
    resetWsConnectionStateForTests()
  })

  it('keeps the ui in connected state during an expected reconnect window', () => {
    recordWsConnectionAttempt('ws://localhost:3000/ws')
    recordWsConnectionOpened()
    recordWsConnectionClosed({ reason: 'SocketCloseError: 1006' })
    beginExpectedReconnectWindow('remote-access-toggle', 15_000)

    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe('connected')

    vi.advanceTimersByTime(15_001)

    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe('reconnecting')
  })

  it('clears the expected reconnect window once the socket opens again', () => {
    recordWsConnectionAttempt('ws://localhost:3000/ws')
    recordWsConnectionOpened()
    recordWsConnectionClosed({ reason: 'SocketCloseError: 1006' })
    beginExpectedReconnectWindow('remote-access-toggle', 15_000)

    recordWsConnectionAttempt('ws://localhost:3000/ws')
    recordWsConnectionOpened()

    expect(getWsConnectionStatus().expectedReconnectUntil).toBeNull()
    expect(getWsConnectionUiState(getWsConnectionStatus())).toBe('connected')
  })
})
