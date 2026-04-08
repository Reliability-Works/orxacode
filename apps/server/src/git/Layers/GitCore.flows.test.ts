import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  existsSync,
  git,
  initRepoWithCommit,
  makeTmpDir,
  path,
  withGitTestLayer,
  writeTextFile,
} from './GitCore.test.helpers.ts'

it.effect('init to commit to create branch to checkout verifies current branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature-login' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature-login' })
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches.find(b => b.current)!.name).toBe('feature-login')
    })
  )
)

it.effect('creates worktree with new branch from current branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      const wtPath = path.join(tmp, 'my-worktree')
      const result = yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: currentBranch,
        newBranch: 'feature-wt',
        path: wtPath,
      })
      expect(existsSync(result.worktree.path)).toBe(true)
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe(currentBranch)
      expect(yield* git(wtPath, ['branch', '--show-current'])).toBe('feature-wt')
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
    })
  )
)

it.effect('fetches a GitHub pull request ref into a local branch without checkout', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      const remoteDir = yield* makeTmpDir('git-remote-')
      yield* git(remoteDir, ['init', '--bare'])
      yield* git(tmp, ['remote', 'add', 'origin', remoteDir])
      yield* git(tmp, ['push', '-u', 'origin', initialBranch])
      yield* git(tmp, ['checkout', '-b', 'feature/pr-fetch'])
      yield* writeTextFile(path.join(tmp, 'pr-fetch.txt'), 'fetch me\n')
      yield* git(tmp, ['add', 'pr-fetch.txt'])
      yield* git(tmp, ['commit', '-m', 'Add PR fetch branch'])
      yield* git(tmp, ['push', '-u', 'origin', 'feature/pr-fetch'])
      yield* git(tmp, ['push', 'origin', 'HEAD:refs/pull/55/head'])
      yield* git(tmp, ['checkout', initialBranch])

      yield* (yield* GitCore).fetchPullRequestBranch({
        cwd: tmp,
        prNumber: 55,
        branch: 'feature/pr-fetch',
      })
      expect(yield* git(tmp, ['branch', '--list', 'feature/pr-fetch'])).toContain(
        'feature/pr-fetch'
      )
      expect(yield* git(tmp, ['branch', '--show-current'])).toBe(initialBranch)
    })
  )
)

it.effect('checkout a then b then a keeps current branch in sync', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'branch-a' })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'branch-b' })

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'branch-a' })
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe('branch-a')
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'branch-b' })
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe('branch-b')
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'branch-a' })
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe('branch-a')
    })
  )
)

it.effect('uncommitted changes prevent checkout to a diverged branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'diverged' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'diverged' })
      yield* writeTextFile(path.join(tmp, 'README.md'), 'diverged content\n')
      yield* git(tmp, ['add', '.'])
      yield* git(tmp, ['commit', '-m', 'diverge'])

      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.name !== 'diverged'
      )!.name
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: initialBranch })
      yield* writeTextFile(path.join(tmp, 'README.md'), 'local uncommitted\n')

      const failedCheckout = yield* Effect.result(
        (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'diverged' })
      )
      expect(failedCheckout._tag).toBe('Failure')
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe(initialBranch)
    })
  )
)
