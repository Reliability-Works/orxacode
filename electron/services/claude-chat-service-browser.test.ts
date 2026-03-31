/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ClaudeChatService } from './claude-chat-service'
import { ProviderSessionDirectory } from './provider-session-directory'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  renameSession: vi.fn(),
  tagSession: vi.fn(),
}))

async function writeClaudeProjectSessionFile(
  inventoryRoot: string,
  projectKey: string,
  sessionId: string,
  cwd: string,
  prompt: string,
  updatedAt = '2026-04-01T12:00:00.000Z'
) {
  const projectDir = path.join(inventoryRoot, projectKey)
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: updatedAt,
        sessionId,
      }),
      JSON.stringify({
        type: 'user',
        timestamp: updatedAt,
        cwd,
        sessionId,
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      }),
      JSON.stringify({
        type: 'last-prompt',
        timestamp: updatedAt,
        lastPrompt: prompt,
        sessionId,
      }),
    ].join('\n')
  )
}

describe('ClaudeChatService browser inventory', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'claude-browser-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  registerClaudeInventoryListingTests(() => tempDir)
  registerClaudeBrowserResumeTests(() => tempDir)
  registerClaudeBrowserStateTests(() => tempDir)
})

function registerClaudeInventoryListingTests(getTempDir: () => string) {
  it('lists provider Claude sessions from the project inventory and marks imported sessions', async () => {
    const providerThreadId = 'e3741bef-8b94-476f-b5fa-18e9d38a280a'
    await writeClaudeProjectSessionFile(
      getTempDir(),
      '-Users-callumspencer-Repos-webdesign-marketing-websites',
      providerThreadId,
      '/Users/callumspencer/Repos/webdesign/marketing-websites',
      'hi'
    )

    const bindings = new ProviderSessionDirectory()
    bindings.upsert({
      provider: 'claude-chat',
      sessionKey:
        '/Users/callumspencer/Repos/webdesign/marketing-websites::claude-chat-mn90g1lf-64b0200d',
      status: 'running',
      resumeCursor: { resume: providerThreadId },
      runtimePayload: {
        directory: '/Users/callumspencer/Repos/webdesign/marketing-websites',
      },
    })

    const service = new ClaudeChatService(bindings, getTempDir())
    await expect(service.listSessions()).resolves.toEqual([
      expect.objectContaining({
        providerThreadId,
        title: 'hi',
        cwd: '/Users/callumspencer/Repos/webdesign/marketing-websites',
        preview: 'hi',
        isArchived: false,
        importedSession: {
          sessionKey:
            '/Users/callumspencer/Repos/webdesign/marketing-websites::claude-chat-mn90g1lf-64b0200d',
          sessionID: 'claude-chat-mn90g1lf-64b0200d',
          directory: '/Users/callumspencer/Repos/webdesign/marketing-websites',
        },
      }),
    ])
  })
}

function registerClaudeBrowserResumeTests(getTempDir: () => string) {
  it('creates exactly one new bound local Claude session when resuming an unseen provider thread', async () => {
    const providerThreadId = 'session-from-provider'
    await writeClaudeProjectSessionFile(
      getTempDir(),
      '-Users-callumspencer-Repos-macapp-orxacode',
      providerThreadId,
      '/Users/callumspencer/Repos/macapp/orxacode',
      'Resume this Claude chat'
    )

    const bindings = new ProviderSessionDirectory()
    const service = new ClaudeChatService(bindings, getTempDir())

    await expect(
      service.resumeProviderSession(providerThreadId, '/Users/callumspencer/Repos/macapp/orxacode')
    ).resolves.toEqual({
      providerThreadId,
      sessionKey: `/Users/callumspencer/Repos/macapp/orxacode::${providerThreadId}`,
      sessionID: providerThreadId,
      directory: '/Users/callumspencer/Repos/macapp/orxacode',
      title: 'Resume this Claude chat',
    })

    expect(bindings.getBinding(`/Users/callumspencer/Repos/macapp/orxacode::${providerThreadId}`, 'claude-chat')).toEqual(
      expect.objectContaining({
        resumeCursor: { resume: providerThreadId },
        runtimePayload: { directory: '/Users/callumspencer/Repos/macapp/orxacode' },
      })
    )
  })

  it('reuses an existing imported Claude binding instead of duplicating it', async () => {
    const providerThreadId = 'session-existing'
    await writeClaudeProjectSessionFile(
      getTempDir(),
      '-Users-callumspencer-Repos-webdesign-marketing-websites',
      providerThreadId,
      '/Users/callumspencer/Repos/webdesign/marketing-websites',
      'Existing Claude session'
    )

    const bindings = new ProviderSessionDirectory()
    bindings.upsert({
      provider: 'claude-chat',
      sessionKey:
        '/Users/callumspencer/Repos/webdesign/marketing-websites::claude-chat-existing-local',
      status: 'running',
      resumeCursor: { resume: providerThreadId },
      runtimePayload: {
        directory: '/Users/callumspencer/Repos/webdesign/marketing-websites',
      },
    })
    const service = new ClaudeChatService(bindings, getTempDir())

    await expect(
      service.resumeProviderSession(providerThreadId, '/Users/callumspencer/Repos/mobile/forjex-mobile')
    ).resolves.toEqual({
      providerThreadId,
      sessionKey:
        '/Users/callumspencer/Repos/webdesign/marketing-websites::claude-chat-existing-local',
      sessionID: 'claude-chat-existing-local',
      directory: '/Users/callumspencer/Repos/webdesign/marketing-websites',
      title: 'Existing Claude session',
    })

    expect(bindings.list('claude-chat')).toHaveLength(1)
  })
}

function registerClaudeBrowserStateTests(getTempDir: () => string) {
  it('hydrates disconnected state from the provider binding so imported sessions can load history', async () => {
    const bindings = new ProviderSessionDirectory()
    bindings.upsert({
      provider: 'claude-chat',
      sessionKey: '/Users/callumspencer/Repos/macapp/orxacode::session-imported',
      status: 'running',
      resumeCursor: { resume: 'provider-thread-1' },
      runtimePayload: { directory: '/Users/callumspencer/Repos/macapp/orxacode' },
    })
    const service = new ClaudeChatService(bindings, getTempDir())

    expect(service.getState('/Users/callumspencer/Repos/macapp/orxacode::session-imported')).toEqual({
      sessionKey: '/Users/callumspencer/Repos/macapp/orxacode::session-imported',
      status: 'disconnected',
      providerThreadId: 'provider-thread-1',
    })
  })
}
