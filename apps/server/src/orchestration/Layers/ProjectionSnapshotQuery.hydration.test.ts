import { assert } from '@effect/vitest'
import { Effect } from 'effect'

import { projectionSnapshotLayer } from './ProjectionSnapshotQuery.test.helpers.ts'
import {
  expectedHydratedProjects,
  expectedHydratedThreads,
  seedHydratedSnapshotFixture,
} from './ProjectionSnapshotQuery.hydration.fixtures.ts'
import { ProjectionSnapshotQuery } from '../Services/ProjectionSnapshotQuery.ts'

projectionSnapshotLayer('ProjectionSnapshotQuery hydration', it => {
  it.effect('hydrates read model from projection tables and computes snapshot sequence', () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery

      yield* seedHydratedSnapshotFixture

      const snapshot = yield* snapshotQuery.getSnapshot()

      assert.equal(snapshot.snapshotSequence, 5)
      assert.equal(snapshot.updatedAt, '2026-02-24T00:00:09.000Z')
      assert.deepEqual(snapshot.projects, expectedHydratedProjects)
      assert.deepEqual(snapshot.threads, expectedHydratedThreads)
    })
  )
})
