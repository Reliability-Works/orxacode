import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { CodexAppServerManager } from './codexAppServerManager'
import { asThreadId } from './codexAppServerManager.test.helpers'

it('emits session/startFailed when resolving cwd throws before process launch', async () => {
  const manager = new CodexAppServerManager()
  const events: Array<{ method: string; kind: string; message?: string }> = []
  manager.on('event', event => {
    events.push({
      method: event.method,
      kind: event.kind,
      ...(event.message ? { message: event.message } : {}),
    })
  })

  const processCwd = vi.spyOn(process, 'cwd').mockImplementation(() => {
    throw new Error('cwd missing')
  })
  try {
    await expect(
      manager.startSession({
        threadId: asThreadId('thread-1'),
        provider: 'codex',
        binaryPath: 'codex',
        runtimeMode: 'full-access',
      })
    ).rejects.toThrow('cwd missing')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      method: 'session/startFailed',
      kind: 'error',
      message: 'cwd missing',
    })
  } finally {
    processCwd.mockRestore()
    manager.stopAll()
  }
})

it('fails fast with an upgrade message when codex is below the minimum supported version', async () => {
  const manager = new CodexAppServerManager()
  const events: Array<{ method: string; kind: string; message?: string }> = []
  manager.on('event', event => {
    events.push({
      method: event.method,
      kind: event.kind,
      ...(event.message ? { message: event.message } : {}),
    })
  })

  const versionCheck = vi
    .spyOn(
      manager as unknown as {
        assertSupportedCodexCliVersion: (input: {
          binaryPath: string
          cwd: string
          homePath?: string
        }) => void
      },
      'assertSupportedCodexCliVersion'
    )
    .mockImplementation(() => {
      throw new Error(
        'Codex CLI v0.36.0 is too old for Orxa Code. Upgrade to v0.37.0 or newer and restart Orxa Code.'
      )
    })

  try {
    await expect(
      manager.startSession({
        threadId: asThreadId('thread-1'),
        provider: 'codex',
        binaryPath: 'codex',
        runtimeMode: 'full-access',
      })
    ).rejects.toThrow(
      'Codex CLI v0.36.0 is too old for Orxa Code. Upgrade to v0.37.0 or newer and restart Orxa Code.'
    )
    expect(versionCheck).toHaveBeenCalledTimes(1)
    expect(events).toEqual([
      {
        method: 'session/startFailed',
        kind: 'error',
        message:
          'Codex CLI v0.36.0 is too old for Orxa Code. Upgrade to v0.37.0 or newer and restart Orxa Code.',
      },
    ])
  } finally {
    versionCheck.mockRestore()
    manager.stopAll()
  }
})

describe.skipIf(!process.env.CODEX_BINARY_PATH)('startSession live Codex resume', () => {
  it('keeps prior thread history when resuming with a changed runtime mode', async () => {
    const workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'codex-live-resume-'))
    writeFileSync(path.join(workspaceDir, 'README.md'), 'hello\n', 'utf8')

    const manager = new CodexAppServerManager()

    try {
      const firstSession = await manager.startSession({
        threadId: asThreadId('thread-live'),
        provider: 'codex',
        cwd: workspaceDir,
        runtimeMode: 'full-access',
        binaryPath: process.env.CODEX_BINARY_PATH!,
        ...(process.env.CODEX_HOME_PATH ? { homePath: process.env.CODEX_HOME_PATH } : {}),
      })

      const firstTurn = await manager.sendTurn({
        threadId: firstSession.threadId,
        input: `Reply with exactly the word ALPHA ${randomUUID()}`,
      })

      expect(firstTurn.threadId).toBe(firstSession.threadId)

      await vi.waitFor(
        async () => {
          const snapshot = await manager.readThread(firstSession.threadId)
          expect(snapshot.turns.length).toBeGreaterThan(0)
        },
        { timeout: 120_000, interval: 1_000 }
      )

      const firstSnapshot = await manager.readThread(firstSession.threadId)
      const originalThreadId = firstSnapshot.threadId
      const originalTurnCount = firstSnapshot.turns.length

      manager.stopSession(firstSession.threadId)

      const resumedSession = await manager.startSession({
        threadId: firstSession.threadId,
        provider: 'codex',
        cwd: workspaceDir,
        runtimeMode: 'approval-required',
        resumeCursor: firstSession.resumeCursor,
        binaryPath: process.env.CODEX_BINARY_PATH!,
        ...(process.env.CODEX_HOME_PATH ? { homePath: process.env.CODEX_HOME_PATH } : {}),
      })

      expect(resumedSession.threadId).toBe(originalThreadId)

      const resumedSnapshotBeforeTurn = await manager.readThread(resumedSession.threadId)
      expect(resumedSnapshotBeforeTurn.threadId).toBe(originalThreadId)
      expect(resumedSnapshotBeforeTurn.turns.length).toBeGreaterThanOrEqual(originalTurnCount)

      await manager.sendTurn({
        threadId: resumedSession.threadId,
        input: `Reply with exactly the word BETA ${randomUUID()}`,
      })

      await vi.waitFor(
        async () => {
          const snapshot = await manager.readThread(resumedSession.threadId)
          expect(snapshot.turns.length).toBeGreaterThan(originalTurnCount)
        },
        { timeout: 120_000, interval: 1_000 }
      )
    } finally {
      manager.stopAll()
      rmSync(workspaceDir, { recursive: true, force: true })
    }
  }, 180_000)
})
