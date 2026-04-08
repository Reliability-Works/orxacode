import { ThreadId } from '@orxa-code/contracts'
import { assert } from '@effect/vitest'
import { Effect } from 'effect'

import {
  expectedCheckpointContext,
  seedCheckpointContextFixture,
} from './ProjectionSnapshotQuery.checkpointContext.fixtures.ts'
import { projectionSnapshotLayer } from './ProjectionSnapshotQuery.test.helpers.ts'
import { ProjectionSnapshotQuery } from '../Services/ProjectionSnapshotQuery.ts'

projectionSnapshotLayer('ProjectionSnapshotQuery checkpoint context', it => {
  it.effect('reads single-thread checkpoint context without hydrating unrelated threads', () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery

      yield* seedCheckpointContextFixture

      const context = yield* snapshotQuery.getThreadCheckpointContext(
        ThreadId.makeUnsafe('thread-context')
      )
      assert.equal(context._tag, 'Some')
      if (context._tag === 'Some') {
        assert.deepEqual(context.value, expectedCheckpointContext)
      }
    })
  )
})
