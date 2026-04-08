import { ProjectId } from '@orxa-code/contracts'
import { type Project } from '../types'
import { createMakeThread } from '../test-helpers/makeThreadFixture'

export function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, ...rest } = overrides
  return {
    id: ProjectId.makeUnsafe('project-1'),
    name: 'Project',
    cwd: '/tmp/project',
    defaultModelSelection: {
      provider: 'codex',
      model: 'gpt-5.4',
      ...defaultModelSelection,
    },
    createdAt: '2026-03-09T10:00:00.000Z',
    updatedAt: '2026-03-09T10:00:00.000Z',
    scripts: [],
    ...rest,
  }
}

export const makeThread = createMakeThread({
  model: 'gpt-5.4',
  createdAt: '2026-03-09T10:00:00.000Z',
  includeUpdatedAt: true,
})
