import { describe, expect, it, vi } from 'vitest'
import { OpencodeService } from './opencode-service'
import {
  ProviderSessionDirectory,
  makeProviderRuntimeSessionKey,
} from './provider-session-directory'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Orxa Code Test',
    getPath: () => '/tmp/orxa-opencode-service-test',
  },
}))

describe('OpencodeService session runtime snapshots', () => {
  it('returns current messages without blocking on artifact sync', async () => {
    const service = Object.create(OpencodeService.prototype) as {
      getSessionRuntime: (
        directory: string,
        sessionID: string
      ) => Promise<{
        messages: unknown[]
        sessionDiff: unknown[]
        executionLedger: { cursor: number; records: unknown[] }
        changeProvenance: { cursor: number; records: unknown[] }
      }>
      ensureWorkspaceDirectory: (directory: string) => string
      client: (directory: string) => {
        session: {
          get: () => Promise<{ data: { id: string } }>
          status: () => Promise<{ data: Record<string, { type: string }> }>
          diff: () => Promise<{ data: unknown[] }>
        }
        permission: { list: () => Promise<{ data: unknown[] }> }
        question: { list: () => Promise<{ data: unknown[] }> }
        command: { list: () => Promise<{ data: unknown[] }> }
      }
      loadMessages: (directory: string, sessionID: string) => Promise<unknown[]>
      ledgerStore: {
        loadSnapshot: (
          directory: string,
          sessionID: string,
          cursor: number
        ) => Promise<{ cursor: number; records: unknown[] }>
      }
      provenanceIndex: {
        loadSnapshot: (
          directory: string,
          sessionID: string,
          cursor: number
        ) => Promise<{ cursor: number; records: unknown[] }>
      }
      syncSessionExecutionArtifacts: (directory: string, sessionID: string) => Promise<void>
      providerSessionDirectory: ProviderSessionDirectory | null
    }

    service.ensureWorkspaceDirectory = directory => directory
    service.client = () => ({
      session: {
        get: async () => ({ data: { id: 'session-1' } }),
        status: async () => ({ data: { 'session-1': { type: 'busy' } } }),
        diff: async () => ({
          data: [{ file: 'package.json', before: '', after: '{}', additions: 1, deletions: 0 }],
        }),
      },
      permission: { list: async () => ({ data: [] }) },
      question: { list: async () => ({ data: [] }) },
      command: { list: async () => ({ data: [] }) },
    })
    service.loadMessages = async () => [{ id: 'message-1' }]
    service.ledgerStore = {
      loadSnapshot: async () => ({ cursor: 1, records: [{ id: 'ledger-1' }] }),
    }
    service.provenanceIndex = {
      loadSnapshot: async () => ({ cursor: 1, records: [{ eventID: 'prov-1' }] }),
    }
    service.syncSessionExecutionArtifacts = vi.fn(() => new Promise<void>(() => undefined))
    service.providerSessionDirectory = new ProviderSessionDirectory()

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('getSessionRuntime timed out')), 100)
    })

    const runtime = await Promise.race([service.getSessionRuntime('/repo', 'session-1'), timeout])

    expect(runtime.messages).toEqual([{ id: 'message-1' }])
    expect(runtime.sessionDiff).toEqual([
      { file: 'package.json', before: '', after: '{}', additions: 1, deletions: 0 },
    ])
    expect(runtime.executionLedger.records).toEqual([{ id: 'ledger-1' }])
    expect(runtime.changeProvenance.records).toEqual([{ eventID: 'prov-1' }])
    expect(
      service.providerSessionDirectory.getBinding(
        makeProviderRuntimeSessionKey('opencode', '/repo', 'session-1'),
        'opencode'
      )
    ).toEqual(
      expect.objectContaining({
        resumeCursor: { sessionID: 'session-1', directory: '/repo' },
      })
    )
  })
})
