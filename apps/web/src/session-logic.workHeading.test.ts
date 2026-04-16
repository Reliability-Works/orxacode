import { describe, expect, it } from 'vitest'

import type { WorkLogEntry } from './session-logic.activity'
import { synthesizeWorkGroupHeading } from './session-logic.workHeading'

function makeEntry(partial: Partial<WorkLogEntry> & Pick<WorkLogEntry, 'tone'>): WorkLogEntry {
  return {
    id: partial.id ?? 'work-1',
    createdAt: partial.createdAt ?? '2026-03-17T19:12:28.000Z',
    label: partial.label ?? 'Tool',
    tone: partial.tone,
    ...(partial.detail !== undefined ? { detail: partial.detail } : {}),
    ...(partial.command !== undefined ? { command: partial.command } : {}),
    ...(partial.changedFiles !== undefined ? { changedFiles: partial.changedFiles } : {}),
    ...(partial.toolTitle !== undefined ? { toolTitle: partial.toolTitle } : {}),
    ...(partial.itemType !== undefined ? { itemType: partial.itemType } : {}),
    ...(partial.requestKind !== undefined ? { requestKind: partial.requestKind } : {}),
    ...(partial.action !== undefined ? { action: partial.action } : {}),
  }
}

describe('synthesizeWorkGroupHeading', () => {
  it('returns Work log when every entry is info-toned', () => {
    expect(
      synthesizeWorkGroupHeading([makeEntry({ tone: 'info', label: 'Context compacted' })])
    ).toBe('Work log')
  })

  it('pluralizes a single action with a count', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({ tone: 'tool', action: 'edit' }),
        makeEntry({ tone: 'tool', action: 'edit' }),
      ])
    ).toBe('Edited 2 files')
  })

  it('joins multiple actions with the documented verb/noun table', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({ tone: 'tool', action: 'create' }),
        makeEntry({ tone: 'tool', action: 'edit' }),
        makeEntry({ tone: 'tool', action: 'edit' }),
        makeEntry({ tone: 'tool', action: 'command' }),
      ])
    ).toBe('Edited 3 files, Ran 1 command')
  })

  it('uses search verb Explored and the time/times noun', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({ tone: 'tool', action: 'search' }),
        makeEntry({ tone: 'tool', action: 'search' }),
        makeEntry({ tone: 'tool', action: 'search' }),
      ])
    ).toBe('Explored 3 times')
  })

  it('falls back to Tool calls when there is no classifiable action', () => {
    expect(synthesizeWorkGroupHeading([makeEntry({ tone: 'tool' })])).toBe('Used 1 tool')
  })
})

describe('synthesizeWorkGroupHeading path counting', () => {
  it('counts changedFiles.length for file actions so one bundled entry reflects all files', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({
          tone: 'tool',
          action: 'edit',
          changedFiles: ['a.txt', 'b.txt', 'c.txt'],
        }),
      ])
    ).toBe('Edited 3 files')
  })

  it('collapses writes to the edit bucket regardless of path repetition', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({ id: 'w-1', tone: 'tool', action: 'create', changedFiles: ['a.txt'] }),
        makeEntry({ id: 'w-2', tone: 'tool', action: 'create', changedFiles: ['b.txt'] }),
        makeEntry({ id: 'w-3', tone: 'tool', action: 'create', changedFiles: ['c.txt'] }),
        makeEntry({ id: 'w-4', tone: 'tool', action: 'create', changedFiles: ['a.txt'] }),
      ])
    ).toBe('Edited 4 files')
  })

  it('counts multiple files deleted by a single rm command', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({
          tone: 'tool',
          action: 'delete',
          command: 'rm a.txt b.txt',
          changedFiles: ['a.txt', 'b.txt'],
        }),
      ])
    ).toBe('Deleted 2 files')
  })

  it('treats recreate after delete as another edit', () => {
    expect(
      synthesizeWorkGroupHeading([
        makeEntry({ id: 'w-1', tone: 'tool', action: 'create', changedFiles: ['a.txt'] }),
        makeEntry({ id: 'w-2', tone: 'tool', action: 'delete', changedFiles: ['a.txt'] }),
        makeEntry({ id: 'w-3', tone: 'tool', action: 'create', changedFiles: ['a.txt'] }),
      ])
    ).toBe('Edited 2 files, Deleted 1 file')
  })
})
