import fs from 'node:fs'
import path from 'node:path'

import { it } from '@effect/vitest'

import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  GitManagerTestLayer,
  createBareRemote,
  initRepo,
  makeManager,
  makeTempDir,
  preparePullRequestThread,
  runGit,
} from './GitManager.test.helpers.ts'

const layer = it.layer(GitManagerTestLayer)

layer('GitManager pull request threads', it => {
  it.effect('reuses an existing dedicated worktree for the PR head branch', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-existing-worktree'])
      fs.writeFileSync(path.join(repoDir, 'existing.txt'), 'existing\n')
      yield* runGit(repoDir, ['add', 'existing.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Existing worktree branch'])
      yield* runGit(repoDir, ['checkout', 'main'])
      const worktreePath = path.join(repoDir, '..', `pr-existing-${Date.now()}`)
      yield* runGit(repoDir, ['worktree', 'add', worktreePath, 'feature/pr-existing-worktree'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 78,
            title: 'Existing worktree PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/78',
            baseRefName: 'main',
            headRefName: 'feature/pr-existing-worktree',
            state: 'open',
          },
        },
      })

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '78',
        mode: 'worktree',
      })

      expect(result.worktreePath && fs.realpathSync.native(result.worktreePath)).toBe(
        fs.realpathSync.native(worktreePath)
      )
      expect(result.branch).toBe('feature/pr-existing-worktree')
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect(
    'does not block fork PR worktree prep when the fork head branch collides with root main',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        const originDir = yield* createBareRemote()
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
        yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['checkout', '-b', 'fork-main-source'])
        fs.writeFileSync(path.join(repoDir, 'fork-main.txt'), 'fork main\n')
        yield* runGit(repoDir, ['add', 'fork-main.txt'])
        yield* runGit(repoDir, ['commit', '-m', 'Fork main branch'])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'fork-main-source:main'])
        yield* runGit(repoDir, ['checkout', 'main'])
        const mainBefore = (yield* runGit(repoDir, ['rev-parse', 'main'])).stdout.trim()

        const { manager } = yield* makeManager({
          ghScenario: {
            pullRequest: {
              number: 91,
              title: 'Fork main PR',
              url: 'https://github.com/Reliability-Works/orxacode/pull/91',
              baseRefName: 'main',
              headRefName: 'main',
              state: 'open',
              isCrossRepository: true,
              headRepositoryNameWithOwner: 'octocat/codething-mvp',
              headRepositoryOwnerLogin: 'octocat',
            },
            repositoryCloneUrls: {
              'octocat/codething-mvp': {
                url: forkDir,
                sshUrl: forkDir,
              },
            },
          },
        })

        const result = yield* preparePullRequestThread(manager, {
          cwd: repoDir,
          reference: '91',
          mode: 'worktree',
        })

        expect(result.branch).toBe('orxa/pr-91/main')
        expect(result.worktreePath).not.toBeNull()
        expect((yield* runGit(repoDir, ['branch', '--show-current'])).stdout.trim()).toBe('main')
        expect((yield* runGit(repoDir, ['rev-parse', 'main'])).stdout.trim()).toBe(mainBefore)
        expect(
          (yield* runGit(result.worktreePath as string, ['branch', '--show-current'])).stdout.trim()
        ).toBe('orxa/pr-91/main')
      })
  )
})
layer('GitManager pull request threads', it => {
  it.effect(
    'does not overwrite an existing local main branch when preparing a fork PR worktree',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        const originDir = yield* createBareRemote()
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
        yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['checkout', '-b', 'fork-main-source'])
        fs.writeFileSync(path.join(repoDir, 'fork-main-second.txt'), 'fork main second\n')
        yield* runGit(repoDir, ['add', 'fork-main-second.txt'])
        yield* runGit(repoDir, ['commit', '-m', 'Fork main second branch'])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'fork-main-source:main'])
        yield* runGit(repoDir, ['checkout', 'main'])
        const localMainBefore = (yield* runGit(repoDir, ['rev-parse', 'main'])).stdout.trim()
        yield* runGit(repoDir, ['checkout', '-b', 'feature/root-branch'])

        const { manager } = yield* makeManager({
          ghScenario: {
            pullRequest: {
              number: 92,
              title: 'Fork main overwrite PR',
              url: 'https://github.com/Reliability-Works/orxacode/pull/92',
              baseRefName: 'main',
              headRefName: 'main',
              state: 'open',
              isCrossRepository: true,
              headRepositoryNameWithOwner: 'octocat/codething-mvp',
              headRepositoryOwnerLogin: 'octocat',
            },
            repositoryCloneUrls: {
              'octocat/codething-mvp': {
                url: forkDir,
                sshUrl: forkDir,
              },
            },
          },
        })

        const result = yield* preparePullRequestThread(manager, {
          cwd: repoDir,
          reference: '92',
          mode: 'worktree',
        })

        expect(result.branch).toBe('orxa/pr-92/main')
        expect((yield* runGit(repoDir, ['rev-parse', 'main'])).stdout.trim()).toBe(localMainBefore)
        expect(
          (yield* runGit(result.worktreePath as string, [
            'rev-parse',
            '--abbrev-ref',
            '@{upstream}',
          ])).stdout.trim()
        ).toBe('fork-seed/main')
      })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('reuses an existing PR worktree and restores fork upstream tracking', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const originDir = yield* createBareRemote()
      const forkDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-reused-fork'])
      fs.writeFileSync(path.join(repoDir, 'reused-fork.txt'), 'reused fork\n')
      yield* runGit(repoDir, ['add', 'reused-fork.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Reused fork PR branch'])
      yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'feature/pr-reused-fork'])
      yield* runGit(repoDir, ['checkout', 'main'])
      const worktreePath = path.join(repoDir, '..', `pr-reused-fork-${Date.now()}`)
      yield* runGit(repoDir, ['worktree', 'add', worktreePath, 'feature/pr-reused-fork'])
      yield* runGit(worktreePath, ['branch', '--unset-upstream'], true)

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 83,
            title: 'Reused Fork PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/83',
            baseRefName: 'main',
            headRefName: 'feature/pr-reused-fork',
            state: 'open',
            isCrossRepository: true,
            headRepositoryNameWithOwner: 'octocat/codething-mvp',
            headRepositoryOwnerLogin: 'octocat',
          },
          repositoryCloneUrls: {
            'octocat/codething-mvp': {
              url: forkDir,
              sshUrl: forkDir,
            },
          },
        },
      })

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '83',
        mode: 'worktree',
      })

      expect(result.worktreePath && fs.realpathSync.native(result.worktreePath)).toBe(
        fs.realpathSync.native(worktreePath)
      )
      expect(
        (yield* runGit(worktreePath, ['rev-parse', '--abbrev-ref', '@{upstream}'])).stdout.trim()
      ).toBe('fork-seed/feature/pr-reused-fork')
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('rejects worktree prep when the PR head branch is checked out in the main repo', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-root-only'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 79,
            title: 'Root-only PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/79',
            baseRefName: 'main',
            headRefName: 'feature/pr-root-only',
            state: 'open',
          },
        },
      })

      const errorMessage = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '79',
        mode: 'worktree',
      }).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )

      expect(errorMessage).toContain('already checked out in the main repo')
    })
  )
})
