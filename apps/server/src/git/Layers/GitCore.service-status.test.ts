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

it.effect('supports stage-all and restore-all-unstaged through the service API', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'README.md'), 'updated\n')

      yield* core.stageAll({ cwd: tmp })
      let details = yield* core.statusDetails(tmp)
      expect(details.hasWorkingTreeChanges).toBe(true)
      expect(details.workingTree.files).toHaveLength(1)

      yield* core.unstagePath({ cwd: tmp, path: 'README.md' })
      yield* core.restoreAllUnstaged({ cwd: tmp })
      details = yield* core.statusDetails(tmp)
      expect(details.hasWorkingTreeChanges).toBe(false)
      expect(details.workingTree.files).toHaveLength(0)
    })
  )
)

it.effect('returns full patch blocks for sidebar diff rendering', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'README.md'), 'updated\nwith more context\n')

      const diff = yield* core.getDiff({ cwd: tmp })
      const file = diff.unstaged.find(entry => entry.path === 'README.md')

      expect(file).toBeDefined()
      expect(file?.patch).toContain('diff --git a/README.md b/README.md')
      expect(file?.patch).toContain('--- a/README.md')
      expect(file?.patch).toContain('+++ b/README.md')
      expect(file?.patch).toContain('@@')
    })
  )
)

it.effect('renders patches for text-based untracked files', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'notes.md'), 'hello\nworld\n')

      const diff = yield* core.getDiff({ cwd: tmp })
      const file = diff.untracked.find(entry => entry.path === 'notes.md')

      expect(file).toBeDefined()
      expect(file?.patch).toContain('diff --git a/notes.md b/notes.md')
      expect(file?.patch).toContain('--- /dev/null')
      expect(file?.patch).toContain('+++ b/notes.md')
      expect(file?.additions).toBe(2)
    })
  )
)

it.effect('returns diff scope summaries and branch compare data', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* core.createBranch({ cwd: tmp, branch: 'feature/scoped-diff' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/scoped-diff' })
      yield* git(tmp, ['config', 'branch.feature/scoped-diff.gh-merge-base', initialBranch])
      yield* writeTextFile(path.join(tmp, 'README.md'), 'updated\nwith more context\n')
      yield* git(tmp, ['add', 'README.md'])
      yield* git(tmp, ['commit', '-m', 'scoped diff change'])

      const diff = yield* core.getDiff({ cwd: tmp })

      expect(diff.scopeSummaries.map(summary => summary.scope)).toEqual([
        'unstaged',
        'staged',
        'branch',
      ])
      expect(diff.scopeSummaries.find(summary => summary.scope === 'branch')?.available).toBe(true)
      expect(diff.scopeSummaries.find(summary => summary.scope === 'branch')?.baseRef).toBe(
        initialBranch
      )
      expect(diff.branch?.baseRef).toBe(initialBranch)
      expect(diff.branch?.files.some(file => file.path === 'README.md')).toBe(true)
      expect(diff.branch?.fileCount).toBeGreaterThan(0)
    })
  )
)

it.effect('keeps local diff data available when branch compare output is oversized', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* core.createBranch({ cwd: tmp, branch: 'feature/oversized-branch-diff' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/oversized-branch-diff' })
      yield* git(tmp, [
        'config',
        'branch.feature/oversized-branch-diff.gh-merge-base',
        initialBranch,
      ])
      yield* writeTextFile(path.join(tmp, 'big.txt'), `${'x'.repeat(1_200_000)}\n`)
      yield* git(tmp, ['add', 'big.txt'])
      yield* git(tmp, ['commit', '-m', 'oversized branch diff'])
      yield* writeTextFile(path.join(tmp, 'README.md'), 'local unstaged change\n')

      const diff = yield* core.getDiff({ cwd: tmp })

      expect(diff.unstaged.some(file => file.path === 'README.md')).toBe(true)
      expect(diff.scopeSummaries.find(summary => summary.scope === 'unstaged')?.fileCount).toBe(1)
      expect(diff.scopeSummaries.find(summary => summary.scope === 'branch')?.available).toBe(false)
      expect(diff.branch).toBeNull()
    })
  )
)

it.effect('returns git log entries for repositories with commits', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore

      const log = yield* core.getLog({ cwd: tmp, limit: 10 })

      expect(log.entries.length).toBeGreaterThan(0)
      expect(log.entries[0]?.subject).toBe('initial commit')
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
