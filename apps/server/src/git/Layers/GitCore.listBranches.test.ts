import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  commitWithDate,
  git,
  initRepoWithCommit,
  makeIsolatedGitCore,
  makeTmpDir,
  withGitTestLayer,
} from './GitCore.test.helpers.ts'

it.effect('returns isRepo: false for non-git directory', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.isRepo).toBe(false)
      expect(result.hasOriginRemote).toBe(false)
      expect(result.branches).toEqual([])
    })
  )
)

it.effect('returns the current branch with current: true', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      const current = result.branches.find(b => b.current)
      expect(current).toBeDefined()
      expect(current!.current).toBe(true)
    })
  )
)

it.effect('does not include detached HEAD pseudo-refs as branches', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* git(tmp, ['checkout', '--detach', 'HEAD'])

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches.some(branch => branch.name.startsWith('('))).toBe(false)
      expect(result.branches.some(branch => branch.current)).toBe(false)
    })
  )
)

it.effect('keeps current branch first and sorts the remaining branches by recency', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const initialBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        branch => branch.current
      )!.name

      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'older-branch' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'older-branch' })
      yield* commitWithDate(
        tmp,
        'older.txt',
        'older branch change\n',
        'Thu, 1 Jan 2037 00:00:00 +0000',
        'older branch change'
      )

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: initialBranch })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'newer-branch' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'newer-branch' })
      yield* commitWithDate(
        tmp,
        'newer.txt',
        'newer branch change\n',
        'Fri, 1 Jan 2038 00:00:00 +0000',
        'newer branch change'
      )

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'older-branch' })

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches[0]!.name).toBe('older-branch')
      expect(result.branches[1]!.name).toBe('newer-branch')
    })
  )
)

it.effect('keeps default branch right after current branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const remote = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        branch => branch.current
      )!.name

      yield* git(remote, ['init', '--bare'])
      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* git(tmp, ['push', '-u', 'origin', defaultBranch])
      yield* git(tmp, ['remote', 'set-head', 'origin', defaultBranch])

      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'current-branch' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'current-branch' })
      yield* commitWithDate(
        tmp,
        'current.txt',
        'current change\n',
        'Thu, 1 Jan 2037 00:00:00 +0000',
        'current change'
      )

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: defaultBranch })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'newer-branch' })
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'newer-branch' })
      yield* commitWithDate(
        tmp,
        'newer.txt',
        'newer change\n',
        'Fri, 1 Jan 2038 00:00:00 +0000',
        'newer change'
      )

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'current-branch' })

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches[0]!.name).toBe('current-branch')
      expect(result.branches[1]!.name).toBe(defaultBranch)
      expect(result.branches[2]!.name).toBe('newer-branch')
    })
  )
)

it.effect('lists multiple branches after creating them', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature-a' })
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature-b' })

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      const names = result.branches.map(b => b.name)
      expect(names).toContain('feature-a')
      expect(names).toContain('feature-b')
    })
  )
)

it.effect('parses separate branch names when column.ui is always enabled', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      const { initialBranch } = yield* initRepoWithCommit(tmp)
      const createdBranchNames = [
        'go-bin',
        'copilot/rewrite-cli-in-go',
        'copilot/rewrite-cli-in-rust',
      ] as const
      for (const branchName of createdBranchNames) {
        yield* (yield* GitCore).createBranch({ cwd: tmp, branch: branchName })
      }
      yield* git(tmp, ['config', 'column.ui', 'always'])

      const rawBranchOutput = yield* git(tmp, ['branch', '--no-color'], {
        ...process.env,
        COLUMNS: '120',
      })
      expect(
        rawBranchOutput
          .split('\n')
          .some(
            line => createdBranchNames.filter(branchName => line.includes(branchName)).length >= 2
          )
      ).toBe(true)

      const realGitCore = yield* GitCore
      const core = yield* makeIsolatedGitCore(input =>
        realGitCore.execute(
          input.args[0] === 'branch'
            ? {
                ...input,
                env: { ...input.env, COLUMNS: '120' },
              }
            : input
        )
      )

      const result = yield* core.listBranches({ cwd: tmp })
      const localBranchNames = result.branches
        .filter(branch => !branch.isRemote)
        .map(branch => branch.name)

      expect(localBranchNames).toHaveLength(4)
      expect(localBranchNames).toEqual(
        expect.arrayContaining([initialBranch, ...createdBranchNames])
      )
      expect(
        localBranchNames.some(
          branchName =>
            createdBranchNames.filter(createdBranch => branchName.includes(createdBranch)).length >=
            2
        )
      ).toBe(false)
    })
  )
)

it.effect('isDefault is false when no remote exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.branches.every(b => b.isDefault === false)).toBe(true)
    })
  )
)

it.effect('lists local branches first and remote branches last', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const tmp = yield* makeTmpDir()

      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(tmp)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        branch => branch.current
      )!.name

      yield* git(tmp, ['remote', 'add', 'origin', remote])
      yield* git(tmp, ['push', '-u', 'origin', defaultBranch])

      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature/local-only' })

      const remoteOnlyBranch = 'feature/remote-only'
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: defaultBranch })
      yield* git(tmp, ['checkout', '-b', remoteOnlyBranch])
      yield* git(tmp, ['push', '-u', 'origin', remoteOnlyBranch])
      yield* git(tmp, ['checkout', defaultBranch])
      yield* git(tmp, ['branch', '-D', remoteOnlyBranch])

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      const firstRemoteIndex = result.branches.findIndex(branch => branch.isRemote)

      expect(result.hasOriginRemote).toBe(true)
      expect(firstRemoteIndex).toBeGreaterThan(0)
      expect(result.branches.slice(0, firstRemoteIndex).every(branch => !branch.isRemote)).toBe(
        true
      )
      expect(result.branches.slice(firstRemoteIndex).every(branch => branch.isRemote)).toBe(true)
      expect(
        result.branches.some(branch => branch.name === 'feature/local-only' && !branch.isRemote)
      ).toBe(true)
      expect(
        result.branches.some(
          branch => branch.name === 'origin/feature/remote-only' && branch.isRemote
        )
      ).toBe(true)
    })
  )
)

it.effect('includes remoteName metadata for remotes with slash in the name', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const tmp = yield* makeTmpDir()
      const remoteName = 'my-org/upstream'

      yield* git(remote, ['init', '--bare'])
      yield* initRepoWithCommit(tmp)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        branch => branch.current
      )!.name

      yield* git(tmp, ['remote', 'add', remoteName, remote])
      yield* git(tmp, ['push', '-u', remoteName, defaultBranch])

      const remoteOnlyBranch = 'feature/remote-with-remote-name'
      yield* git(tmp, ['checkout', '-b', remoteOnlyBranch])
      yield* git(tmp, ['push', '-u', remoteName, remoteOnlyBranch])
      yield* git(tmp, ['checkout', defaultBranch])
      yield* git(tmp, ['branch', '-D', remoteOnlyBranch])

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      const remoteBranch = result.branches.find(
        branch => branch.name === `${remoteName}/${remoteOnlyBranch}`
      )

      expect(remoteBranch).toBeDefined()
      expect(remoteBranch?.isRemote).toBe(true)
      expect(remoteBranch?.remoteName).toBe(remoteName)
    })
  )
)
