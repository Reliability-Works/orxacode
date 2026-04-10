import type { OrchestrationThreadActivity } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveWorkLogEntries } from './session-logic'
import { makeActivity } from './session-logic.test.helpers'

describe('deriveWorkLogEntries subagent lifecycle handling', () => {
  it('keeps subagent tool started entries so delegation appears immediately', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'subagent-start',
        createdAt: '2026-02-23T00:00:01.000Z',
        summary: 'Delegating to Explore',
        kind: 'tool.started',
        payload: {
          itemType: 'collab_agent_tool_call',
        },
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries.map(entry => entry.id)).toEqual(['subagent-start'])
  })

  it('collapses subagent start and completion into one work-log row', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'subagent-start',
        createdAt: '2026-02-23T00:00:01.000Z',
        summary: 'Delegating to Explore',
        kind: 'tool.started',
        payload: {
          itemType: 'collab_agent_tool_call',
          detail: 'Inspect provider routing with the Explore subagent.',
          data: {
            input: {
              subagent_type: 'Explore',
              prompt: 'Audit the provider routing code and summarize one risk.',
              description: 'Inspect provider routing with the Explore subagent.',
            },
          },
        },
      }),
      makeActivity({
        id: 'subagent-complete',
        createdAt: '2026-02-23T00:00:02.000Z',
        summary: 'Delegated to Explore',
        kind: 'tool.completed',
        payload: {
          itemType: 'collab_agent_tool_call',
          detail: 'Inspect provider routing with the Explore subagent.',
          data: {
            input: {
              subagent_type: 'Explore',
              prompt: 'Audit the provider routing code and summarize one risk.',
              description: 'Inspect provider routing with the Explore subagent.',
            },
          },
        },
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('subagent-complete')
    expect(entries[0]?.label).toBe('Delegated to Explore')
  })
})
