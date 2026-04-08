import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCommandError } from '@orxa-code/contracts'

import { GitCore } from '../Services/GitCore.ts'
import {
  git,
  initRepoWithCommit,
  makeIsolatedGitCore,
  makeTmpDir,
  withGitTestLayer,
  writeTextFile,
  path,
} from './GitCore.test.helpers.ts'

it.effect('supports branch lifecycle operations through the service API', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const core = yield* GitCore
      yield* core.initRepo({ cwd: tmp })
      yield* git(tmp, ['config', 'user.email', 'test@test.com'])
      yield* git(tmp, ['config', 'user.name', 'Test'])
      yield* writeTextFile(path.join(tmp, 'README.md'), '# test\n')
      yield* git(tmp, ['add', '.'])
      yield* git(tmp, ['commit', '-m', 'initial commit'])
      yield* core.createBranch({ cwd: tmp, branch: 'feature/service-api' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/service-api' })
      const branches = yield* core.listBranches({ cwd: tmp })
      expect(branches.isRepo).toBe(true)
      expect(branches.branches.find(branch => branch.current)?.name).toBe('feature/service-api')
    })
  )
)

it.effect(
  'reuses an existing remote when the target URL only differs by a trailing slash after .git',
  () =>
    withGitTestLayer(
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir()
        yield* initRepoWithCommit(tmp)
        const core = yield* GitCore
        yield* git(tmp, [
          'remote',
          'add',
          'origin',
          'git@github.com:Reliability-Works/orxacode.git',
        ])
        const remoteName = yield* core.ensureRemote({
          cwd: tmp,
          preferredName: 'origin',
          url: 'git@github.com:Reliability-Works/orxacode.git/',
        })
        expect(remoteName).toBe('origin')
      })
    )
)

it.effect('reports status details and dirty state', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      expect((yield* core.status({ cwd: tmp })).hasWorkingTreeChanges).toBe(false)
      yield* writeTextFile(path.join(tmp, 'README.md'), 'updated\n')
      expect((yield* core.statusDetails(tmp)).hasWorkingTreeChanges).toBe(true)
    })
  )
)

it.effect('computes ahead count against base branch when no upstream is configured', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* core.createBranch({ cwd: tmp, branch: 'feature/no-upstream-ahead' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/no-upstream-ahead' })
      yield* writeTextFile(path.join(tmp, 'feature.txt'), 'ahead of base\n')
      yield* git(tmp, ['add', 'feature.txt'])
      yield* git(tmp, ['commit', '-m', 'feature commit'])
      const details = yield* core.statusDetails(tmp)
      expect(details.aheadCount).toBe(1)
      expect(details.behindCount).toBe(0)
    })
  )
)

it.effect('computes ahead count against origin/default when local default branch is missing', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(source)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', initialBranch])
      yield* git(source, ['checkout', '-b', 'feature/remote-base-only'])
      yield* writeTextFile(path.join(source, 'feature.txt'), `ahead of origin/${initialBranch}\n`)
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature commit'])
      yield* git(source, ['branch', '-D', initialBranch])
      const details = yield* (yield* GitCore).statusDetails(source)
      expect(details.aheadCount).toBe(1)
    })
  )
)

it.effect('computes ahead count against a non-origin remote prefixed merge base candidate', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      const remoteName = 'fork-seed'
      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(source)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', remoteName, remote])
      yield* git(source, ['push', '-u', remoteName, initialBranch])
      yield* git(source, ['checkout', '-b', 'feature/non-origin-merge-base'])
      yield* git(source, [
        'config',
        'branch.feature/non-origin-merge-base.gh-merge-base',
        `${remoteName}/${initialBranch}`,
      ])
      yield* writeTextFile(
        path.join(source, 'feature.txt'),
        `ahead of ${remoteName}/${initialBranch}\n`
      )
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature commit'])
      yield* git(source, ['branch', '-D', initialBranch])
      const details = yield* (yield* GitCore).statusDetails(source)
      expect(details.aheadCount).toBe(1)
    })
  )
)

it.effect('lists branches when recency lookup fails', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const realGitCore = yield* GitCore
      let didFailRecency = false
      const core = yield* makeIsolatedGitCore(input => {
        if (!didFailRecency && input.args[0] === 'for-each-ref') {
          didFailRecency = true
          return Effect.fail(
            new GitCommandError({
              operation: 'git.test.listBranchesRecency',
              command: `git ${input.args.join(' ')}`,
              cwd: input.cwd,
              detail: 'timeout',
            })
          )
        }
        return realGitCore.execute(input)
      })
      const result = yield* core.listBranches({ cwd: tmp })
      expect(result.isRepo).toBe(true)
      expect(didFailRecency).toBe(true)
    })
  )
)

it.effect('falls back to empty remote branch data when remote lookups fail', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      const realGitCore = yield* GitCore
      let didFailRemoteBranches = false
      let didFailRemoteNames = false
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args.join(' ') === 'branch --no-color --no-column --remotes') {
          didFailRemoteBranches = true
          return Effect.fail(
            new GitCommandError({
              operation: 'git.test.listBranchesRemoteBranches',
              command: `git ${input.args.join(' ')}`,
              cwd: input.cwd,
              detail: 'remote unavailable',
            })
          )
        }
        if (input.args.join(' ') === 'remote') {
          didFailRemoteNames = true
          return Effect.fail(
            new GitCommandError({
              operation: 'git.test.listBranchesRemoteNames',
              command: `git ${input.args.join(' ')}`,
              cwd: input.cwd,
              detail: 'remote unavailable',
            })
          )
        }
        return realGitCore.execute(input)
      })
      const result = yield* core.listBranches({ cwd: tmp })
      expect(result.branches.every(branch => !branch.isRemote)).toBe(true)
      expect(didFailRemoteBranches).toBe(true)
      expect(didFailRemoteNames).toBe(true)
    })
  )
)
