import { MessageId, ProjectId, ThreadId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { createMakeThread } from '../../test-helpers/makeThreadFixture'
import { deriveRailSubagentItems, hasLiveSubagent } from './ComposerSubagentRailCard.helpers'

const makeThread = createMakeThread({
  model: 'gpt-5.4',
  createdAt: '2026-04-10T11:00:00.000Z',
})

const parentThreadId = ThreadId.makeUnsafe('thread-parent')

describe('deriveRailSubagentItems', () => {
  it('derives Claude subagent rows with agent label, model, and prompt excerpt', () => {
    const childThreadId = ThreadId.makeUnsafe('thread-child-claude')
    const items = deriveRailSubagentItems(
      [
        makeThread({
          id: childThreadId,
          projectId: ProjectId.makeUnsafe('project-1'),
          modelSelection: { provider: 'claudeAgent', model: 'claude-haiku-4-5' },
          messages: [
            {
              id: MessageId.makeUnsafe('user-msg'),
              role: 'user',
              text: 'Audit the renderer live rail path for Claude child threads.',
              createdAt: '2026-04-10T11:00:01.000Z',
              streaming: false,
            },
          ],
          latestTurn: { state: 'running' } as never,
          parentLink: {
            relationKind: 'subagent',
            parentThreadId,
            agentLabel: 'Explore',
          } as never,
        }),
      ],
      parentThreadId
    )

    expect(items).toEqual([
      {
        threadId: childThreadId,
        parentThreadId,
        title: 'Thread',
        prompt: 'Audit the renderer live rail path for Claude child threads.',
        modelLabel: 'Explore · claude-haiku-4-5',
        status: 'running',
      },
    ])
  })

  it('falls back to model-only metadata when no agent label is available', () => {
    const childThreadId = ThreadId.makeUnsafe('thread-child-no-label')
    const items = deriveRailSubagentItems(
      [
        makeThread({
          id: childThreadId,
          modelSelection: { provider: 'claudeAgent', model: 'claude-sonnet-4-6' },
          messages: [
            {
              id: MessageId.makeUnsafe('user-msg-2'),
              role: 'user',
              text: 'Inspect the subagent routing and metadata mapping.',
              createdAt: '2026-04-10T11:00:01.000Z',
              streaming: false,
            },
          ],
          latestTurn: { state: 'interrupted' } as never,
          parentLink: {
            relationKind: 'subagent',
            parentThreadId,
            agentLabel: null,
          } as never,
        }),
      ],
      parentThreadId
    )

    expect(items[0]).toMatchObject({
      modelLabel: 'claude-sonnet-4-6',
      status: 'paused',
    })
  })
})

describe('hasLiveSubagent', () => {
  it('treats running and paused child threads as live', () => {
    expect(
      hasLiveSubagent([
        {
          threadId: ThreadId.makeUnsafe('thread-a'),
          parentThreadId,
          title: 'Thread A',
          prompt: null,
          modelLabel: 'claude-haiku-4-5',
          status: 'paused',
        },
      ])
    ).toBe(true)
  })
})
