import { expect, it } from 'vitest'
import type { ProjectBootstrap, SessionRuntimeSnapshot } from '@shared/ipc'
import {
  applyOpencodeProjectEvent,
  applyOpencodeSessionEvent,
  createEmptyRuntimeSnapshot,
} from './opencode-event-reducer'

it('updates active session messages from raw message and part events', () => {
  const directory = '/repo'
  const sessionID = 'session-1'
  const base = createEmptyRuntimeSnapshot(directory, sessionID)

  const withMessage = applyOpencodeSessionEvent({
    directory,
    sessionID,
    snapshot: base,
    messages: [],
    event: {
      type: 'message.updated',
      properties: {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          sessionID,
          time: { created: 1, updated: 1 },
        },
      },
    } as never,
  })

  const withPart = applyOpencodeSessionEvent({
    directory,
    sessionID,
    snapshot: withMessage.snapshot,
    messages: withMessage.messages,
    event: {
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          type: 'text',
          sessionID,
          messageID: 'assistant-1',
          text: 'Hello',
        },
      },
    } as never,
  })

  const withDelta = applyOpencodeSessionEvent({
    directory,
    sessionID,
    snapshot: withPart.snapshot,
    messages: withPart.messages,
    event: {
      type: 'message.part.delta',
      properties: {
        sessionID,
        messageID: 'assistant-1',
        partID: 'part-1',
        field: 'text',
        delta: ' world',
      },
    } as never,
  })

  expect(withDelta.messages).toHaveLength(1)
  expect(withDelta.messages[0]?.parts[0]).toMatchObject({ text: 'Hello world' })
})

it('keeps project cache session-scoped and updates session status from raw events', () => {
  const project = {
    directory: '/repo',
    path: {},
    sessions: [
      {
        id: 'session-1',
        slug: 'session-1',
        title: 'Session 1',
        time: { created: 1, updated: 1 },
      },
    ],
    sessionStatus: {},
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {},
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys: [],
  } as unknown as ProjectBootstrap

  const updated = applyOpencodeProjectEvent(project, {
    type: 'session.status',
    properties: {
      sessionID: 'session-1',
      status: { type: 'busy' },
    },
  } as never)

  expect(updated?.sessionStatus['session-1']).toMatchObject({ type: 'busy' })
})

it('stores canonical session diff from upstream session.diff events', () => {
  const snapshot: SessionRuntimeSnapshot = createEmptyRuntimeSnapshot('/repo', 'session-1')

  const applied = applyOpencodeSessionEvent({
    directory: '/repo',
    sessionID: 'session-1',
    snapshot,
    messages: [],
    event: {
      type: 'session.diff',
      properties: {
        sessionID: 'session-1',
        diff: [
          {
            file: 'package.json',
            before: '',
            after: '{}',
            additions: 1,
            deletions: 0,
          },
        ],
      },
    } as never,
  })

  expect(applied.snapshot?.sessionDiff).toEqual([
    {
      file: 'package.json',
      before: '',
      after: '{}',
      additions: 1,
      deletions: 0,
    },
  ])
})
