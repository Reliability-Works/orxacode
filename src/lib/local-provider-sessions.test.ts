import { describe, expect, it } from 'vitest'
import type { ProjectBootstrap } from '@shared/ipc'
import {
  markLocalProviderSessionRecordStarted,
  mergeLocalProviderSessions,
  pruneLocalProviderDraftSessions,
} from './local-provider-sessions'

function buildProject(sessions: ProjectBootstrap['sessions']): ProjectBootstrap {
  return {
    directory: '/repo/project',
    path: {} as never,
    sessions,
    sessionStatus: Object.fromEntries(sessions.map(session => [session.id, { type: 'idle' as const }])),
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {} as never,
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys: [],
  }
}

describe('mergeLocalProviderSessions', () => {
  it('does not duplicate provider sessions when metadata says they are claude chat but no synthetic record exists', () => {
    const now = Date.now()
    const project = buildProject([
      {
        id: 'session-1',
        projectID: 'proj-1',
        directory: '/repo/project',
        slug: 'opencode-session',
        title: 'OpenCode Session',
        version: '1',
        time: { created: now, updated: now },
      },
    ])

    const merged = mergeLocalProviderSessions(project, {})

    expect(merged.sessions).toHaveLength(1)
    expect(merged.sessions[0]?.id).toBe('session-1')
    expect(merged.sessions[0]?.title).toBe('OpenCode Session')
  })
})

describe('pruneLocalProviderDraftSessions', () => {
  it('keeps only the newest draft session of a provider type in the same workspace', () => {
    const result = pruneLocalProviderDraftSessions(
      {
        '/repo/project::claude-chat-1': {
          sessionID: 'claude-chat-1',
          directory: '/repo/project',
          type: 'claude-chat',
          title: 'Claude Code (Chat)',
          slug: 'claude-chat',
          createdAt: 1,
          updatedAt: 1,
          draft: true,
        },
        '/repo/project::claude-chat-2': {
          sessionID: 'claude-chat-2',
          directory: '/repo/project',
          type: 'claude-chat',
          title: 'Claude Code (Chat)',
          slug: 'claude-chat',
          createdAt: 2,
          updatedAt: 2,
          draft: true,
        },
        '/repo/project::codex-1': {
          sessionID: 'codex-1',
          directory: '/repo/project',
          type: 'codex',
          title: 'Codex Session',
          slug: 'codex',
          createdAt: 3,
          updatedAt: 3,
          draft: true,
        },
      },
      '/repo/project',
      'claude-chat',
      'claude-chat-2'
    )

    expect(result).toEqual({
      '/repo/project::claude-chat-2': expect.objectContaining({
        sessionID: 'claude-chat-2',
      }),
      '/repo/project::codex-1': expect.objectContaining({
        sessionID: 'codex-1',
      }),
    })
  })
})

describe('markLocalProviderSessionRecordStarted', () => {
  it('marks the active draft as started and removes older drafts of the same provider type', () => {
    const result = markLocalProviderSessionRecordStarted(
      {
        '/repo/project::claude-chat-1': {
          sessionID: 'claude-chat-1',
          directory: '/repo/project',
          type: 'claude-chat',
          title: 'Claude Code (Chat)',
          slug: 'claude-chat',
          createdAt: 1,
          updatedAt: 1,
          draft: true,
        },
        '/repo/project::claude-chat-2': {
          sessionID: 'claude-chat-2',
          directory: '/repo/project',
          type: 'claude-chat',
          title: 'Claude Code (Chat)',
          slug: 'claude-chat',
          createdAt: 2,
          updatedAt: 2,
          draft: true,
        },
      },
      '/repo/project',
      'claude-chat-2',
      10
    )

    expect(result).toEqual({
      '/repo/project::claude-chat-2': expect.objectContaining({
        sessionID: 'claude-chat-2',
        draft: false,
        updatedAt: 10,
      }),
    })
  })
})
