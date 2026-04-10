import { MessageId, TurnId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveActivePlanState } from './session-logic'

const assistantSentenceSuffixTaskListMessages = [
  {
    id: MessageId.makeUnsafe('assistant-5'),
    role: 'assistant' as const,
    text: [
      'Task list:',
      '1. Find the main event-producing runtime paths for provider sessions. In progress.',
      '2. Trace how those events cross the desktop/server/contracts boundaries. In progress.',
      '3. Trace how the renderer subscribes to them and turns them into visible UI state. In progress.',
      '4. Summarize the end-to-end path, key files, and any gaps or dead ends. Pending.',
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-11'),
    createdAt: '2026-02-23T00:00:11.000Z',
    streaming: false,
  },
]

describe('deriveActivePlanState sentence suffix fallback', () => {
  it('parses sentence-suffix statuses like In progress. and Pending.', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-11'),
        assistantSentenceSuffixTaskListMessages,
        MessageId.makeUnsafe('assistant-5')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:11.000Z',
      turnId: 'turn-11',
      steps: [
        {
          step: 'Find the main event-producing runtime paths for provider sessions.',
          status: 'inProgress',
        },
        {
          step: 'Trace how those events cross the desktop/server/contracts boundaries.',
          status: 'inProgress',
        },
        {
          step: 'Trace how the renderer subscribes to them and turns them into visible UI state.',
          status: 'inProgress',
        },
        {
          step: 'Summarize the end-to-end path, key files, and any gaps or dead ends.',
          status: 'pending',
        },
      ],
    })
  })
})
