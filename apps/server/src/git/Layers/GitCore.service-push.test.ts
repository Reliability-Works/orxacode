import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  git,
  initRepoWithCommit,
  makeTmpDir,
  withGitTestLayer,
  writeTextFile,
  path,
} from './GitCore.test.helpers.ts'

it.effect('skips push when no upstream is configured and branch is not ahead of base', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* core.createBranch({ cwd: tmp, branch: 'feature/no-upstream-no-ahead' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/no-upstream-no-ahead' })
      const pushed = yield* core.pushCurrentBranch(tmp, null)
      expect(pushed.status).toBe('skipped_up_to_date')
    })
  )
)

it.effect('pushes with upstream setup when no comparable base branch exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* git(tmp, ['init', '--initial-branch=trunk'])
      yield* git(tmp, ['config', 'user.email', 'test@test.com'])
      yield* git(tmp, ['config', 'user.name', 'Test'])
      yield* writeTextFile(path.join(tmp, 'README.md'), 'hello\n')
      yield* git(tmp, ['add', 'README.md'])
      yield* git(tmp, ['commit', '-m', 'initial'])
      yield* git(remote, ['init', '--bare'])
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* git(tmp, ['checkout', '-b', 'feature/no-base'])
      const pushed = yield* (yield* GitCore).pushCurrentBranch(tmp, null)
      expect(pushed.status).toBe('pushed')
      expect(pushed.setUpstream).toBe(true)
    })
  )
)

it.effect('pushes with upstream setup to the only configured non-origin remote', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* git(tmp, ['init', '--initial-branch=main'])
      yield* git(tmp, ['config', 'user.email', 'test@test.com'])
      yield* git(tmp, ['config', 'user.name', 'Test'])
      yield* writeTextFile(path.join(tmp, 'README.md'), 'hello\n')
      yield* git(tmp, ['add', 'README.md'])
      yield* git(tmp, ['commit', '-m', 'initial'])
      yield* git(remote, ['init', '--bare'])
      yield* git(tmp, ['remote', 'add', 'fork', remote])
      yield* git(tmp, ['checkout', '-b', 'feature/fork-only'])
      const pushed = yield* (yield* GitCore).pushCurrentBranch(tmp, null)
      expect(pushed.upstreamBranch).toBe('fork/feature/fork-only')
    })
  )
)

it.effect(
  'pushes with upstream setup when comparable base exists but remote branch is missing',
  () =>
    withGitTestLayer(
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir()
        const remote = yield* makeTmpDir()
        yield* git(remote, ['init', '--bare'])
        yield* initRepoWithCommit(tmp)
        const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
          branch => branch.current
        )!.name
        yield* git(tmp, ['remote', 'add', 'origin', remote])
        yield* git(tmp, ['push', '-u', 'origin', initialBranch])
        yield* writeTextFile(path.join(tmp, 'default-ahead.txt'), 'ahead on default\n')
        yield* git(tmp, ['add', 'default-ahead.txt'])
        yield* git(tmp, ['commit', '-m', 'default ahead'])
        const featureBranch = 'feature/publish-no-upstream'
        yield* git(tmp, ['checkout', '-b', featureBranch])
        const pushed = yield* (yield* GitCore).pushCurrentBranch(tmp, null)
        expect(pushed.upstreamBranch).toBe(`origin/${featureBranch}`)
      })
    )
)

it.effect('prefers branch pushRemote over origin when setting upstream', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const origin = yield* makeTmpDir()
      const fork = yield* makeTmpDir()
      yield* git(origin, ['init', '--bare'])
      yield* git(fork, ['init', '--bare'])
      yield* initRepoWithCommit(tmp)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        branch => branch.current
      )!.name
      yield* git(tmp, ['remote', 'add', 'origin', origin])
      yield* git(tmp, ['remote', 'add', 'fork', fork])
      yield* git(tmp, ['push', '-u', 'origin', initialBranch])
      const featureBranch = 'feature/push-remote'
      yield* git(tmp, ['checkout', '-b', featureBranch])
      yield* git(tmp, ['config', `branch.${featureBranch}.pushRemote`, 'fork'])
      yield* writeTextFile(path.join(tmp, 'feature.txt'), 'push to fork\n')
      yield* git(tmp, ['add', 'feature.txt'])
      yield* git(tmp, ['commit', '-m', 'feature commit'])
      const pushed = yield* (yield* GitCore).pushCurrentBranch(tmp, null)
      expect(pushed.upstreamBranch).toBe(`fork/${featureBranch}`)
    })
  )
)

it.effect(
  'pushes renamed PR worktree branches to their tracked upstream branch even when push.default is current',
  () =>
    withGitTestLayer(
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir()
        const fork = yield* makeTmpDir()
        yield* git(fork, ['init', '--bare'])

        const { initialBranch } = yield* initRepoWithCommit(tmp)
        yield* git(tmp, ['remote', 'add', 'jasonLaster', fork])
        yield* git(tmp, ['checkout', '-b', 'statemachine'])
        yield* writeTextFile(path.join(tmp, 'fork.txt'), 'fork branch\n')
        yield* git(tmp, ['add', 'fork.txt'])
        yield* git(tmp, ['commit', '-m', 'fork branch'])
        yield* git(tmp, ['push', '-u', 'jasonLaster', 'statemachine'])
        yield* git(tmp, ['checkout', initialBranch])
        yield* git(tmp, ['branch', '-D', 'statemachine'])
        yield* git(tmp, [
          'checkout',
          '-b',
          'orxa/pr-488/statemachine',
          '--track',
          'jasonLaster/statemachine',
        ])
        yield* git(tmp, ['config', 'push.default', 'current'])
        yield* writeTextFile(path.join(tmp, 'fork.txt'), 'updated fork branch\n')
        yield* git(tmp, ['add', 'fork.txt'])
        yield* git(tmp, ['commit', '-m', 'update reviewed PR branch'])

        const pushed = yield* (yield* GitCore).pushCurrentBranch(tmp, null)
        expect(pushed.upstreamBranch).toBe('jasonLaster/statemachine')
      })
    )
)
