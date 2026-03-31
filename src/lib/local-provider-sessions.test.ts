import { describe, expect, it } from 'vitest'
import type { ProjectBootstrap } from '@shared/ipc'
import { mergeLocalProviderSessions } from './local-provider-sessions'

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
