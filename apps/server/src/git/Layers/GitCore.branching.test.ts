import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  existsSync,
  git,
  initRepoWithCommit,
  makeIsolatedGitCore,
  makeTmpDir,
  path,
  withGitTestLayer,
  writeTextFile,
} from './GitCore.test.helpers.ts'

it.effect('creates a new branch visible in listGitBranches', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'new-feature' })
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches.some(b => b.name === 'new-feature')).toBe(true)
    })
  )
)

it.effect('throws when branch already exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'dupe' })
      const result = yield* Effect.result(
        (yield* GitCore).createBranch({ cwd: tmp, branch: 'dupe' })
      )
      expect(result._tag).toBe('Failure')
    })
  )
)

it.effect('renames the current branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/old-name' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature/old-name' })

      const renamed = yield* (yield* GitCore).renameBranch({
        cwd: tmp,
        oldBranch: 'feature/old-name',
        newBranch: 'feature/new-name',
      })
      expect(renamed.branch).toBe('feature/new-name')

      const branches = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(branches.branches.some(branch => branch.name === 'feature/old-name')).toBe(false)
      expect(branches.branches.find(branch => branch.current)?.name).toBe('feature/new-name')
    })
  )
)

it.effect('returns success without git invocation when old/new names match', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const current = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!
      const renamed = yield* (yield* GitCore).renameBranch({
        cwd: tmp,
        oldBranch: current.name,
        newBranch: current.name,
      })
      expect(renamed.branch).toBe(current.name)
    })
  )
)

it.effect('appends numeric suffix when target branch already exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'orxa/feat/session' })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'orxa/tmp-working' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'orxa/tmp-working' })

      const renamed = yield* (yield* GitCore).renameBranch({
        cwd: tmp,
        oldBranch: 'orxa/tmp-working',
        newBranch: 'orxa/feat/session',
      })
      expect(renamed.branch).toBe('orxa/feat/session-1')
    })
  )
)

it.effect('increments suffix until it finds an available branch name', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'orxa/feat/session' })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'orxa/feat/session-1' })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'orxa/tmp-working' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'orxa/tmp-working' })

      const renamed = yield* (yield* GitCore).renameBranch({
        cwd: tmp,
        oldBranch: 'orxa/tmp-working',
        newBranch: 'orxa/feat/session',
      })
      expect(renamed.branch).toBe('orxa/feat/session-2')
    })
  )
)

it.effect("uses '--' separator for branch rename arguments", () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/old-name' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature/old-name' })

      const realGitCore = yield* GitCore
      let renameArgs: ReadonlyArray<string> | null = null
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args[0] === 'branch' && input.args[1] === '-m') {
          renameArgs = [...input.args]
        }
        return realGitCore.execute(input)
      })

      const renamed = yield* core.renameBranch({
        cwd: tmp,
        oldBranch: 'feature/old-name',
        newBranch: 'feature/new-name',
      })

      expect(renamed.branch).toBe('feature/new-name')
      expect(renameArgs).toEqual(['branch', '-m', '--', 'feature/old-name', 'feature/new-name'])
    })
  )
)

it.effect('creates a worktree with a new branch from the base branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const wtPath = path.join(tmp, 'worktree-out')
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      const result = yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: currentBranch,
        newBranch: 'wt-branch',
        path: wtPath,
      })
      expect(result.worktree.path).toBe(wtPath)
      expect(result.worktree.branch).toBe('wt-branch')
      expect(existsSync(wtPath)).toBe(true)
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
    })
  )
)

it.effect('worktree has the new branch checked out', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const wtPath = path.join(tmp, 'wt-check-dir')
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: currentBranch,
        newBranch: 'wt-check',
        path: wtPath,
      })
      expect(yield* git(wtPath, ['branch', '--show-current'])).toBe('wt-check')
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
    })
  )
)

it.effect('creates a worktree for an existing branch when newBranch is omitted', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/existing-worktree' })
      const wtPath = path.join(tmp, 'wt-existing')
      const result = yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: 'feature/existing-worktree',
        path: wtPath,
      })
      expect(result.worktree.path).toBe(wtPath)
      expect(result.worktree.branch).toBe('feature/existing-worktree')
      expect(yield* git(wtPath, ['branch', '--show-current'])).toBe('feature/existing-worktree')
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
    })
  )
)

it.effect('throws when new branch name already exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'existing' })
      const wtPath = path.join(tmp, 'wt-conflict')
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      const result = yield* Effect.result(
        (yield* GitCore).createWorktree({
          cwd: tmp,
          branch: currentBranch,
          newBranch: 'existing',
          path: wtPath,
        })
      )
      expect(result._tag).toBe('Failure')
    })
  )
)

it.effect('listGitBranches from worktree cwd reports worktree branch as current', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const wtPath = path.join(tmp, 'wt-list-dir')
      const mainBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: mainBranch,
        newBranch: 'wt-list',
        path: wtPath,
      })
      const wtBranches = yield* (yield* GitCore).listBranches({ cwd: wtPath })
      expect(wtBranches.isRepo).toBe(true)
      expect(wtBranches.branches.find(b => b.current)!.name).toBe('wt-list')
      expect(
        (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(b => b.current)!.name
      ).toBe(mainBranch)
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
    })
  )
)

it.effect('removeGitWorktree cleans up the worktree', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const wtPath = path.join(tmp, 'wt-remove-dir')
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: currentBranch,
        newBranch: 'wt-remove',
        path: wtPath,
      })
      expect(existsSync(wtPath)).toBe(true)
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
      expect(existsSync(wtPath)).toBe(false)
    })
  )
)

it.effect('removeGitWorktree force removes a dirty worktree', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const wtPath = path.join(tmp, 'wt-dirty-dir')
      const currentBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => b.current
      )!.name
      yield* (yield* GitCore).createWorktree({
        cwd: tmp,
        branch: currentBranch,
        newBranch: 'wt-dirty',
        path: wtPath,
      })
      expect(existsSync(wtPath)).toBe(true)
      yield* writeTextFile(path.join(wtPath, 'README.md'), 'dirty change\n')
      const failedRemove = yield* Effect.result(
        (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath })
      )
      expect(failedRemove._tag).toBe('Failure')
      expect(existsSync(wtPath)).toBe(true)
      yield* (yield* GitCore).removeWorktree({ cwd: tmp, path: wtPath, force: true })
      expect(existsSync(wtPath)).toBe(false)
    })
  )
)
