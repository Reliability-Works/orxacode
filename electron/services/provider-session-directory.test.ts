/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistenceService } from './persistence-service'
import { ProviderSessionDirectory } from './provider-session-directory'

const tempDirs: string[] = []

async function createDirectory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orxa-provider-runtime-'))
  tempDirs.push(dir)
  const persistence = new PersistenceService(path.join(dir, 'state.sqlite'))
  return {
    persistence,
    directory: new ProviderSessionDirectory(persistence),
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('ProviderSessionDirectory', () => {
  it('persists and reloads bindings', async () => {
    const { directory } = await createDirectory()

    directory.upsert({
      provider: 'claude-chat',
      sessionKey: 'claude::1',
      status: 'running',
      resumeCursor: { resume: 'thread-1' },
      runtimePayload: { directory: '/workspace' },
    })

    expect(directory.getBinding('claude::1', 'claude-chat')).toEqual(
      expect.objectContaining({
        provider: 'claude-chat',
        sessionKey: 'claude::1',
        status: 'running',
        resumeCursor: { resume: 'thread-1' },
        runtimePayload: { directory: '/workspace' },
      })
    )
  })

  it('merges runtime payload across upserts', async () => {
    const { directory } = await createDirectory()

    directory.upsert({
      provider: 'codex',
      sessionKey: 'codex::1',
      runtimePayload: { directory: '/workspace', model: 'gpt-5.4' },
    })
    directory.upsert({
      provider: 'codex',
      sessionKey: 'codex::1',
      runtimePayload: { collaborationMode: 'default' },
    })

    expect(directory.getBinding('codex::1', 'codex')).toEqual(
      expect.objectContaining({
        runtimePayload: {
          directory: '/workspace',
          model: 'gpt-5.4',
          collaborationMode: 'default',
        },
      })
    )
  })

  it('ignores wrong-provider lookups and removes exact provider matches', async () => {
    const { directory, persistence } = await createDirectory()

    directory.upsert({
      provider: 'opencode',
      sessionKey: 'opencode::1',
      resumeCursor: { sessionID: 'sess-1', directory: '/workspace' },
    })

    expect(directory.getBinding('opencode::1', 'claude-chat')).toBeNull()
    directory.remove('opencode::1', 'claude-chat')
    expect(directory.getBinding('opencode::1', 'opencode')).not.toBeNull()

    directory.remove('opencode::1', 'opencode')
    expect(directory.getBinding('opencode::1', 'opencode')).toBeNull()

    persistence.setValue(
      'provider-runtime:v1',
      'shared-key',
      JSON.stringify({
        provider: 'claude-chat',
        sessionKey: 'shared-key',
        status: 'running',
        resumeCursor: { resume: 'claude-thread' },
        runtimePayload: { stale: true },
        updatedAt: new Date().toISOString(),
      })
    )

    const updated = directory.upsert({
      provider: 'codex',
      sessionKey: 'shared-key',
      resumeCursor: { threadId: 'codex-thread' },
      runtimePayload: { directory: '/workspace' },
    })

    expect(updated).toEqual(
      expect.objectContaining({
        provider: 'codex',
        resumeCursor: { threadId: 'codex-thread' },
        runtimePayload: { directory: '/workspace' },
      })
    )
  })
})
