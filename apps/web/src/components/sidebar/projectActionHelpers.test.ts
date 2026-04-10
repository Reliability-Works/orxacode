import { ProjectId } from '@orxa-code/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as nativeApi from '../../nativeApi'
import { execAddProjectFromPath, hasRemovableProjectBlockers } from './projectActionHelpers'

afterEach(() => {
  nativeApi.resetNativeApiForTests()
  vi.restoreAllMocks()
})

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

describe('execAddProjectFromPath', () => {
  it('creates the project without opening any project navigation callback', async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(nativeApi, 'readNativeApi').mockReturnValue({
      orchestration: { dispatchCommand },
    } as unknown as ReturnType<typeof nativeApi.readNativeApi>)

    const focusMostRecentThreadForProject = vi.fn()
    const setIsAddingProject = vi.fn()
    const setNewCwd = vi.fn()
    const setAddProjectError = vi.fn()
    const setAddingProject = vi.fn()

    await execAddProjectFromPath({
      rawCwd: '/tmp/demo-project',
      isAddingProject: false,
      projects: [],
      shouldBrowseForProjectImmediately: false,
      focusMostRecentThreadForProject,
      setIsAddingProject,
      setNewCwd,
      setAddProjectError,
      setAddingProject,
    })

    expect(dispatchCommand).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project.create',
        title: 'demo-project',
        workspaceRoot: '/tmp/demo-project',
      })
    )
    expect(focusMostRecentThreadForProject).not.toHaveBeenCalled()
    expect(setIsAddingProject).toHaveBeenNthCalledWith(1, true)
    expect(setIsAddingProject).toHaveBeenLastCalledWith(false)
    expect(setNewCwd).toHaveBeenCalledWith('')
    expect(setAddProjectError).toHaveBeenCalledWith(null)
    expect(setAddingProject).toHaveBeenCalledWith(false)
  })
})
