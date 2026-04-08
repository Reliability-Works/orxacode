import { assert } from '@effect/vitest'
import { Effect } from 'effect'

import { asProjectId, projectionSnapshotLayer } from './ProjectionSnapshotQuery.test.helpers.ts'
import { seedTargetedQueryFixture } from './ProjectionSnapshotQuery.targetedQueries.fixtures.ts'
import { ProjectionSnapshotQuery } from '../Services/ProjectionSnapshotQuery.ts'

projectionSnapshotLayer('ProjectionSnapshotQuery targeted queries', it => {
  it.effect(
    'reads targeted project, thread, and count queries without hydrating the full snapshot',
    () =>
      Effect.gen(function* () {
        const snapshotQuery = yield* ProjectionSnapshotQuery

        yield* seedTargetedQueryFixture

        const counts = yield* snapshotQuery.getCounts()
        assert.deepEqual(counts, {
          projectCount: 2,
          threadCount: 3,
        })

        const project = yield* snapshotQuery.getActiveProjectByWorkspaceRoot('/tmp/workspace')
        assert.equal(project._tag, 'Some')
        if (project._tag === 'Some') {
          assert.equal(project.value.id, asProjectId('project-active'))
        }

        const missingProject = yield* snapshotQuery.getActiveProjectByWorkspaceRoot('/tmp/missing')
        assert.equal(missingProject._tag, 'None')

        const firstThreadId = yield* snapshotQuery.getFirstActiveThreadIdByProjectId(
          asProjectId('project-active')
        )
        assert.equal(firstThreadId._tag, 'Some')
        if (firstThreadId._tag === 'Some') {
          assert.equal(firstThreadId.value, 'thread-first')
        }
      })
  )
})
