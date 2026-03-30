import { describe, expect, it } from 'vitest'
import {
  buildCodexMessagesFromThread,
  extractThreadFromResumeResponse,
} from './codex-thread-transcript'

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
    const messages = buildCodexMessagesFromThread({
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
          ],
        },
      ],
    })

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
          id: 'child-command-1',
          kind: 'tool',
          toolType: 'commandExecution',
          command: 'bash -lc rg site',
        }),
      ])
    )
  })
})
