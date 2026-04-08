import { it } from '@effect/vitest'

import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  GitManagerTestLayer,
  initRepo,
  makeManager,
  makeTempDir,
  resolvePullRequest,
} from './GitManager.test.helpers.ts'

const layer = it.layer(GitManagerTestLayer)

layer('GitManager pull requests', it => {
  it.effect('resolves pull requests from #number references', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)

      const { manager, ghCalls } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 42,
            title: 'Resolve PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/42',
            baseRefName: 'main',
            headRefName: 'feature/resolve-pr',
            state: 'open',
          },
        },
      })

      const result = yield* resolvePullRequest(manager, {
        cwd: repoDir,
        reference: '#42',
      })

      expect(result.pullRequest).toEqual({
        number: 42,
        title: 'Resolve PR',
        url: 'https://github.com/Reliability-Works/orxacode/pull/42',
        baseBranch: 'main',
        headBranch: 'feature/resolve-pr',
        state: 'open',
      })
      expect(ghCalls.some(call => call.startsWith('pr view 42 '))).toBe(true)
    })
  )
})
