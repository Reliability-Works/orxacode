import { describe, expect, it, vi } from 'vitest'
import {
  handleProjectRuntimeEvent,
  handleSessionRuntimeDeltaEvent,
  handleSessionRuntimeEvent,
} from './app-core-project-events'

function createContext(overrides?: Record<string, unknown>) {
  return {
    activeProjectDir: '/repo',
    activeSessionID: 'session-1',
    addSessionFeedNotice: vi.fn(),
    applyOpencodeStreamEvent: vi.fn(),
    applyRuntimeSnapshot: vi.fn(() => []),
    buildSessionFeedNoticeKey: (directory: string, sessionID: string) =>
      `${directory}::${sessionID}`,
    getManualSessionStopState: vi.fn(() => undefined),
    isRecoverableSessionError: vi.fn(() => false),
    markManualSessionStopNoticeEmitted: vi.fn(),
    pruneManualSessionStops: vi.fn(),
    pushToast: vi.fn(),
    queueRefresh: vi.fn(),
    scheduleGitRefresh: vi.fn(),
    setStatusLine: vi.fn(),
    stopResponsePolling: vi.fn(),
    ...overrides,
  }
}

describe('app-core-project-events', () => {
  it('does not double-apply session-scoped project events', () => {
    const context = createContext()

    handleProjectRuntimeEvent(
      {
        type: 'opencode.project',
        payload: {
          directory: '/repo',
          sessionID: 'session-1',
          cursor: 12,
          event: {
            type: 'session.status',
            properties: {
              sessionID: 'session-1',
              status: { type: 'busy' },
            },
          },
        },
      } as never,
      context as never
    )

    expect(context.applyOpencodeStreamEvent).not.toHaveBeenCalled()
  })

  it('applies session-scoped stream events through dedicated handler', () => {
    const context = createContext()

    handleSessionRuntimeEvent(
      {
        type: 'opencode.session',
        payload: {
          directory: '/repo',
          sessionID: 'session-1',
          cursor: 3,
          event: {
            type: 'message.updated',
            properties: { sessionID: 'session-1' },
          },
        },
      } as never,
      context as never
    )

    expect(context.applyOpencodeStreamEvent).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ type: 'message.updated' }),
      3
    )
  })

  it('applies runtime delta only for active session target', () => {
    const context = createContext({ activeProjectDir: '/repo', activeSessionID: 'session-1' })

    handleSessionRuntimeDeltaEvent(
      {
        type: 'opencode.session.runtime',
        payload: {
          directory: '/repo',
          sessionID: 'session-1',
          runtime: {
            directory: '/repo',
            sessionID: 'session-1',
            session: null,
            sessionStatus: { type: 'busy' },
            permissions: [],
            questions: [],
            commands: [],
            messages: [],
            sessionDiff: [],
            executionLedger: { cursor: 0, records: [] },
            changeProvenance: { cursor: 0, records: [] },
          },
        },
      } as never,
      context as never
    )

    expect(context.applyRuntimeSnapshot).toHaveBeenCalledWith(
      '/repo',
      'session-1',
      expect.objectContaining({ sessionID: 'session-1' }),
      true
    )
  })
})
