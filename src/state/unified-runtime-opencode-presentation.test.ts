import type { SessionMessageBundle, SessionRuntimeSnapshot } from '@shared/ipc'
import { beforeEach, expect, it } from 'vitest'
import {
  selectActiveComposerPresentation,
  selectSessionPresentation,
  useUnifiedRuntimeStore,
} from './unified-runtime-store'

function resetStore() {
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
}

function setOpencodeRuntimeSession(
  sessionID: string,
  runtimeSnapshot: SessionRuntimeSnapshot,
  messages: SessionMessageBundle[] = runtimeSnapshot.messages
) {
  useUnifiedRuntimeStore.setState({
    opencodeSessions: {
      [`opencode::/tmp/workspace::${sessionID}`]: {
        key: `opencode::/tmp/workspace::${sessionID}`,
        directory: '/tmp/workspace',
        sessionID,
        messages,
        todoItems: [],
        runtimeSnapshot,
      },
    },
  })
}

function createBackfillRuntimeFixture(now: number): {
  messages: SessionMessageBundle[]
  runtimeSnapshot: SessionRuntimeSnapshot
} {
  const messages: SessionMessageBundle[] = [
    {
      info: {
        id: 'turn-1',
        role: 'assistant',
        sessionID: 'session-1',
        time: { created: now, updated: now },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: 'tool-1',
          type: 'tool',
          sessionID: 'session-1',
          messageID: 'turn-1',
          callID: 'call-1',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { cmd: 'mkdir -p glowbook' },
            output: '',
            title: 'mkdir -p glowbook',
            metadata: {},
            time: { start: now, end: now + 1 },
          },
        },
      ] as SessionMessageBundle['parts'],
    },
  ]

  return {
    messages,
    runtimeSnapshot: {
      directory: '/tmp/workspace',
      sessionID: 'session-1',
      session: null,
      sessionStatus: { type: 'idle' } as unknown as SessionRuntimeSnapshot['sessionStatus'],
      permissions: [],
      questions: [],
      commands: [],
      messages,
      sessionDiff: [
        {
          file: 'glowbook/package.json',
          before: '',
          after: '{"name":"glowbook"}\n{"private":true}',
          additions: 2,
          deletions: 0,
          status: 'added',
        },
      ],
      executionLedger: {
        cursor: 1,
        records: [
          {
            id: 'reasoning-1',
            directory: '/tmp/workspace',
            sessionID: 'session-1',
            timestamp: now + 5,
            kind: 'reasoning',
            summary: 'Reasoning update',
            detail: 'I have created the folder and I am wiring glowbook/package.json next.',
            actor: { type: 'main', name: 'Builder' },
            turnID: 'turn-1',
            eventID: 'reasoning-1',
          },
        ],
      },
      changeProvenance: {
        cursor: 1,
        records: [
          {
            filePath: 'glowbook/package.json',
            operation: 'edit',
            actorType: 'main',
            actorName: 'Builder',
            turnID: 'turn-1',
            eventID: 'prov-1',
            timestamp: now + 6,
            reason: 'Edited glowbook/package.json',
          },
        ],
      },
    },
  }
}

beforeEach(resetStore)

it('backfills opencode changed files and reasoning content from runtime artifacts', () => {
  const { messages, runtimeSnapshot } = createBackfillRuntimeFixture(Date.now())
  setOpencodeRuntimeSession('session-1', runtimeSnapshot, messages)

  const presentation = selectSessionPresentation({
    provider: 'opencode',
    directory: '/tmp/workspace',
    sessionID: 'session-1',
    assistantLabel: 'Builder',
  })

  expect(presentation?.latestActivityContent).toContain('glowbook/package.json')
  expect(presentation?.latestActivity?.label).not.toBe('Reasoning update')
  expect(
    presentation?.rows.some(
      row =>
        row.kind === 'diff-group' && row.files.some(file => file.path === 'glowbook/package.json')
    )
  ).toBe(true)
  const changedGroup = presentation?.rows.find(row => row.kind === 'diff-group')
  expect(
    changedGroup && 'files' in changedGroup ? changedGroup.files[0]?.diff : undefined
  ).toContain('+{"private":true}')
})

it('does not render orphan provenance-only changed files without a matching session turn', () => {
  const now = Date.now()
  setOpencodeRuntimeSession('session-2', {
    directory: '/tmp/workspace',
    sessionID: 'session-2',
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages: [],
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: {
      cursor: 1,
      records: [
        {
          filePath: 'luxe-salon/convex/schema.ts',
          operation: 'edit',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'missing-turn',
          eventID: 'prov-orphan-1',
          timestamp: now,
          reason: 'Patch update',
        },
      ],
    },
  })

  const presentation = selectSessionPresentation({
    provider: 'opencode',
    directory: '/tmp/workspace',
    sessionID: 'session-2',
    assistantLabel: 'Builder',
  })

  expect(presentation?.rows.some(row => row.kind === 'diff-group')).toBe(false)
})

it('keeps the active opencode composer busy during a recent assistant turn even before session.status arrives', () => {
  const now = Date.now()
  const messages: SessionMessageBundle[] = [
    {
      info: {
        id: 'user-turn',
        role: 'user',
        sessionID: 'session-4',
        time: { created: now - 5_000, updated: now - 5_000 },
      } as unknown as SessionMessageBundle['info'],
      parts: [],
    },
    {
      info: {
        id: 'assistant-turn',
        role: 'assistant',
        sessionID: 'session-4',
        time: { created: now - 1_000, updated: now - 1_000 },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: 'assistant-text-1',
          type: 'text',
          sessionID: 'session-4',
          messageID: 'assistant-turn',
          text: 'Now let me write all the files.',
        },
      ] as SessionMessageBundle['parts'],
    },
  ]

  setOpencodeRuntimeSession('session-4', {
    directory: '/tmp/workspace',
    sessionID: 'session-4',
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  })

  expect(
    selectActiveComposerPresentation({
      provider: 'opencode',
      directory: '/tmp/workspace',
      sessionID: 'session-4',
      sending: false,
    })
  ).toMatchObject({
    busy: true,
  })
})

it('keeps opencode changed files inline while busy even before session.status arrives', () => {
  const now = Date.now()
  const messages: SessionMessageBundle[] = [
    {
      info: {
        id: 'assistant-turn-inline',
        role: 'assistant',
        sessionID: 'session-5',
        time: { created: now - 1_000, updated: now - 1_000 },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: 'assistant-text-inline',
          type: 'text',
          sessionID: 'session-5',
          messageID: 'assistant-turn-inline',
          text: 'Now let me create all the files.',
        },
      ] as SessionMessageBundle['parts'],
    },
  ]

  useUnifiedRuntimeStore.setState({
    activeWorkspaceDirectory: '/tmp/workspace',
    activeSessionID: 'session-5',
  })
  setOpencodeRuntimeSession('session-5', {
    directory: '/tmp/workspace',
    sessionID: 'session-5',
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    sessionDiff: [
      {
        file: 'luxe-studio/convex/schema.ts',
        before: '',
        after: 'export default {};',
        additions: 1,
        deletions: 0,
        status: 'added',
      },
    ],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: {
      cursor: 1,
      records: [
        {
          filePath: 'luxe-studio/convex/schema.ts',
          operation: 'create',
          actorType: 'main',
          actorName: 'Builder',
          turnID: 'assistant-turn-inline',
          eventID: 'prov-inline-1',
          timestamp: now,
          reason: 'Created luxe-studio/convex/schema.ts',
        },
      ],
    },
  })

  const presentation = selectSessionPresentation({
    provider: 'opencode',
    directory: '/tmp/workspace',
    sessionID: 'session-5',
    sessionKey: '/tmp/workspace::session-5',
    assistantLabel: 'Builder',
  })

  expect(presentation?.rows.some(row => row.kind === 'diff-group')).toBe(false)
  expect(
    presentation?.rows.some(
      row =>
        (row.kind === 'diff' && row.path === 'luxe-studio/convex/schema.ts') ||
        (row.kind === 'tool-group' &&
          row.files.some(file => file.path === 'luxe-studio/convex/schema.ts'))
    )
  ).toBe(true)
})
