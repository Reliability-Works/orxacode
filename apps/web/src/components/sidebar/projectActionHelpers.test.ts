import { ProjectId } from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import { hasRemovableProjectBlockers } from './projectActionHelpers'

describe('hasRemovableProjectBlockers', () => {
  it('returns false when a project only has archived threads', () => {
    const projectId = ProjectId.makeUnsafe('project-1')

    expect(
      hasRemovableProjectBlockers(
        [
          {
            projectId,
            archivedAt: '2026-04-09T18:00:00.000Z',
          },
        ],
        projectId
      )
    ).toBe(false)
  })

  it('returns true when a project has at least one active thread', () => {
    const projectId = ProjectId.makeUnsafe('project-1')

    expect(
      hasRemovableProjectBlockers(
        [
          {
            projectId,
            archivedAt: null,
          },
        ],
        projectId
      )
    ).toBe(true)
  })
})
