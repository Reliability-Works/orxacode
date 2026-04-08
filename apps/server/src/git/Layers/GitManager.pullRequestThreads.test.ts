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
  it.effect('prepares pull request threads in local mode by checking out the PR branch', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-local'])
      fs.writeFileSync(path.join(repoDir, 'local.txt'), 'local\n')
      yield* runGit(repoDir, ['add', 'local.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Local PR branch'])

      const { manager, ghCalls } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 64,
            title: 'Local PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/64',
            baseRefName: 'main',
            headRefName: 'feature/pr-local',
            state: 'open',
          },
        },
      })

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '#64',
        mode: 'local',
      })

      expect(result.branch).toBe('feature/pr-local')
      expect(result.worktreePath).toBeNull()
      const branch = (yield* runGit(repoDir, ['branch', '--show-current'])).stdout.trim()
      expect(branch).toBe('feature/pr-local')
      expect(ghCalls).toContain('pr checkout 64 --force')
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('prepares pull request threads in worktree mode on the PR head branch', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-worktree'])
      fs.writeFileSync(path.join(repoDir, 'worktree.txt'), 'worktree\n')
      yield* runGit(repoDir, ['add', 'worktree.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'PR worktree branch'])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/pr-worktree'])
      yield* runGit(repoDir, ['push', 'origin', 'HEAD:refs/pull/77/head'])
      yield* runGit(repoDir, ['checkout', 'main'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 77,
            title: 'Worktree PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/77',
            baseRefName: 'main',
            headRefName: 'feature/pr-worktree',
            state: 'open',
          },
        },
      })

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '77',
        mode: 'worktree',
      })

      expect(result.branch).toBe('feature/pr-worktree')
      expect(result.worktreePath).not.toBeNull()
      expect(fs.existsSync(result.worktreePath as string)).toBe(true)
      const worktreeBranch = (yield* runGit(result.worktreePath as string, [
        'branch',
        '--show-current',
      ])).stdout.trim()
      expect(worktreeBranch).toBe('feature/pr-worktree')
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('preserves fork upstream tracking when preparing a worktree PR thread', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const originDir = yield* createBareRemote()
      const forkDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-fork'])
      fs.writeFileSync(path.join(repoDir, 'fork.txt'), 'fork\n')
      yield* runGit(repoDir, ['add', 'fork.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Fork PR branch'])
      yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'feature/pr-fork'])
      yield* runGit(repoDir, ['checkout', 'main'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 81,
            title: 'Fork PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/81',
            baseRefName: 'main',
            headRefName: 'feature/pr-fork',
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
        reference: '81',
        mode: 'worktree',
      })

      expect(result.worktreePath).not.toBeNull()
      const upstreamRef = (yield* runGit(result.worktreePath as string, [
        'rev-parse',
        '--abbrev-ref',
        '@{upstream}',
      ])).stdout.trim()
      expect(upstreamRef).toBe('fork-seed/feature/pr-fork')
      expect(upstreamRef.startsWith('origin/')).toBe(false)
      expect(
        (yield* runGit(result.worktreePath as string, [
          'config',
          '--get',
          'remote.fork-seed.url',
        ])).stdout.trim()
      ).toBe(forkDir)
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('preserves fork upstream tracking when preparing a local PR thread', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const originDir = yield* createBareRemote()
      const forkDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
      yield* runGit(repoDir, ['checkout', '-b', 'feature/pr-local-fork'])
      fs.writeFileSync(path.join(repoDir, 'local-fork.txt'), 'local fork\n')
      yield* runGit(repoDir, ['add', 'local-fork.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Local fork PR branch'])
      yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'feature/pr-local-fork'])
      yield* runGit(repoDir, ['checkout', 'main'])
      yield* runGit(repoDir, ['branch', '-D', 'feature/pr-local-fork'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 82,
            title: 'Local Fork PR',
            url: 'https://github.com/Reliability-Works/orxacode/pull/82',
            baseRefName: 'main',
            headRefName: 'feature/pr-local-fork',
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
        reference: '82',
        mode: 'local',
      })

      expect(result.worktreePath).toBeNull()
      expect(result.branch).toBe('feature/pr-local-fork')
      expect(
        (yield* runGit(repoDir, ['rev-parse', '--abbrev-ref', '@{upstream}'])).stdout.trim()
      ).toBe('fork-seed/feature/pr-local-fork')
    })
  )
})
layer('GitManager pull request threads', it => {
  it.effect('derives fork repository identity from PR URL when GitHub omits nameWithOwner', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const originDir = yield* createBareRemote()
      const forkDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', originDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      yield* runGit(repoDir, ['remote', 'add', 'binbandit-seed', forkDir])
      yield* runGit(repoDir, ['checkout', '-b', 'fix/git-action-default-without-origin'])
      fs.writeFileSync(path.join(repoDir, 'derived-fork.txt'), 'derived fork\n')
      yield* runGit(repoDir, ['add', 'derived-fork.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Derived fork PR branch'])
      yield* runGit(repoDir, [
        'push',
        '-u',
        'binbandit-seed',
        'fix/git-action-default-without-origin',
      ])
      yield* runGit(repoDir, ['checkout', 'main'])
      yield* runGit(repoDir, ['branch', '-D', 'fix/git-action-default-without-origin'])

      const { manager } = yield* makeManager({
        ghScenario: {
          pullRequest: {
            number: 642,
            title: 'fix: use commit as the default git action without origin',
            url: 'https://github.com/Reliability-Works/orxacode/pull/642',
            baseRefName: 'main',
            headRefName: 'fix/git-action-default-without-origin',
            state: 'open',
            isCrossRepository: true,
            headRepositoryOwnerLogin: 'binbandit',
          },
          repositoryCloneUrls: {
            'binbandit/orxacode': {
              url: forkDir,
              sshUrl: forkDir,
            },
          },
        },
      })

      const result = yield* preparePullRequestThread(manager, {
        cwd: repoDir,
        reference: '642',
        mode: 'local',
      })

      expect(result.branch).toBe('fix/git-action-default-without-origin')
      expect(result.worktreePath).toBeNull()
      expect(
        (yield* runGit(repoDir, ['rev-parse', '--abbrev-ref', '@{upstream}'])).stdout.trim()
      ).toBe('binbandit-seed/fix/git-action-default-without-origin')
    })
  )
})
