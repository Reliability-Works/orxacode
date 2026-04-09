import { TurnId, type OrchestrationThreadActivity } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveWorkLogEntries } from './session-logic'
import { makeActivity } from './session-logic.test.helpers'

describe('deriveWorkLogEntries lifecycle filtering', () => {
  it('omits tool started entries and keeps completed entries', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'tool-complete',
        createdAt: '2026-02-23T00:00:03.000Z',
        summary: 'Tool call complete',
        kind: 'tool.completed',
      }),
      makeActivity({
        id: 'tool-start',
        createdAt: '2026-02-23T00:00:02.000Z',
        summary: 'Tool call',
        kind: 'tool.started',
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['tool-complete'])
  })

  it('omits task start and completion lifecycle entries', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'task-start',
        createdAt: '2026-02-23T00:00:01.000Z',
        kind: 'task.started',
        summary: 'default task started',
        tone: 'info',
      }),
      makeActivity({
        id: 'task-progress',
        createdAt: '2026-02-23T00:00:02.000Z',
        kind: 'task.progress',
        summary: 'Updating files',
        tone: 'info',
      }),
      makeActivity({
        id: 'task-complete',
        createdAt: '2026-02-23T00:00:03.000Z',
        kind: 'task.completed',
        summary: 'Task completed',
        tone: 'info',
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['task-progress'])
  })
})

describe('deriveWorkLogEntries telemetry filtering', () => {
  it('omits Opencode startup telemetry task progress entries from the visible work log', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'opencode-startup-progress',
        createdAt: '2026-02-23T00:00:01.000Z',
        kind: 'task.progress',
        summary: 'Reasoning update',
        tone: 'info',
        payload: {
          taskId: 'opencode-startup-turn-1',
          summary: 'Prompt accepted by Opencode after 8ms.',
          detail: 'Prompt accepted by Opencode after 8ms.',
        },
      }),
      makeActivity({
        id: 'normal-task-progress',
        createdAt: '2026-02-23T00:00:02.000Z',
        kind: 'task.progress',
        summary: 'Updating files',
        tone: 'info',
        payload: {
          taskId: 'claude-task-1',
          summary: 'Updating files',
        },
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['normal-task-progress'])
  })
})

describe('deriveWorkLogEntries turn filtering', () => {
  it('filters by turn id when provided', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({ id: 'turn-1', turnId: 'turn-1', summary: 'Tool call', kind: 'tool.started' }),
      makeActivity({
        id: 'turn-2',
        turnId: 'turn-2',
        summary: 'Tool call complete',
        kind: 'tool.completed',
      }),
      makeActivity({ id: 'no-turn', summary: 'Checkpoint captured', tone: 'info' }),
    ]

    const entries = deriveWorkLogEntries(activities, TurnId.makeUnsafe('turn-2'))
    expect(entries.map(entry => entry.id)).toEqual(['turn-2'])
  })
})

describe('deriveWorkLogEntries lifecycle suppression', () => {
  it('omits checkpoint captured info entries', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'checkpoint',
        createdAt: '2026-02-23T00:00:01.000Z',
        summary: 'Checkpoint captured',
        tone: 'info',
      }),
      makeActivity({
        id: 'tool-complete',
        createdAt: '2026-02-23T00:00:02.000Z',
        summary: 'Ran command',
        tone: 'tool',
        kind: 'tool.completed',
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['tool-complete'])
  })

  it('omits ExitPlanMode lifecycle entries once the plan card is shown', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'exit-plan-updated',
        createdAt: '2026-02-23T00:00:01.000Z',
        kind: 'tool.updated',
        summary: 'Tool call',
        payload: {
          detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"run tests"}]}',
        },
      }),
      makeActivity({
        id: 'exit-plan-completed',
        createdAt: '2026-02-23T00:00:02.000Z',
        kind: 'tool.completed',
        summary: 'Tool call',
        payload: {
          detail: 'ExitPlanMode: {}',
        },
      }),
      makeActivity({
        id: 'real-work-log',
        createdAt: '2026-02-23T00:00:03.000Z',
        kind: 'tool.completed',
        summary: 'Ran command',
        payload: {
          itemType: 'command_execution',
          detail: 'Bash: bun test',
        },
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['real-work-log'])
  })
})

describe('deriveWorkLogEntries ordering and metadata', () => {
  it('orders work log by activity sequence when present', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'second',
        createdAt: '2026-02-23T00:00:03.000Z',
        sequence: 2,
        summary: 'Tool call complete',
        kind: 'tool.completed',
      }),
      makeActivity({
        id: 'first',
        createdAt: '2026-02-23T00:00:04.000Z',
        sequence: 1,
        summary: 'Tool call complete',
        kind: 'tool.completed',
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['first', 'second'])
  })

  it('extracts command text for command tool activities', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'command-tool',
        kind: 'tool.completed',
        summary: 'Ran command',
        payload: {
          itemType: 'command_execution',
          data: {
            item: {
              command: ['bun', 'run', 'lint'],
            },
          },
        },
      }),
    ]

    const [entry] = deriveWorkLogEntries(activities, undefined)
    expect(entry?.command).toBe('bun run lint')
  })

  it('keeps compact Codex tool metadata used for icons and labels', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'tool-with-metadata',
        kind: 'tool.completed',
        summary: 'bash',
        payload: {
          itemType: 'command_execution',
          title: 'bash',
          status: 'completed',
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ['bun', 'run', 'dev'],
              result: {
                content: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
                exitCode: 0,
              },
            },
          },
        },
      }),
    ]

    const [entry] = deriveWorkLogEntries(activities, undefined)
    expect(entry).toMatchObject({
      command: 'bun run dev',
      detail: '{ "dev": "vite dev --port 3000" }',
      itemType: 'command_execution',
      toolTitle: 'bash',
    })
  })
})

describe('deriveWorkLogEntries change extraction', () => {
  it('extracts changed file paths for file-change tool activities', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'file-tool',
        kind: 'tool.completed',
        summary: 'File change',
        payload: {
          itemType: 'file_change',
          data: {
            item: {
              changes: [
                { path: 'apps/web/src/components/ChatView.tsx' },
                { filename: 'apps/web/src/session-logic.ts' },
              ],
            },
          },
        },
      }),
    ]

    const [entry] = deriveWorkLogEntries(activities, undefined)
    expect(entry?.changedFiles).toEqual([
      'apps/web/src/components/ChatView.tsx',
      'apps/web/src/session-logic.ts',
    ])
  })

  it('does not treat file reads as changed files just because they include file paths in payload data', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'read-tool',
        kind: 'tool.completed',
        summary: 'Read',
        payload: {
          itemType: 'mcp_tool_call',
          title: 'Read',
          detail: '/tmp/app.ts offset=0 limit=120',
          data: {
            input: {
              filePath: '/tmp/app.ts',
              offset: 0,
              limit: 120,
            },
            result: {
              loaded: ['/tmp/app.ts'],
            },
          },
        },
      }),
    ]

    const [entry] = deriveWorkLogEntries(activities, undefined)
    expect(entry?.changedFiles).toBeUndefined()
    expect(entry?.itemType).toBe('mcp_tool_call')
    expect(entry?.detail).toBe('/tmp/app.ts offset=0 limit=120')
  })
})

it('collapses repeated lifecycle updates for the same tool call into one entry', () => {
  const activities: OrchestrationThreadActivity[] = [
    makeActivity({
      id: 'tool-update-1',
      createdAt: '2026-02-23T00:00:01.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'tool-update-2',
      createdAt: '2026-02-23T00:00:02.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
        data: {
          item: {
            command: ['sed', '-n', '1,40p', '/tmp/app.ts'],
          },
        },
      },
    }),
    makeActivity({
      id: 'tool-complete',
      createdAt: '2026-02-23T00:00:03.000Z',
      kind: 'tool.completed',
      summary: 'Tool call completed',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
  ]

  const entries = deriveWorkLogEntries(activities, undefined)

  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    id: 'tool-complete',
    createdAt: '2026-02-23T00:00:03.000Z',
    label: 'Tool call completed',
    detail: 'Read: {"file_path":"/tmp/app.ts"}',
    command: 'sed -n 1,40p /tmp/app.ts',
    itemType: 'dynamic_tool_call',
    toolTitle: 'Tool call',
  })
})

it('keeps separate tool entries when an identical call starts after the prior one completed', () => {
  const activities: OrchestrationThreadActivity[] = [
    makeActivity({
      id: 'tool-1-update',
      createdAt: '2026-02-23T00:00:01.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'tool-1-complete',
      createdAt: '2026-02-23T00:00:02.000Z',
      kind: 'tool.completed',
      summary: 'Tool call completed',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'tool-2-update',
      createdAt: '2026-02-23T00:00:03.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'tool-2-complete',
      createdAt: '2026-02-23T00:00:04.000Z',
      kind: 'tool.completed',
      summary: 'Tool call completed',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
  ]

  const entries = deriveWorkLogEntries(activities, undefined)

  expect(entries.map(entry => entry.id)).toEqual(['tool-1-complete', 'tool-2-complete'])
})

it('collapses same-timestamp lifecycle rows even when completed sorts before updated by id', () => {
  const activities: OrchestrationThreadActivity[] = [
    makeActivity({
      id: 'z-update-earlier',
      createdAt: '2026-02-23T00:00:01.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'a-complete-same-timestamp',
      createdAt: '2026-02-23T00:00:02.000Z',
      kind: 'tool.completed',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
    makeActivity({
      id: 'z-update-same-timestamp',
      createdAt: '2026-02-23T00:00:02.000Z',
      kind: 'tool.updated',
      summary: 'Tool call',
      payload: {
        itemType: 'dynamic_tool_call',
        title: 'Tool call',
        detail: 'Read: {"file_path":"/tmp/app.ts"}',
      },
    }),
  ]

  const entries = deriveWorkLogEntries(activities, undefined)

  expect(entries).toHaveLength(1)
  expect(entries[0]?.id).toBe('a-complete-same-timestamp')
})

describe('deriveWorkLogEntries context window handling', () => {
  it('excludes context window updates from the work log', () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: 'context-1',
          turnId: 'turn-1',
          kind: 'context-window.updated',
          summary: 'Context window updated',
          tone: 'info',
        }),
        makeActivity({
          id: 'tool-1',
          turnId: 'turn-1',
          kind: 'tool.completed',
          summary: 'Ran command',
          tone: 'tool',
        }),
      ],
      TurnId.makeUnsafe('turn-1')
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.label).toBe('Ran command')
  })

  it('keeps context compaction activities as normal work log entries', () => {
    const entries = deriveWorkLogEntries(
      [
        makeActivity({
          id: 'compaction-1',
          turnId: 'turn-1',
          kind: 'context-compaction',
          summary: 'Context compacted',
          tone: 'info',
        }),
      ],
      TurnId.makeUnsafe('turn-1')
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.label).toBe('Context compacted')
  })
})
