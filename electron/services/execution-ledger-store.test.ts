/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionLedgerStore } from './execution-ledger-store'
import type { ExecutionEventRecord } from '../../shared/ipc'

let tempUserDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => tempUserDataDir,
  },
}))

describe('ExecutionLedgerStore', () => {
  beforeEach(() => {
    tempUserDataDir = `/tmp/orxa-ledger-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
  })

  it('stores snapshot records and supports cursor paging', async () => {
    const store = new ExecutionLedgerStore()
    const records: ExecutionEventRecord[] = [
      {
        id: 'evt-1',
        directory: '/repo',
        sessionID: 's1',
        timestamp: 1,
        kind: 'read',
        summary: 'Read src/app.ts',
        actor: { type: 'main', name: 'Main agent' },
      },
      {
        id: 'evt-2',
        directory: '/repo',
        sessionID: 's1',
        timestamp: 2,
        kind: 'edit',
        summary: 'Edited src/app.ts',
        actor: { type: 'main', name: 'Main agent' },
      },
    ]

    await store.appendMany('/repo', 's1', records)
    const first = await store.loadSnapshot('/repo', 's1', 0)
    expect(first.cursor).toBe(2)
    expect(first.records.map(item => item.id)).toEqual(['evt-1', 'evt-2'])

    const second = await store.loadSnapshot('/repo', 's1', 1)
    expect(second.records.map(item => item.id)).toEqual(['evt-2'])
  })
})
