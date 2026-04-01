import { describe, expect, it } from 'vitest'
import {
  buildCodexMessagesFromThread,
  extractThreadFromResumeResponse,
} from './codex-thread-transcript'

const resumedChildThreadFixture = {
  id: 'child-1',
  turns: [
    {
      items: [
        {
          id: 'child-user-1',
          type: 'userMessage',
          content: [{ type: 'text', text: 'Inspect the repo' }],
        },
        {
          id: 'child-assistant-1',
          type: 'agentMessage',
          text: 'I found eight sites and one template.',
        },
        {
          id: 'child-command-1',
          type: 'commandExecution',
          command: ['bash', '-lc', 'rg site'],
          aggregatedOutput: 'match',
          status: 'completed',
        },
        {
          id: 'child-read-1',
          type: 'fileRead',
          path: '/repo/apps/site/README.md',
          status: 'completed',
        },
        {
          id: 'child-search-1',
          type: 'webSearch',
          query: 'best booking site ux examples',
          status: 'completed',
        },
        {
          id: 'child-change-1',
          type: 'fileChange',
          path: 'src/app.tsx',
          changeType: 'modified',
          status: 'completed',
          insertions: 3,
          deletions: 1,
        },
      ],
    },
  ],
}

describe('codex-thread-transcript', () => {
  it('extracts the thread record from a resume response', () => {
    const thread = extractThreadFromResumeResponse({
      result: {
        thread: {
          id: 'child-1',
        },
      },
    })
    expect(thread).toMatchObject({ id: 'child-1' })
  })

  it('builds codex transcript items from resumed child thread turns', () => {
    const messages = buildCodexMessagesFromThread(resumedChildThreadFixture)

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-user-1',
          kind: 'message',
          role: 'user',
          content: 'Inspect the repo',
        }),
        expect.objectContaining({
          id: 'child-assistant-1',
          kind: 'message',
          role: 'assistant',
          content: 'I found eight sites and one template.',
        }),
        expect.objectContaining({
          kind: 'explore',
          status: 'explored',
          entries: expect.arrayContaining([
            expect.objectContaining({
              id: 'child-command-1',
              kind: 'search',
              label: 'Searched for site',
            }),
            expect.objectContaining({
              id: 'child-read-1',
              kind: 'read',
              label: 'Read README.md',
            }),
            expect.objectContaining({
              id: 'child-search-1',
              kind: 'search',
              label: 'Searched for best booking site ux examples',
            }),
          ]),
        }),
        expect.objectContaining({
          id: 'child-change-1',
          kind: 'diff',
          path: 'src/app.tsx',
        }),
      ])
    )
  })
})
