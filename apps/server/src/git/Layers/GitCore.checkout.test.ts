import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect, vi } from 'vitest'

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

it.effect('checks out an existing branch', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'feature' })

      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'feature' })

      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      const current = result.branches.find(b => b.current)
      expect(current!.name).toBe('feature')
    })
  )
)

it.effect('refreshes upstream behind count after checkout when remote branch advanced', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const services = yield* Effect.services()
      const runPromise = Effect.runPromiseWith(services)

      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      const clone = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', defaultBranch])

      const featureBranch = 'feature-behind'
      yield* (yield* GitCore).createBranch({ cwd: source, branch: featureBranch })
      yield* (yield* GitCore).checkoutBranch({ cwd: source, branch: featureBranch })
      yield* writeTextFile(path.join(source, 'feature.txt'), 'feature base\n')
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature base'])
      yield* git(source, ['push', '-u', 'origin', featureBranch])
      yield* (yield* GitCore).checkoutBranch({ cwd: source, branch: defaultBranch })

      yield* git(clone, ['clone', remote, '.'])
      yield* git(clone, ['config', 'user.email', 'test@test.com'])
      yield* git(clone, ['config', 'user.name', 'Test'])
      yield* git(clone, ['checkout', '-b', featureBranch, '--track', `origin/${featureBranch}`])
      yield* writeTextFile(path.join(clone, 'feature.txt'), 'feature from remote\n')
      yield* git(clone, ['add', 'feature.txt'])
      yield* git(clone, ['commit', '-m', 'remote feature update'])
      yield* git(clone, ['push', 'origin', featureBranch])

      yield* (yield* GitCore).checkoutBranch({ cwd: source, branch: featureBranch })
      const core = yield* GitCore
      yield* Effect.promise(() =>
        vi.waitFor(
          async () => {
            const details = await runPromise(core.statusDetails(source))
            expect(details.branch).toBe(featureBranch)
            expect(details.aheadCount).toBe(0)
            expect(details.behindCount).toBe(1)
          },
          { timeout: 10_000, interval: 100 }
        )
      )
    })
  )
)

it.effect('keeps checkout successful when upstream refresh fails', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', defaultBranch])

      const featureBranch = 'feature-refresh-failure'
      yield* git(source, ['branch', featureBranch])
      yield* git(source, ['checkout', featureBranch])
      yield* writeTextFile(path.join(source, 'feature.txt'), 'feature base\n')
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature base'])
      yield* git(source, ['push', '-u', 'origin', featureBranch])
      yield* git(source, ['checkout', defaultBranch])

      const realGitCore = yield* GitCore
      let refreshFetchAttempts = 0
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args[0] === 'fetch') {
          refreshFetchAttempts += 1
          return Effect.fail(
            new GitCommandError({
              operation: 'git.test.refreshFailure',
              command: `git ${input.args.join(' ')}`,
              cwd: input.cwd,
              detail: 'simulated fetch timeout',
            })
          )
        }
        return realGitCore.execute(input)
      })
      yield* core.checkoutBranch({ cwd: source, branch: featureBranch })
      yield* Effect.promise(() => vi.waitFor(() => expect(refreshFetchAttempts).toBe(1)))
      expect(yield* git(source, ['branch', '--show-current'])).toBe(featureBranch)
    })
  )
)

it.effect('refresh fetch is scoped to the checked out branch upstream refspec', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', defaultBranch])

      const featureBranch = 'feature/scoped-fetch'
      yield* git(source, ['checkout', '-b', featureBranch])
      yield* writeTextFile(path.join(source, 'feature.txt'), 'feature base\n')
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature base'])
      yield* git(source, ['push', '-u', 'origin', featureBranch])
      yield* git(source, ['checkout', defaultBranch])

      const realGitCore = yield* GitCore
      let fetchArgs: ReadonlyArray<string> | null = null
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args[0] === 'fetch') {
          fetchArgs = [...input.args]
          return Effect.succeed({
            code: 0,
            stdout: '',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          })
        }
        return realGitCore.execute(input)
      })
      yield* core.checkoutBranch({ cwd: source, branch: featureBranch })
      yield* Effect.promise(() => vi.waitFor(() => expect(fetchArgs).not.toBeNull()))

      expect(yield* git(source, ['branch', '--show-current'])).toBe(featureBranch)
      expect(fetchArgs).toEqual([
        'fetch',
        '--quiet',
        '--no-tags',
        'origin',
        `+refs/heads/${featureBranch}:refs/remotes/origin/${featureBranch}`,
      ])
    })
  )
)

it.effect('returns checkout result before background upstream refresh completes', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', defaultBranch])

      const featureBranch = 'feature/background-refresh'
      yield* git(source, ['checkout', '-b', featureBranch])
      yield* writeTextFile(path.join(source, 'feature.txt'), 'feature base\n')
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature base'])
      yield* git(source, ['push', '-u', 'origin', featureBranch])
      yield* git(source, ['checkout', defaultBranch])

      const realGitCore = yield* GitCore
      let fetchStarted = false
      let releaseFetch!: () => void
      const waitForReleasePromise = new Promise<void>(resolve => {
        releaseFetch = resolve
      })
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args[0] === 'fetch') {
          fetchStarted = true
          return Effect.promise(() =>
            waitForReleasePromise.then(() => ({
              code: 0,
              stdout: '',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
            }))
          )
        }
        return realGitCore.execute(input)
      })
      yield* core.checkoutBranch({ cwd: source, branch: featureBranch })
      yield* Effect.promise(() => vi.waitFor(() => expect(fetchStarted).toBe(true)))
      expect(yield* git(source, ['branch', '--show-current'])).toBe(featureBranch)
      releaseFetch()
    })
  )
)

it.effect('throws when branch does not exist', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const result = yield* Effect.result(
        (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'nonexistent' })
      )
      expect(result._tag).toBe('Failure')
    })
  )
)

it.effect('does not silently checkout a local branch when a remote ref no longer exists', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', 'origin', remote])
      yield* git(source, ['push', '-u', 'origin', defaultBranch])

      yield* (yield* GitCore).createBranch({ cwd: source, branch: 'feature' })

      const checkoutResult = yield* Effect.result(
        (yield* GitCore).checkoutBranch({ cwd: source, branch: 'origin/feature' })
      )
      expect(checkoutResult._tag).toBe('Failure')
      expect(yield* git(source, ['branch', '--show-current'])).toBe(defaultBranch)
    })
  )
)

it.effect('checks out a remote tracking branch when remote name contains slashes', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const remote = yield* makeTmpDir()
      const source = yield* makeTmpDir()
      const remoteName = 'my-org/upstream'
      const featureBranch = 'feature'
      yield* git(remote, ['init', '--bare'])

      yield* initRepoWithCommit(source)
      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
        branch => branch.current
      )!.name
      yield* git(source, ['remote', 'add', remoteName, remote])
      yield* git(source, ['push', '-u', remoteName, defaultBranch])

      yield* git(source, ['checkout', '-b', featureBranch])
      yield* writeTextFile(path.join(source, 'feature.txt'), 'feature content\n')
      yield* git(source, ['add', 'feature.txt'])
      yield* git(source, ['commit', '-m', 'feature commit'])
      yield* git(source, ['push', '-u', remoteName, featureBranch])
      yield* git(source, ['checkout', defaultBranch])
      yield* git(source, ['branch', '-D', featureBranch])

      yield* (yield* GitCore).checkoutBranch({
        cwd: source,
        branch: `${remoteName}/${featureBranch}`,
      })
      expect(yield* git(source, ['branch', '--show-current'])).toBe('upstream/feature')
    })
  )
)

it.effect(
  'falls back to detached checkout when --track would conflict with an existing local branch',
  () =>
    withGitTestLayer(
      Effect.gen(function* () {
        const remote = yield* makeTmpDir()
        const source = yield* makeTmpDir()
        yield* git(remote, ['init', '--bare'])

        yield* initRepoWithCommit(source)
        const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: source })).branches.find(
          branch => branch.current
        )!.name
        yield* git(source, ['remote', 'add', 'origin', remote])
        yield* git(source, ['push', '-u', 'origin', defaultBranch])
        yield* git(source, ['branch', '--unset-upstream'])

        yield* (yield* GitCore).checkoutBranch({ cwd: source, branch: `origin/${defaultBranch}` })
        const core = yield* GitCore
        const status = yield* core.statusDetails(source)
        expect(status.branch).toBeNull()
      })
    )
)

it.effect('throws when checkout would overwrite uncommitted changes', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      yield* (yield* GitCore).createBranch({ cwd: tmp, branch: 'other' })

      yield* writeTextFile(path.join(tmp, 'README.md'), 'modified\n')
      yield* git(tmp, ['add', 'README.md'])
      yield* git(tmp, ['stash'])
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'other' })
      yield* writeTextFile(path.join(tmp, 'README.md'), 'other content\n')
      yield* git(tmp, ['add', '.'])
      yield* git(tmp, ['commit', '-m', 'other change'])

      const defaultBranch = (yield* (yield* GitCore).listBranches({ cwd: tmp })).branches.find(
        b => !b.current
      )!.name
      yield* (yield* GitCore).checkoutBranch({ cwd: tmp, branch: defaultBranch })
      yield* writeTextFile(path.join(tmp, 'README.md'), 'conflicting local\n')

      const result = yield* Effect.result(
        (yield* GitCore).checkoutBranch({ cwd: tmp, branch: 'other' })
      )
      expect(result._tag).toBe('Failure')
    })
  )
)
