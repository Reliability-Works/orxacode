import { describe, expect, it } from 'vitest'
import {
  groupLedgerByTurn,
  kindToTimelineVerb,
  normalizeLedgerPath,
  toTimelineLabel,
} from './execution-ledger'
import type { ExecutionEventRecord } from '@shared/ipc'

describe('execution-ledger helpers', () => {
  it('maps event kinds to user-facing verbs', () => {
    expect(kindToTimelineVerb('read')).toBe('Read')
    expect(kindToTimelineVerb('search')).toBe('Searched')
    expect(kindToTimelineVerb('edit')).toBe('Edited')
    expect(kindToTimelineVerb('create')).toBe('Created')
    expect(kindToTimelineVerb('delete')).toBe('Deleted')
    expect(kindToTimelineVerb('delegate')).toBe('Delegated')
    expect(kindToTimelineVerb('todo')).toBe('Ran')
    expect(kindToTimelineVerb('git')).toBe('Checked git')
  })

  it('normalizes workspace-relative paths', () => {
    expect(normalizeLedgerPath('/repo/src/app.ts', '/repo')).toBe('src/app.ts')
    expect(normalizeLedgerPath('/repo', '/repo')).toBe('.')
    expect(normalizeLedgerPath('C:\\repo\\src\\file.ts', 'C:\\repo')).toBe('src/file.ts')
    expect(normalizeLedgerPath('/other/file.ts', '/repo')).toBe('/other/file.ts')
    expect(normalizeLedgerPath('/repo/src/app.ts', undefined)).toBe('/repo/src/app.ts')
  })

  it('groups records deterministically by turn id', () => {
    const records: ExecutionEventRecord[] = [
      {
        id: 'b',
        directory: '/repo',
        sessionID: 's1',
        timestamp: 2,
        kind: 'edit',
        summary: 'Edited src/a.ts',
        actor: { type: 'main', name: 'Main agent' },
        turnID: 'turn-1',
      },
      {
        id: 'a',
        directory: '/repo',
        sessionID: 's1',
        timestamp: 1,
        kind: 'read',
        summary: 'Read src/a.ts',
        actor: { type: 'main', name: 'Main agent' },
        turnID: 'turn-1',
      },
    ]

    const grouped = groupLedgerByTurn(records)
    expect(grouped.get('turn-1')?.map(item => item.id)).toEqual(['a', 'b'])
    expect(toTimelineLabel(records[0]!)).toContain('Edited')
  })

  it('uses summary as fallback label and preserves delegated summaries', () => {
    const delegated: ExecutionEventRecord = {
      id: 'd1',
      directory: '/repo',
      sessionID: 's1',
      timestamp: 1,
      kind: 'delegate',
      summary: 'Delegated to build agent',
      actor: { type: 'main' },
      paths: ['src/app.tsx'],
    }
    const withDotPath: ExecutionEventRecord = {
      id: 'r1',
      directory: '/repo',
      sessionID: 's1',
      timestamp: 2,
      kind: 'read',
      summary: 'Read workspace root',
      actor: { type: 'main' },
      paths: ['.'],
    }
    const noSummary: ExecutionEventRecord = {
      id: 'x1',
      directory: '/repo',
      sessionID: 's1',
      timestamp: 3,
      kind: 'run',
      summary: '',
      actor: { type: 'main' },
    }

    expect(toTimelineLabel(delegated)).toBe('Delegated to build agent')
    expect(toTimelineLabel(withDotPath)).toBe('Read workspace root')
    expect(toTimelineLabel(noSummary)).toBe('Ran')
  })

  it('groups unknown turns under a stable bucket', () => {
    const grouped = groupLedgerByTurn([
      {
        id: 'u1',
        directory: '/repo',
        sessionID: 's1',
        timestamp: 10,
        kind: 'run',
        summary: 'Ran command',
        actor: { type: 'main' },
      },
    ] as ExecutionEventRecord[])

    expect(grouped.get('unknown')?.length).toBe(1)
  })
})
