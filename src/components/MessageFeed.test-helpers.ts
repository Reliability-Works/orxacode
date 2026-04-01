import type { SessionMessageBundle } from '@shared/ipc'

export function setOpencodeLoadMessagesMock(loadMessages: () => Promise<SessionMessageBundle[]>) {
  const currentOrxa = (window as { orxa?: unknown }).orxa as
    | { opencode?: Record<string, unknown> }
    | undefined
  Object.defineProperty(window, 'orxa', {
    value: {
      ...(currentOrxa ?? {}),
      opencode: { ...(currentOrxa?.opencode ?? {}), loadMessages },
    },
    configurable: true,
  })
}

export function buildDelegatedGroupedOutputMessages(now: number): SessionMessageBundle[] {
  return [
    {
      info: {
        id: 'child-msg-grouped-output',
        role: 'assistant',
        sessionID: 'child-grouped-output',
        time: { created: now + 10, updated: now + 10 },
      } as unknown as SessionMessageBundle['info'],
      parts: [
        {
          id: 'child-tool-list',
          type: 'tool',
          sessionID: 'child-grouped-output',
          messageID: 'child-msg-grouped-output',
          callID: 'child-call-list',
          tool: 'list_directory',
          state: {
            status: 'completed',
            input: { path: '/repo/_template/src/app' },
            output: '',
            title: 'list',
            metadata: {},
            time: { start: now + 10, end: now + 11 },
          },
        },
        {
          id: 'child-tool-read-layout',
          type: 'tool',
          sessionID: 'child-grouped-output',
          messageID: 'child-msg-grouped-output',
          callID: 'child-call-read-layout',
          tool: 'read_file',
          state: {
            status: 'completed',
            input: { path: '/repo/_template/src/app/layout.tsx' },
            output: '',
            title: 'read',
            metadata: {},
            time: { start: now + 12, end: now + 13 },
          },
        },
        {
          id: 'child-tool-read-page',
          type: 'tool',
          sessionID: 'child-grouped-output',
          messageID: 'child-msg-grouped-output',
          callID: 'child-call-read-page',
          tool: 'read_file',
          state: {
            status: 'completed',
            input: { path: '/repo/_template/src/app/page.tsx' },
            output: '',
            title: 'read',
            metadata: {},
            time: { start: now + 14, end: now + 15 },
          },
        },
      ] as SessionMessageBundle['parts'],
    },
  ]
}
