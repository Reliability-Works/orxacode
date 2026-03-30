import { beforeEach, expect, it } from 'vitest'
import type { SessionMessageBundle } from '@shared/ipc'
import { deriveUnreadState, deriveUnifiedSessionStatus } from './unified-runtime'
import {
  buildCodexSessionStatus,
  buildOpencodeSessionStatus,
  selectSidebarSessionPresentation,
  useUnifiedRuntimeStore,
} from './unified-runtime-store'

beforeEach(() => {
  useUnifiedRuntimeStore.setState({
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    pendingSessionId: undefined,
    activeProvider: undefined,
    projectDataByDirectory: {},
    workspaceMetaByDirectory: {},
    opencodeSessions: {},
    codexSessions: {},
    claudeChatSessions: {},
    claudeSessions: {},
    sessionReadTimestamps: {},
    sessionAbortRequestedAt: {},
    collapsedProjects: {},
  })
})

it('treats newer activity than last read as unread for inactive sessions', () => {
  expect(deriveUnreadState(200, 100, false)).toBe(true)
  expect(deriveUnreadState(200, 250, false)).toBe(false)
  expect(deriveUnreadState(200, undefined, true)).toBe(false)
})

it('prioritizes awaiting over busy and unread', () => {
  expect(
    deriveUnifiedSessionStatus({
      busy: true,
      awaiting: true,
      planReady: true,
      activityAt: 300,
      lastReadAt: 100,
      isActive: false,
    })
  ).toMatchObject({
    type: 'awaiting',
    busy: true,
    awaiting: true,
    unread: true,
    planReady: true,
  })
})

it('marks plan ready when the session is settled and unseen', () => {
  expect(
    deriveUnifiedSessionStatus({
      busy: false,
      awaiting: false,
      planReady: true,
      activityAt: 300,
      lastReadAt: 200,
      isActive: false,
    })
  ).toMatchObject({
    type: 'plan_ready',
    unread: true,
    planReady: true,
  })
})

it('does not crash when a codex session exists in metadata before runtime hydration', () => {
  expect(() => buildCodexSessionStatus('codex::/tmp/workspace::thread-1', false)).not.toThrow()
  expect(buildCodexSessionStatus('codex::/tmp/workspace::thread-1', false)).toMatchObject({
    type: 'none',
    busy: false,
    awaiting: false,
    unread: false,
    planReady: false,
    activityAt: 0,
  })
})

it('suppresses sidebar indicators for Claude sessions', () => {
  useUnifiedRuntimeStore.setState({
    claudeSessions: {
      'claude::/tmp/workspace::thread-1': {
        key: 'claude::/tmp/workspace::thread-1',
        directory: '/tmp/workspace',
        busy: true,
        awaiting: false,
        activityAt: 100,
      },
    },
  })

  expect(
    selectSidebarSessionPresentation({
      provider: 'claude',
      directory: '/tmp/workspace',
      sessionID: 'thread-1',
      updatedAt: 100,
      isActive: false,
      sessionKey: 'claude::/tmp/workspace::thread-1',
    })
  ).toMatchObject({
    indicator: 'none',
    statusType: 'busy',
  })
})

it('treats opencode sessions with running tool parts as busy even without session.status', () => {
  const now = Date.now()
  const messages: SessionMessageBundle[] = [
    {
      info: {
        id: 'turn-3',
        role: 'assistant',
        sessionID: 'session-3',
        time: { created: now, updated: now },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: 'tool-running-1',
          type: 'tool',
          sessionID: 'session-3',
          messageID: 'turn-3',
          callID: 'call-running-1',
          tool: 'write',
          state: {
            status: 'running',
            input: { filePath: '/tmp/workspace/convex/schema.ts', content: 'export default {}' },
            time: { start: now },
          },
        },
      ] as SessionMessageBundle['parts'],
    },
  ]

  useUnifiedRuntimeStore.setState({
    opencodeSessions: {
      'opencode::/tmp/workspace::session-3': {
        key: 'opencode::/tmp/workspace::session-3',
        directory: '/tmp/workspace',
        sessionID: 'session-3',
        messages,
        todoItems: [],
        runtimeSnapshot: {
          directory: '/tmp/workspace',
          sessionID: 'session-3',
          session: null,
          sessionStatus: undefined,
          permissions: [],
          questions: [],
          commands: [],
          messages,
          sessionDiff: [],
          executionLedger: { cursor: 0, records: [] },
          changeProvenance: { cursor: 0, records: [] },
        },
      },
    },
  })

  expect(buildOpencodeSessionStatus('/tmp/workspace', 'session-3', true)).toMatchObject({
    busy: true,
  })
})
