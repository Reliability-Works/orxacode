import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  buildLargeText,
  git,
  initRepoWithCommit,
  makeTmpDir,
  withGitTestLayer,
  writeTextFile,
  path,
} from './GitCore.test.helpers.ts'

it.effect('includes command context when worktree removal fails', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      const missingWorktreePath = path.join(tmp, 'missing-worktree')
      const removeResult = yield* Effect.result(
        core.removeWorktree({ cwd: tmp, path: missingWorktreePath })
      )
      expect(removeResult._tag).toBe('Failure')
      if (removeResult._tag === 'Failure') {
        expect(removeResult.failure.message).toContain('git worktree remove')
      }
    })
  )
)

it.effect('refreshes upstream before statusDetails so behind count reflects remote updates', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      const clone = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(source)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', initialBranch])
      yield* git(clone, ['clone', remote, '.'])
      yield* git(clone, ['config', 'user.email', 'test@test.com'])
      yield* git(clone, ['config', 'user.name', 'Test'])
      yield* git(clone, ['checkout', '-B', initialBranch, '--track', `origin/${initialBranch}`])
      yield* writeTextFile(path.join(clone, 'CHANGELOG.md'), 'remote change\n')
      yield* git(clone, ['add', 'CHANGELOG.md'])
      yield* git(clone, ['commit', '-m', 'remote update'])
      yield* git(clone, ['push', 'origin', initialBranch])
      const details = yield* (yield* GitCore).statusDetails(source)
      expect(details.behindCount).toBe(1)
    })
  )
)

it.effect('prepares commit context by auto-staging and creates commit', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'README.md'), 'new content\n')
      const context = yield* core.prepareCommitContext(tmp)
      expect(context!.stagedPatch.length).toBeGreaterThan(0)
      const created = yield* core.commit(tmp, 'Add README update', '- include updated content')
      expect(created.commitSha.length).toBeGreaterThan(0)
    })
  )
)

it.effect('prepareCommitContext stages only selected files when filePaths provided', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'a.txt'), 'file a\n')
      yield* writeTextFile(path.join(tmp, 'b.txt'), 'file b\n')
      const context = yield* core.prepareCommitContext(tmp, ['a.txt'])
      expect(context!.stagedSummary).toContain('a.txt')
      expect(context!.stagedSummary).not.toContain('b.txt')
    })
  )
)

it.effect('prepareCommitContext stages everything when filePaths is undefined', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'a.txt'), 'file a\n')
      yield* writeTextFile(path.join(tmp, 'b.txt'), 'file b\n')
      const context = yield* core.prepareCommitContext(tmp)
      expect(context!.stagedSummary).toContain('a.txt')
      expect(context!.stagedSummary).toContain('b.txt')
    })
  )
)

it.effect('prepareCommitContext truncates oversized staged patches instead of failing', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* writeTextFile(path.join(tmp, 'README.md'), buildLargeText())
      const context = yield* core.prepareCommitContext(tmp)
      expect(context!.stagedPatch).toContain('[truncated]')
    })
  )
)

it.effect('readRangeContext truncates oversized diff patches instead of failing', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      const core = yield* GitCore
      yield* core.createBranch({ cwd: tmp, branch: 'feature/large-range-context' })
      yield* core.checkoutBranch({ cwd: tmp, branch: 'feature/large-range-context' })
      yield* writeTextFile(path.join(tmp, 'large.txt'), buildLargeText())
      yield* git(tmp, ['add', 'large.txt'])
      yield* git(tmp, ['commit', '-m', 'Add large range context'])
      const rangeContext = yield* core.readRangeContext(tmp, initialBranch)
      expect(rangeContext.diffPatch).toContain('[truncated]')
    })
  )
)

it.effect('pushes with upstream setup and then skips when up to date', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* git(remote, ['init', '--bare'])
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/core-push' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature/core-push' })
      yield* writeTextFile(path.join(tmp, 'feature.txt'), 'push me\n')
      const core = yield* GitCore
      yield* core.prepareCommitContext(tmp)
      yield* core.commit(tmp, 'Add feature file', '')
      expect((yield* core.pushCurrentBranch(tmp, null)).status).toBe('pushed')
      expect((yield* core.pushCurrentBranch(tmp, null)).status).toBe('skipped_up_to_date')
    })
  )
)

it.effect('pulls behind branch and then reports up-to-date', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      const clone = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(source)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', initialBranch])
      yield* git(clone, ['clone', remote, '.'])
      yield* git(clone, ['config', 'user.email', 'test@test.com'])
      yield* git(clone, ['config', 'user.name', 'Test'])
      yield* writeTextFile(path.join(clone, 'CHANGELOG.md'), 'remote change\n')
      yield* git(clone, ['add', 'CHANGELOG.md'])
      yield* git(clone, ['commit', '-m', 'remote update'])
      yield* git(clone, ['push', 'origin', initialBranch])
      const core = yield* GitCore
      expect((yield* core.pullCurrentBranch(source)).status).toBe('pulled')
      expect((yield* core.pullCurrentBranch(source)).status).toBe('skipped_up_to_date')
    })
  )
)

it.effect('top-level pullGitBranch rejects when no upstream exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const result = yield* Effect.result((yield* GitCore).pullCurrentBranch(tmp))
      expect(result._tag).toBe('Failure')
    })
  )
)
