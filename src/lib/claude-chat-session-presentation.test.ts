import { describe, expect, it } from 'vitest'
import { projectClaudeChatSessionPresentation } from './claude-chat-session-presentation'
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from '../hooks/useClaudeChatSession'
import type { ExploreEntry } from './explore-utils'

function createExploreMessage(
  id: string,
  status: 'exploring' | 'explored',
  source: 'main' | 'delegated',
  entries: ExploreEntry[] = []
): ClaudeChatMessageItem {
  return {
    id,
    kind: 'explore',
    source,
    status,
    entries,
    timestamp: 1,
  }
}

function createSubagent(
  id: string,
  taskText: string,
  status: ClaudeChatSubagentState['status'] = 'thinking'
): ClaudeChatSubagentState {
  return {
    id,
    name: 'researcher',
    status,
    statusText: 'running',
    taskText,
  }
}

function registerExploreProjectionTests() {
  it('keeps adjacent main-thread Claude explore rows separate instead of collapsing them into one row', () => {
    const messages: ClaudeChatMessageItem[] = [
      createExploreMessage('explore-1', 'exploring', 'main', [
        { id: 'entry-1', kind: 'search', label: 'Search workspace', status: 'running' },
      ]),
      createExploreMessage('explore-2', 'explored', 'main', [
        { id: 'entry-2', kind: 'read', label: 'Read failing.test.ts', status: 'completed' },
      ]),
    ]

    const presentation = projectClaudeChatSessionPresentation(messages, true, [])
    expect(presentation.rows).toHaveLength(2)
    expect(presentation.rows[0]).toMatchObject({
      kind: 'explore',
      item: {
        status: 'exploring',
        entries: [expect.objectContaining({ id: 'entry-1' })],
      },
    })
    expect(presentation.rows[1]).toMatchObject({
      kind: 'explore',
      item: {
        status: 'explored',
        entries: [expect.objectContaining({ id: 'entry-2' })],
      },
    })
  })

  it('renders Claude delegating after the active assistant message while keeping delegated explore rows visible', () => {
    const messages: ClaudeChatMessageItem[] = [
      { id: 'thinking-1', kind: 'thinking', timestamp: 1 },
      { id: 'assistant-1', kind: 'message', role: 'assistant', content: 'Let me investigate this.', timestamp: 2 },
      createExploreMessage('explore-1', 'exploring', 'delegated', [
        {
          id: 'entry-1',
          kind: 'search',
          label: 'Find desk files',
          detail: 'Subagent',
          status: 'running',
        },
      ]),
    ]
    const subagents = [createSubagent('task-1', 'runtime asset cache invalidation')]

    const presentation = projectClaudeChatSessionPresentation(messages, true, subagents)
    expect(presentation.rows.map(row => row.kind)).toEqual(['message', 'thinking', 'explore'])
    expect(presentation.rows[1]).toMatchObject({
      kind: 'thinking',
      summary: 'Delegating: Waiting on runtime asset cache invalidation',
    })
    expect(presentation.rows[2]).toMatchObject({
      kind: 'explore',
      item: {
        entries: [expect.objectContaining({ detail: 'Subagent' })],
      },
    })
  })
}

function registerDelegationSummaryTests() {
  it('uses a count-based delegating summary when multiple subagents are active', () => {
    const messages: ClaudeChatMessageItem[] = [{ id: 'thinking-1', kind: 'thinking', timestamp: 1 }]
    const subagents = [
      createSubagent('task-1', 'first task'),
      createSubagent('task-2', 'second task', 'awaiting_instruction'),
    ]

    const presentation = projectClaudeChatSessionPresentation(messages, true, subagents)
    expect(presentation.rows).toMatchObject([
      { kind: 'thinking', summary: 'Delegating: Waiting on 2 background agents' },
    ])
  })
}

function registerDiffAndToolProjectionTests() {
  it('keeps Claude diff items as changed-file rows in the projected timeline', () => {
    const messages: ClaudeChatMessageItem[] = [
      {
        id: 'diff-1',
        kind: 'diff',
        path: '/workspace/src/app.ts',
        type: 'modified',
        diff: '@@\n-old line\n+new line',
        insertions: 1,
        deletions: 1,
        timestamp: 1,
      },
    ]

    const presentation = projectClaudeChatSessionPresentation(messages, false, [])
    expect(presentation.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'diff-group',
          files: [expect.objectContaining({ path: '/workspace/src/app.ts' })],
        }),
      ])
    )
  })

  it('keeps delegated tool rows in the transcript with subagent labeling', () => {
    const messages: ClaudeChatMessageItem[] = [
      {
        id: 'tool-1',
        kind: 'tool',
        source: 'delegated',
        title: 'Bash',
        toolType: 'Bash',
        status: 'completed',
        command: 'pnpm exec vitest run src/app.test.ts',
        output: 'Tests passed',
        timestamp: 1,
      },
    ]

    const presentation = projectClaudeChatSessionPresentation(messages, false, [])
    expect(presentation.rows).toEqual([
      expect.objectContaining({
        kind: 'tool',
        title: 'Bash',
        subtitle: 'Subagent',
        command: 'pnpm exec vitest run src/app.test.ts',
      }),
    ])
  })
}

describe('projectClaudeChatSessionPresentation', () => {
  registerExploreProjectionTests()
  registerDelegationSummaryTests()
  registerDiffAndToolProjectionTests()
})
