import { describe, expect, it } from 'vitest'
import type { ProjectId } from '@orxa-code/contracts'
import { resolveNewSessionProjectId } from './NewSessionModal.logic'

function makeProjectId(value: string): ProjectId {
  return value as ProjectId
}

describe('resolveNewSessionProjectId', () => {
  it('prefers an explicit modal project over active and default projects', () => {
    expect(
      resolveNewSessionProjectId({
        projectId: makeProjectId('project_orxacode'),
        activeThreadProjectId: makeProjectId('project_opencode'),
        activeDraftThreadProjectId: makeProjectId('project_draft'),
        defaultProjectId: makeProjectId('project_default'),
      })
    ).toBe('project_orxacode')
  })

  it('falls back through active thread, active draft, then default project', () => {
    expect(
      resolveNewSessionProjectId({
        activeThreadProjectId: makeProjectId('project_active'),
        activeDraftThreadProjectId: makeProjectId('project_draft'),
        defaultProjectId: makeProjectId('project_default'),
      })
    ).toBe('project_active')

    expect(
      resolveNewSessionProjectId({
        activeDraftThreadProjectId: makeProjectId('project_draft'),
        defaultProjectId: makeProjectId('project_default'),
      })
    ).toBe('project_draft')

    expect(
      resolveNewSessionProjectId({
        defaultProjectId: makeProjectId('project_default'),
      })
    ).toBe('project_default')
  })

  it('returns null when no project can be resolved', () => {
    expect(resolveNewSessionProjectId({})).toBeNull()
  })
})
