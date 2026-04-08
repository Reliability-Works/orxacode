import { it } from '@effect/vitest'
import fs from 'node:fs'
import path from 'node:path'

import { Effect } from 'effect'
import { expect } from 'vitest'
import { GitHubCliError } from '@orxa-code/contracts'

import {
  GitManagerTestLayer,
  createBareRemote,
  initRepo,
  makeManager,
  makeTempDir,
  runGit,
} from './GitManager.test.helpers.ts'

const layer = it.layer(GitManagerTestLayer)

layer('GitManager status', it => {
  it.effect('status includes PR metadata when branch already has an open PR', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/status-open-pr'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/status-open-pr'])

      const { manager } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            JSON.stringify([
              {
                number: 13,
                title: 'Existing PR',
                url: 'https://github.com/Reliability-Works/orxacode/pull/13',
                baseRefName: 'main',
                headRefName: 'feature/status-open-pr',
              },
            ]),
          ],
        },
      })

      const status = yield* manager.status({ cwd: repoDir })
      expect(status.branch).toBe('feature/status-open-pr')
      expect(status.pr).toEqual({
        number: 13,
        title: 'Existing PR',
        url: 'https://github.com/Reliability-Works/orxacode/pull/13',
        baseBranch: 'main',
        headBranch: 'feature/status-open-pr',
        state: 'open',
      })
    })
  )
})

layer('GitManager status', it => {
  it.effect(
    'status detects cross-repo PRs from the upstream remote URL owner',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['checkout', '-b', 'statemachine'])
        fs.writeFileSync(path.join(repoDir, 'fork-pr.txt'), 'fork pr\n')
        yield* runGit(repoDir, ['add', 'fork-pr.txt'])
        yield* runGit(repoDir, ['commit', '-m', 'Fork PR branch'])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'statemachine'])
        yield* runGit(repoDir, ['checkout', '-b', 'orxa/pr-488/statemachine'])
        yield* runGit(repoDir, ['branch', '--set-upstream-to', 'fork-seed/statemachine'])
        yield* runGit(repoDir, [
          'config',
          'remote.fork-seed.url',
          'git@github.com:jasonLaster/codething-mvp.git',
        ])

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListSequence: [
              JSON.stringify([]),
              JSON.stringify([]),
              JSON.stringify([
                {
                  number: 488,
                  title: 'Rebase this PR on latest main',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/488',
                  baseRefName: 'main',
                  headRefName: 'statemachine',
                  state: 'OPEN',
                  updatedAt: '2026-03-10T07:00:00Z',
                },
              ]),
            ],
          },
        })

        const status = yield* manager.status({ cwd: repoDir })
        expect(status.branch).toBe('orxa/pr-488/statemachine')
        expect(status.pr).toEqual({
          number: 488,
          title: 'Rebase this PR on latest main',
          url: 'https://github.com/Reliability-Works/orxacode/pull/488',
          baseBranch: 'main',
          headBranch: 'statemachine',
          state: 'open',
        })
        expect(ghCalls).toContain(
          'pr list --head jasonLaster:statemachine --state all --limit 20 --json number,title,url,baseRefName,headRefName,state,mergedAt,updatedAt'
        )
      }),
    12_000
  )
})

layer('GitManager status', it => {
  it.effect('status returns merged PR state when latest PR was merged', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/status-merged-pr'])

      const { manager } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            JSON.stringify([
              {
                number: 22,
                title: 'Merged PR',
                url: 'https://github.com/Reliability-Works/orxacode/pull/22',
                baseRefName: 'main',
                headRefName: 'feature/status-merged-pr',
                state: 'MERGED',
                mergedAt: '2026-01-30T10:00:00Z',
                updatedAt: '2026-01-30T10:00:00Z',
              },
            ]),
          ],
        },
      })

      const status = yield* manager.status({ cwd: repoDir })
      expect(status.branch).toBe('feature/status-merged-pr')
      expect(status.pr).toEqual({
        number: 22,
        title: 'Merged PR',
        url: 'https://github.com/Reliability-Works/orxacode/pull/22',
        baseBranch: 'main',
        headBranch: 'feature/status-merged-pr',
        state: 'merged',
      })
    })
  )
})

layer('GitManager status', it => {
  it.effect('status prefers open PR when merged PR has newer updatedAt', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/status-open-over-merged'])

      const { manager } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            JSON.stringify([
              {
                number: 45,
                title: 'Merged PR',
                url: 'https://github.com/Reliability-Works/orxacode/pull/45',
                baseRefName: 'main',
                headRefName: 'feature/status-open-over-merged',
                state: 'MERGED',
                mergedAt: '2026-01-31T10:00:00Z',
                updatedAt: '2026-02-01T10:00:00Z',
              },
              {
                number: 46,
                title: 'Open PR',
                url: 'https://github.com/Reliability-Works/orxacode/pull/46',
                baseRefName: 'main',
                headRefName: 'feature/status-open-over-merged',
                state: 'OPEN',
                updatedAt: '2026-01-30T10:00:00Z',
              },
            ]),
          ],
        },
      })

      const status = yield* manager.status({ cwd: repoDir })
      expect(status.branch).toBe('feature/status-open-over-merged')
      expect(status.pr).toEqual({
        number: 46,
        title: 'Open PR',
        url: 'https://github.com/Reliability-Works/orxacode/pull/46',
        baseBranch: 'main',
        headBranch: 'feature/status-open-over-merged',
        state: 'open',
      })
    })
  )
})

layer('GitManager status', it => {
  it.effect('status is resilient to gh lookup failures and returns pr null', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/status-no-gh'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/status-no-gh'])

      const { manager } = yield* makeManager({
        ghScenario: {
          failWith: new GitHubCliError({
            operation: 'execute',
            detail: 'GitHub CLI (`gh`) is required but not available on PATH.',
          }),
        },
      })

      const status = yield* manager.status({ cwd: repoDir })
      expect(status.branch).toBe('feature/status-no-gh')
      expect(status.pr).toBeNull()
    })
  )
})
