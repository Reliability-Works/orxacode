import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  git,
  initRepoWithCommit,
  makeTmpDir,
  path,
  withGitTestLayer,
  writeTextFile,
} from './GitCore.test.helpers.ts'

it.effect('pushes worktree branch into parent when fast-forward is possible', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* git(tmp, ['push', '-u', 'origin', initialBranch])

      const wtPath = path.join(tmp, 'wt-ff')
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: initialBranch,
        newBranch: 'feature/ff-push',
        path: wtPath,
      })
      yield* writeTextFile(path.join(wtPath, 'feature.txt'), 'new feature\n')
      yield* git(wtPath, ['add', 'feature.txt'])
      yield* git(wtPath, ['commit', '-m', 'feature commit'])

      const result = yield* (yield* GitCore).pushWorktreeToParent({
        cwd: wtPath,
        sourceBranch: 'HEAD',
        parentBranch: initialBranch,
      })
      expect(result.ok).toBe(true)

      const remoteLog = yield* git(remote, ['log', '--oneline', initialBranch])
      expect(remoteLog).toContain('feature commit')

      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath, force: true })
    })
  )
)

it.effect('returns non_fast_forward when parent has advanced beyond the worktree base', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* git(tmp, ['push', '-u', 'origin', initialBranch])

      const wtPath = path.join(tmp, 'wt-behind')
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: initialBranch,
        newBranch: 'feature/behind',
        path: wtPath,
      })
      yield* writeTextFile(path.join(wtPath, 'feature.txt'), 'divergent feature\n')
      yield* git(wtPath, ['add', 'feature.txt'])
      yield* git(wtPath, ['commit', '-m', 'divergent feature'])

      yield* writeTextFile(path.join(tmp, 'parent.txt'), 'parent advance\n')
      yield* git(tmp, ['add', 'parent.txt'])
      yield* git(tmp, ['commit', '-m', 'parent advance'])
      yield* git(tmp, ['push', 'origin', initialBranch])

      const result = yield* (yield* GitCore).pushWorktreeToParent({
        cwd: wtPath,
        sourceBranch: 'HEAD',
        parentBranch: initialBranch,
      })
      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.reason).toBe('non_fast_forward')
      }

      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath, force: true })
    })
  )
)

it.effect('returns a failure when no remote is configured', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/no-remote' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature/no-remote' })
      yield* writeTextFile(path.join(tmp, 'x.txt'), 'x\n')
      yield* git(tmp, ['add', 'x.txt'])
      yield* git(tmp, ['commit', '-m', 'no remote commit'])

      const result = yield* Effect.result(
        (yield* GitCore).pushWorktreeToParent({
          cwd: tmp,
          sourceBranch: 'HEAD',
          parentBranch: initialBranch,
        })
      )
      expect(result._tag).toBe('Failure')
    })
  )
)
