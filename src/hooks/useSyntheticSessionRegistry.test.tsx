import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectBootstrap } from '@shared/ipc'
import { createLocalProviderSessionRecord } from '../lib/local-provider-sessions'
import { useSyntheticSessionRegistry } from './useSyntheticSessionRegistry'

function buildProject(
  directory: string,
  sessions: ProjectBootstrap['sessions'] = []
): ProjectBootstrap {
  return {
    directory,
    path: {} as never,
    sessions,
    sessionStatus: Object.fromEntries(
      sessions.map(session => [session.id, { type: 'idle' as const }])
    ),
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

describe('useSyntheticSessionRegistry', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('uses the latest synthetic session map when merging project data from a previously captured callback', () => {
    const directory = '/repo/marketing-websites'
    const setProjectDataForDirectory = vi.fn()

    const { result } = renderHook(() =>
      useSyntheticSessionRegistry({
        clearSyntheticSessionMetadata: vi.fn(),
        getStoredSessionType: () => undefined,
        setProjectDataForDirectory,
        setSessionTitles: vi.fn(),
        setSessionTypes: vi.fn(),
        setWorkspaceMeta: vi.fn(),
      })
    )

    const initialMerge = result.current.mergeProjectDataWithSyntheticSessions

    const syntheticRecord = createLocalProviderSessionRecord(directory, 'opencode', 'OpenCode Session', {
      draft: true,
    })

    act(() => {
      result.current.registerSyntheticSession(syntheticRecord)
    })

    act(() => {
      result.current.removeSyntheticSession(directory, syntheticRecord.sessionID)
    })

    const merged = initialMerge(
      buildProject(directory, [
        {
          id: 'ses-real',
          projectID: 'proj-1',
          directory,
          slug: 'hello',
          title: 'hi',
          version: '1',
          time: { created: Date.now(), updated: Date.now() },
        },
      ])
    )

    expect(merged).toMatchObject({
      directory,
      sessions: [expect.objectContaining({ id: 'ses-real', title: 'hi' })],
    })
    expect(merged.sessions).toHaveLength(1)
  })
})
