import { MessageId, TurnId, type OrchestrationThreadActivity } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveActivePlanState } from './session-logic'
import { stripPromotedTaskListFromMessage } from './session-logic.plan'
import { makeActivity } from './session-logic.test.helpers'

const activePlanActivities: OrchestrationThreadActivity[] = [
  makeActivity({
    id: 'plan-old',
    createdAt: '2026-02-23T00:00:01.000Z',
    kind: 'turn.plan.updated',
    summary: 'Plan updated',
    tone: 'info',
    turnId: 'turn-1',
    payload: {
      explanation: 'Initial plan',
      plan: [{ step: 'Inspect code', status: 'pending' }],
    },
  }),
  makeActivity({
    id: 'plan-latest',
    createdAt: '2026-02-23T00:00:02.000Z',
    kind: 'turn.plan.updated',
    summary: 'Plan updated',
    tone: 'info',
    turnId: 'turn-1',
    payload: {
      explanation: 'Refined plan',
      plan: [{ step: 'Implement Codex user input', status: 'inProgress' }],
    },
  }),
]

const assistantTaskListMessages = [
  {
    id: MessageId.makeUnsafe('assistant-1'),
    role: 'assistant' as const,
    text: [
      'Task list:',
      '- [in_progress] Find the backend source of provider runtime events.',
      '- [pending] Trace how those events cross server/desktop/web boundaries.',
      '- [completed] Summarize the end-to-end path with file evidence.',
      '',
      'I am now tracing the transport layer.',
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-1'),
    createdAt: '2026-02-23T00:00:03.000Z',
    streaming: false,
  },
]

const assistantNumberedTaskListMessages = [
  {
    id: MessageId.makeUnsafe('assistant-2'),
    role: 'assistant' as const,
    text: [
      'Task list:',
      '1. In progress: identify the event pipeline layers and likely source files.',
      '2. Pending: trace provider runtime event creation and normalization in the server/runtime layer.',
      '3. Pending: trace transport into desktop/web state and the UI surfaces that render those events.',
      '4. Pending: summarize the full visibility path with exact file evidence and any branching by provider.',
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-2'),
    createdAt: '2026-02-23T00:00:04.000Z',
    streaming: false,
  },
]

const assistantPlainNumberedTaskListMessages = [
  {
    id: MessageId.makeUnsafe('assistant-3'),
    role: 'assistant' as const,
    text: [
      "I'm tracing the provider runtime event path end-to-end without changing anything.",
      '',
      'Task list:',
      '',
      '1. Map the runtime event sources in the provider/server layer.',
      '2. Trace how those events cross the contracts and desktop IPC boundary.',
      '3. Identify renderer subscriptions/selectors that make the events visible in UI state.',
      '4. Summarize the end-to-end visibility path, with the exact files read and any gaps or indirections.',
      '',
      "I'm on step 1 now and reading the repo shape plus the likely event entrypoints before narrowing to the concrete data flow.",
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-3'),
    createdAt: '2026-02-23T00:00:05.000Z',
    streaming: false,
  },
]

const assistantTaskListUpdateMessages = [
  {
    id: MessageId.makeUnsafe('assistant-4'),
    role: 'assistant' as const,
    text: [
      'Task list update:',
      '',
      '1. Map provider runtime event pipeline entrypoints: in progress',
      '2. Trace cross-process delivery into renderer state: queued',
      '3. Identify renderer surfaces that show those events: queued',
      '4. Summarize end-to-end visibility path with file references: queued',
      '',
      "I've narrowed the likely backbone now.",
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-5'),
    createdAt: '2026-02-23T00:00:07.000Z',
    streaming: false,
  },
]

const assistantRestartRecoveryMessages = [
  {
    id: MessageId.makeUnsafe('assistant-tasklist-earlier'),
    role: 'assistant' as const,
    text: [
      'Task list:',
      '1. Map the runtime event sources in the provider/server layer.',
      '2. Trace how those events cross the contracts and desktop IPC boundary.',
      '',
      "I'm on step 1 now.",
    ].join('\n'),
    turnId: TurnId.makeUnsafe('turn-7'),
    createdAt: '2026-02-23T00:00:08.000Z',
    streaming: false,
  },
  {
    id: MessageId.makeUnsafe('assistant-later-summary'),
    role: 'assistant' as const,
    text: 'I narrowed the source files and will keep reading.',
    turnId: TurnId.makeUnsafe('turn-8'),
    createdAt: '2026-02-23T00:00:09.000Z',
    streaming: false,
  },
]

const opencodeTodoToolActivity = makeActivity({
  id: 'tool-todo-opencode',
  createdAt: '2026-02-23T00:00:03.500Z',
  kind: 'tool.updated',
  summary: 'Todos',
  tone: 'tool',
  turnId: 'turn-opencode-1',
  payload: {
    itemType: 'mcp_tool_call',
    data: {
      input: {
        todos: [
          { content: 'Audit provider routing.', status: 'in_progress' },
          { content: 'Summarize findings.', status: 'pending' },
          { content: 'Write validation prompt.', status: 'completed' },
        ],
      },
    },
  },
})

const claudeTodoToolActivity = makeActivity({
  id: 'tool-todo-claude',
  createdAt: '2026-02-23T00:00:03.750Z',
  kind: 'tool.completed',
  summary: 'TodoWrite',
  tone: 'tool',
  turnId: 'turn-claude-1',
  payload: {
    itemType: 'builtin_tool_call',
    data: {
      item: {
        tool_name: 'TodoWrite',
        todos: [
          { content: 'Audit the Claude ingestion path.', status: 'in_progress' },
          { content: 'Summarize the renderer behavior.', status: 'pending' },
          { content: 'Capture the validation prompt.', status: 'completed' },
        ],
      },
    },
  },
})

describe('deriveActivePlanState', () => {
  it('returns the latest plan update for the active turn', () => {
    expect(deriveActivePlanState(activePlanActivities, TurnId.makeUnsafe('turn-1'))).toEqual({
      createdAt: '2026-02-23T00:00:02.000Z',
      turnId: 'turn-1',
      explanation: 'Refined plan',
      steps: [{ step: 'Implement Codex user input', status: 'inProgress' }],
    })
  })

  it('normalizes structured in_progress statuses and strips backticked status labels from step text', () => {
    expect(
      deriveActivePlanState(
        [
          makeActivity({
            id: 'plan-structured-normalized',
            createdAt: '2026-02-23T00:00:06.000Z',
            kind: 'turn.plan.updated',
            summary: 'Plan updated',
            tone: 'info',
            turnId: 'turn-4',
            payload: {
              plan: [
                { step: '`[in_progress]` Find the event source.', status: 'in_progress' },
                { step: '`[pending]` Trace the renderer.', status: 'pending' },
              ],
            },
          }),
        ],
        TurnId.makeUnsafe('turn-4')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:06.000Z',
      turnId: 'turn-4',
      steps: [
        { step: 'Find the event source.', status: 'inProgress' },
        { step: 'Trace the renderer.', status: 'pending' },
      ],
    })
  })
})

describe('deriveActivePlanState text fallback', () => {
  it('falls back to assistant task-list text when no structured plan activity exists', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-1'),
        assistantTaskListMessages,
        MessageId.makeUnsafe('assistant-1')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:03.000Z',
      turnId: 'turn-1',
      steps: [
        {
          step: 'Find the backend source of provider runtime events.',
          status: 'inProgress',
        },
        {
          step: 'Trace how those events cross server/desktop/web boundaries.',
          status: 'pending',
        },
        {
          step: 'Summarize the end-to-end path with file evidence.',
          status: 'completed',
        },
      ],
    })
  })
})

describe('deriveActivePlanState tool todo fallback', () => {
  it('parses persisted todo-tool activity payloads when no structured plan event exists', () => {
    expect(
      deriveActivePlanState([opencodeTodoToolActivity], TurnId.makeUnsafe('turn-opencode-1'))
    ).toEqual({
      createdAt: '2026-02-23T00:00:03.500Z',
      turnId: 'turn-opencode-1',
      steps: [
        { step: 'Audit provider routing.', status: 'inProgress' },
        { step: 'Summarize findings.', status: 'pending' },
        { step: 'Write validation prompt.', status: 'completed' },
      ],
    })
  })

  it('parses Claude TodoWrite-style payloads from built-in tool activity data', () => {
    expect(
      deriveActivePlanState([claudeTodoToolActivity], TurnId.makeUnsafe('turn-claude-1'))
    ).toEqual({
      createdAt: '2026-02-23T00:00:03.750Z',
      turnId: 'turn-claude-1',
      steps: [
        { step: 'Audit the Claude ingestion path.', status: 'inProgress' },
        { step: 'Summarize the renderer behavior.', status: 'pending' },
        { step: 'Capture the validation prompt.', status: 'completed' },
      ],
    })
  })
})

describe('deriveActivePlanState numbered status-prefix fallback', () => {
  it('parses numbered status-prefix task lists from assistant text', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-2'),
        assistantNumberedTaskListMessages,
        MessageId.makeUnsafe('assistant-2')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:04.000Z',
      turnId: 'turn-2',
      steps: [
        {
          step: 'identify the event pipeline layers and likely source files.',
          status: 'inProgress',
        },
        {
          step: 'trace provider runtime event creation and normalization in the server/runtime layer.',
          status: 'pending',
        },
        {
          step: 'trace transport into desktop/web state and the UI surfaces that render those events.',
          status: 'pending',
        },
        {
          step: 'summarize the full visibility path with exact file evidence and any branching by provider.',
          status: 'pending',
        },
      ],
    })
  })
})

describe('deriveActivePlanState plain numbered fallback', () => {
  it('parses plain numbered task lists and infers the active step from follow-up text', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-3'),
        assistantPlainNumberedTaskListMessages,
        MessageId.makeUnsafe('assistant-3')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:05.000Z',
      turnId: 'turn-3',
      steps: [
        {
          step: 'Map the runtime event sources in the provider/server layer.',
          status: 'inProgress',
        },
        {
          step: 'Trace how those events cross the contracts and desktop IPC boundary.',
          status: 'pending',
        },
        {
          step: 'Identify renderer subscriptions/selectors that make the events visible in UI state.',
          status: 'pending',
        },
        {
          step: 'Summarize the end-to-end visibility path, with the exact files read and any gaps or indirections.',
          status: 'pending',
        },
      ],
    })
  })
})

describe('deriveActivePlanState task list update suffix-status fallback', () => {
  it('parses task list update headings and suffix statuses', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-5'),
        assistantTaskListUpdateMessages,
        MessageId.makeUnsafe('assistant-4')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:07.000Z',
      turnId: 'turn-5',
      steps: [
        {
          step: 'Map provider runtime event pipeline entrypoints',
          status: 'inProgress',
        },
        {
          step: 'Trace cross-process delivery into renderer state',
          status: 'pending',
        },
        {
          step: 'Identify renderer surfaces that show those events',
          status: 'pending',
        },
        {
          step: 'Summarize end-to-end visibility path with file references',
          status: 'pending',
        },
      ],
    })
  })
})

describe('deriveActivePlanState historical recovery fallback', () => {
  it('recovers the latest historical task-list message when newer assistant messages do not contain one', () => {
    expect(
      deriveActivePlanState(
        [],
        TurnId.makeUnsafe('turn-8'),
        assistantRestartRecoveryMessages,
        MessageId.makeUnsafe('assistant-later-summary')
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:08.000Z',
      turnId: 'turn-7',
      steps: [
        {
          step: 'Map the runtime event sources in the provider/server layer.',
          status: 'inProgress',
        },
        {
          step: 'Trace how those events cross the contracts and desktop IPC boundary.',
          status: 'pending',
        },
      ],
    })
  })

  it('recovers the latest historical structured plan when the current turn has none', () => {
    expect(
      deriveActivePlanState(
        [
          makeActivity({
            id: 'plan-earlier',
            createdAt: '2026-02-23T00:00:10.000Z',
            kind: 'turn.plan.updated',
            summary: 'Plan updated',
            tone: 'info',
            turnId: 'turn-9',
            payload: {
              plan: [{ step: 'Inspect runtime emitters', status: 'inProgress' }],
            },
          }),
        ],
        TurnId.makeUnsafe('turn-10'),
        [],
        null
      )
    ).toEqual({
      createdAt: '2026-02-23T00:00:10.000Z',
      turnId: 'turn-9',
      steps: [{ step: 'Inspect runtime emitters', status: 'inProgress' }],
    })
  })
})

describe('stripPromotedTaskListFromMessage', () => {
  it('removes promoted task-list blocks while keeping surrounding assistant text', () => {
    const message = assistantPlainNumberedTaskListMessages[0]
    expect(message).toBeDefined()
    expect(stripPromotedTaskListFromMessage(message!.text)).toBe(
      [
        "I'm tracing the provider runtime event path end-to-end without changing anything.",
        '',
        "I'm on step 1 now and reading the repo shape plus the likely event entrypoints before narrowing to the concrete data flow.",
      ].join('\n')
    )
  })

  it('removes task list update blocks with suffix statuses', () => {
    const message = assistantTaskListUpdateMessages[0]
    expect(message).toBeDefined()
    expect(stripPromotedTaskListFromMessage(message!.text)).toBe(
      "I've narrowed the likely backbone now."
    )
  })
})
