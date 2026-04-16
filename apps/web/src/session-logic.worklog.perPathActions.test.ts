import { TurnId, type OrchestrationThreadActivity } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { deriveWorkLogEntries } from './session-logic'
import { makeActivity } from './session-logic.test.helpers'

function fileChange(id: string, createdAt: string, paths: ReadonlyArray<string>, turnId?: string) {
  return makeActivity({
    id,
    createdAt,
    kind: 'tool.completed',
    summary: 'File change',
    tone: 'tool',
    ...(turnId ? { turnId } : {}),
    payload: {
      itemType: 'file_change',
      action: 'create',
      data: {
        item: {
          changes: paths.map(path => ({ path })),
        },
      },
    },
  })
}

function fileDelete(id: string, createdAt: string, paths: ReadonlyArray<string>) {
  return makeActivity({
    id,
    createdAt,
    kind: 'tool.completed',
    summary: 'File change',
    tone: 'tool',
    payload: {
      itemType: 'file_change',
      action: 'delete',
      data: {
        item: {
          changes: paths.map(path => ({ path })),
        },
      },
    },
  })
}

describe('deriveWorkLogEntries per-path action annotation', () => {
  it('marks writes as edit across entries', () => {
    const activities: OrchestrationThreadActivity[] = [
      fileChange('w-1', '2026-03-17T10:00:01.000Z', ['a.txt']),
      fileChange('w-2', '2026-03-17T10:00:02.000Z', ['a.txt']),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries[0]?.perPathActions).toEqual({ 'a.txt': 'edit' })
    expect(entries[1]?.perPathActions).toEqual({ 'a.txt': 'edit' })
  })

  it('annotates a multi-path write entry with per-path actions', () => {
    const activities: OrchestrationThreadActivity[] = [
      fileChange('w-1', '2026-03-17T10:00:01.000Z', ['a.txt', 'b.txt']),
      fileChange('w-2', '2026-03-17T10:00:02.000Z', ['a.txt', 'c.txt']),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries[1]?.perPathActions).toEqual({ 'a.txt': 'edit', 'c.txt': 'edit' })
  })

  it('delete preserves delete action and writes remain edit', () => {
    const activities: OrchestrationThreadActivity[] = [
      fileChange('w-1', '2026-03-17T10:00:01.000Z', ['a.txt']),
      fileDelete('w-2', '2026-03-17T10:00:02.000Z', ['a.txt']),
      fileChange('w-3', '2026-03-17T10:00:03.000Z', ['a.txt']),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries[0]?.perPathActions).toEqual({ 'a.txt': 'edit' })
    expect(entries[1]?.perPathActions).toEqual({ 'a.txt': 'delete' })
    expect(entries[2]?.perPathActions).toEqual({ 'a.txt': 'edit' })
  })

  it('omits perPathActions for non-file actions', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'cmd',
        kind: 'tool.completed',
        summary: 'Ran command',
        tone: 'tool',
        payload: {
          itemType: 'command_execution',
          action: 'command',
          data: { item: { command: ['ls'] } },
        },
      }),
    ]

    const entries = deriveWorkLogEntries(activities, undefined)
    expect(entries[0]?.perPathActions).toBeUndefined()
  })
})

describe('deriveWorkLogEntries cross-turn and bash extraction', () => {
  it('treats a write to a file created in a prior turn as edit', () => {
    const activities: OrchestrationThreadActivity[] = [
      fileChange('w-prior', '2026-03-17T10:00:01.000Z', ['a.txt'], 'turn-1'),
      fileChange('w-current', '2026-03-17T10:01:01.000Z', ['a.txt'], 'turn-2'),
    ]

    const entries = deriveWorkLogEntries(activities, TurnId.makeUnsafe('turn-2'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.perPathActions).toEqual({ 'a.txt': 'edit' })
  })

  it('extracts Claude bash command from data.input.command and derives changed files', () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: 'claude-rm',
        kind: 'tool.completed',
        summary: 'Ran command',
        tone: 'tool',
        payload: {
          itemType: 'command_execution',
          title: 'Bash',
          action: 'delete',
          data: {
            toolName: 'Bash',
            input: { command: 'rm claude-test-2.txt claude-test-3.txt' },
          },
        },
      }),
    ]

    const [entry] = deriveWorkLogEntries(activities, undefined)
    expect(entry?.command).toBe('rm claude-test-2.txt claude-test-3.txt')
    expect(entry?.changedFiles).toEqual(['claude-test-2.txt', 'claude-test-3.txt'])
  })
})
