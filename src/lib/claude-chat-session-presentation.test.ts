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

describe('projectClaudeChatSessionPresentation', () => {
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

  it('renders Claude delegating after the active assistant message and hides delegated explore rows', () => {
    const messages: ClaudeChatMessageItem[] = [
      { id: 'thinking-1', kind: 'thinking', timestamp: 1 },
      { id: 'assistant-1', kind: 'message', role: 'assistant', content: 'Let me investigate this.', timestamp: 2 },
      createExploreMessage('explore-1', 'exploring', 'delegated', [
        { id: 'entry-1', kind: 'search', label: 'Find desk files', status: 'running' },
      ]),
    ]
    const subagents = [createSubagent('task-1', 'runtime asset cache invalidation')]

    const presentation = projectClaudeChatSessionPresentation(messages, true, subagents)
    expect(presentation.rows.map(row => row.kind)).toEqual(['message', 'thinking'])
    expect(presentation.rows[1]).toMatchObject({
      kind: 'thinking',
      summary: 'Delegating: Waiting on runtime asset cache invalidation',
    })
  })

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
})
