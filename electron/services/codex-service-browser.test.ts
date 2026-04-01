/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import { CodexService } from './codex-service'
import {
  makeProviderRuntimeSessionKey,
  ProviderSessionDirectory,
} from './provider-session-directory'

function createCodexBrowserService(bindings = new ProviderSessionDirectory()) {
  const service = new CodexService(bindings)
  const ensureConnected = vi.fn(async () => undefined)
  const request = vi.fn(async (method: string, params?: { threadId?: string }) => {
    if (method === 'thread/list') {
      return {
        threads: [
          {
            id: 'thread-imported',
            preview: 'Imported Codex Thread',
            createdAt: 1_710_000_000_000,
            cwd: '/repo/imported',
          },
          {
            id: 'thread-fresh',
            preview: 'Fresh Codex Thread',
            createdAt: 1_710_000_100_000,
            cwd: '/repo/fresh',
          },
        ],
      }
    }
    if (method === 'thread/resume') {
      return {
        thread: { id: params?.threadId ?? 'thread-fresh' },
        model: 'gpt-5.4',
      }
    }
    return {}
  })

  Object.assign(service as unknown as Record<string, unknown>, {
    ensureConnected,
    request,
  })

  return { service, bindings, ensureConnected, request }
}

describe('CodexService browser inventory', () => {
  it('lists provider Codex threads and marks imported sessions', async () => {
    const bindings = new ProviderSessionDirectory()
    bindings.upsert({
      provider: 'codex',
      sessionKey: makeProviderRuntimeSessionKey('codex', '/repo/imported', 'thread-imported'),
      status: 'running',
      resumeCursor: { threadId: 'thread-imported' },
      runtimePayload: { directory: '/repo/imported' },
    })

    const { service } = createCodexBrowserService(bindings)

    await expect(service.listBrowserThreads()).resolves.toEqual([
      {
        threadId: 'thread-fresh',
        title: 'Fresh Codex Thread',
        preview: 'Fresh Codex Thread',
        cwd: '/repo/fresh',
        lastUpdatedAt: 1_710_000_100_000,
        isArchived: false,
      },
      {
        threadId: 'thread-imported',
        title: 'Imported Codex Thread',
        preview: 'Imported Codex Thread',
        cwd: '/repo/imported',
        lastUpdatedAt: 1_710_000_000_000,
        isArchived: false,
        importedSession: {
          sessionKey: makeProviderRuntimeSessionKey('codex', '/repo/imported', 'thread-imported'),
          sessionID: 'thread-imported',
          directory: '/repo/imported',
        },
      },
    ])
  })

  it('creates one bound local Codex session when importing an unseen provider thread', async () => {
    const { service, bindings } = createCodexBrowserService()

    await expect(service.resumeProviderThread('thread-fresh', '/repo/fresh')).resolves.toEqual({
      threadId: 'thread-fresh',
      sessionKey: makeProviderRuntimeSessionKey('codex', '/repo/fresh', 'thread-fresh'),
      sessionID: 'thread-fresh',
      directory: '/repo/fresh',
      title: 'Fresh Codex Thread',
    })

    expect(
      bindings.getBinding(makeProviderRuntimeSessionKey('codex', '/repo/fresh', 'thread-fresh'), 'codex')
    ).toEqual(
      expect.objectContaining({
        resumeCursor: { threadId: 'thread-fresh' },
        runtimePayload: expect.objectContaining({ directory: '/repo/fresh' }),
      })
    )
  })

  it('reuses an existing imported Codex binding instead of duplicating it', async () => {
    const bindings = new ProviderSessionDirectory()
    bindings.upsert({
      provider: 'codex',
      sessionKey: makeProviderRuntimeSessionKey('codex', '/repo/imported', 'thread-imported'),
      status: 'running',
      resumeCursor: { threadId: 'thread-imported' },
      runtimePayload: { directory: '/repo/imported' },
    })
    const { service, request } = createCodexBrowserService(bindings)

    await expect(
      service.resumeProviderThread('thread-imported', '/repo/other')
    ).resolves.toEqual({
      threadId: 'thread-imported',
      sessionKey: makeProviderRuntimeSessionKey('codex', '/repo/imported', 'thread-imported'),
      sessionID: 'thread-imported',
      directory: '/repo/imported',
      title: 'Imported Codex Thread',
    })

    expect(bindings.list('codex')).toHaveLength(1)
    expect(request).not.toHaveBeenCalledWith('thread/resume', expect.anything())
  })
})
