import fs from 'node:fs'
import path from 'node:path'

import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitHubCliError } from '@orxa-code/contracts'
import type { GitActionProgressEvent } from '@orxa-code/contracts'

import {
  GitManagerTestLayer,
  createBareRemote,
  initRepo,
  makeManager,
  makeTempDir,
  runGit,
  runStackedAction,
} from './GitManager.test.helpers.ts'

const layer = it.layer(GitManagerTestLayer)

layer('GitManager stacked actions', it => {
  it.effect(
    'returns existing cross-repo PR metadata using the fork owner selector',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        yield* runGit(repoDir, ['checkout', '-b', 'statemachine'])
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'statemachine'])
        yield* runGit(repoDir, [
          'config',
          'remote.fork-seed.url',
          'git@github.com:octocat/codething-mvp.git',
        ])

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListSequence: [
              JSON.stringify([]),
              JSON.stringify([
                {
                  number: 142,
                  title: 'Existing fork PR',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/142',
                  baseRefName: 'main',
                  headRefName: 'statemachine',
                },
              ]),
            ],
          },
        })

        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: 'commit_push_pr',
        })

        expect(result.pr.status).toBe('opened_existing')
        expect(result.pr.number).toBe(142)
        expect(
          ghCalls.some(call =>
            call.includes('pr list --head octocat:statemachine --state open --limit 1')
          )
        ).toBe(true)
        expect(ghCalls.some(call => call.startsWith('pr create '))).toBe(false)
      }),
    12_000
  )
})

layer('GitManager stacked actions', it => {
  it.effect(
    'prefers owner-qualified selectors before bare branch names for cross-repo PRs',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        yield* runGit(repoDir, ['checkout', '-b', 'statemachine'])
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'statemachine'])
        yield* runGit(repoDir, ['checkout', '-b', 'orxa/pr-142/statemachine'])
        yield* runGit(repoDir, ['branch', '--set-upstream-to', 'fork-seed/statemachine'])
        yield* runGit(repoDir, [
          'config',
          'remote.fork-seed.url',
          'git@github.com:octocat/codething-mvp.git',
        ])

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListByHeadSelector: {
              'orxa/pr-142/statemachine': JSON.stringify([]),
              statemachine: JSON.stringify([
                {
                  number: 41,
                  title: 'Unrelated same-repo PR',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/41',
                  baseRefName: 'main',
                  headRefName: 'statemachine',
                },
              ]),
              'octocat:statemachine': JSON.stringify([
                {
                  number: 142,
                  title: 'Existing fork PR',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/142',
                  baseRefName: 'main',
                  headRefName: 'statemachine',
                },
              ]),
              'fork-seed:statemachine': JSON.stringify([]),
            },
          },
        })

        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: 'commit_push_pr',
        })

        expect(result.pr.status).toBe('opened_existing')
        expect(result.pr.number).toBe(142)

        const ownerSelectorCallIndex = ghCalls.findIndex(call =>
          call.includes('pr list --head octocat:statemachine --state open --limit 1')
        )
        expect(ownerSelectorCallIndex).toBeGreaterThanOrEqual(0)
        expect(ghCalls.some(call => call.startsWith('pr create '))).toBe(false)
      }),
    12_000
  )
})

layer('GitManager stacked actions', it => {
  it.effect(
    'stops probing head selectors after finding an existing PR',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        yield* runGit(repoDir, ['checkout', '-b', 'statemachine'])
        const forkDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
        yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'statemachine'])
        yield* runGit(repoDir, ['checkout', '-b', 'orxa/pr-142/statemachine'])
        yield* runGit(repoDir, ['branch', '--set-upstream-to', 'fork-seed/statemachine'])
        yield* runGit(repoDir, [
          'config',
          'remote.fork-seed.url',
          'git@github.com:octocat/codething-mvp.git',
        ])

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListByHeadSelector: {
              'octocat:statemachine': JSON.stringify([
                {
                  number: 142,
                  title: 'Existing fork PR',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/142',
                  baseRefName: 'main',
                  headRefName: 'statemachine',
                },
              ]),
              'fork-seed:statemachine': JSON.stringify([]),
              'orxa/pr-142/statemachine': JSON.stringify([]),
              statemachine: JSON.stringify([]),
            },
          },
        })

        const result = yield* runStackedAction(manager, {
          cwd: repoDir,
          action: 'commit_push_pr',
        })

        expect(result.pr.status).toBe('opened_existing')
        expect(result.pr.number).toBe(142)

        const prListCalls = ghCalls.filter(call => call.startsWith('pr list '))
        expect(prListCalls).toHaveLength(1)
        expect(prListCalls[0]).toContain(
          'pr list --head octocat:statemachine --state open --limit 1'
        )
      }),
    12_000
  )
})

layer('GitManager stacked actions', it => {
  it.effect('creates PR when one does not already exist', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature-create-pr'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      fs.writeFileSync(path.join(repoDir, 'changes.txt'), 'change\n')
      yield* runGit(repoDir, ['add', 'changes.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Feature commit'])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature-create-pr'])
      yield* runGit(repoDir, ['config', 'branch.feature-create-pr.gh-merge-base', 'main'])

      const { manager, ghCalls } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            '[]',
            JSON.stringify([
              {
                number: 88,
                title: 'Add stacked git actions',
                url: 'https://github.com/Reliability-Works/orxacode/pull/88',
                baseRefName: 'main',
                headRefName: 'feature-create-pr',
              },
            ]),
          ],
        },
      })
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push_pr',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.pr.status).toBe('created')
      expect(result.pr.number).toBe(88)
      expect(
        ghCalls.some(call => call.includes('pr create --base main --head feature-create-pr'))
      ).toBe(true)
      expect(ghCalls.some(call => call.startsWith('pr view '))).toBe(false)
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('creates cross-repo PRs with the fork owner selector and default base branch', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const forkDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'fork-seed', forkDir])
      yield* runGit(repoDir, ['checkout', '-b', 'statemachine'])
      fs.writeFileSync(path.join(repoDir, 'changes.txt'), 'change\n')
      yield* runGit(repoDir, ['add', 'changes.txt'])
      yield* runGit(repoDir, ['commit', '-m', 'Feature commit'])
      yield* runGit(repoDir, ['push', '-u', 'fork-seed', 'statemachine'])
      yield* runGit(repoDir, ['checkout', '-b', 'orxa/pr-91/statemachine'])
      yield* runGit(repoDir, ['branch', '--set-upstream-to', 'fork-seed/statemachine'])
      yield* runGit(repoDir, [
        'config',
        'remote.fork-seed.url',
        'git@github.com:octocat/codething-mvp.git',
      ])

      const { manager, ghCalls } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            JSON.stringify([]),
            JSON.stringify([]),
            JSON.stringify([]),
            JSON.stringify([]),
            JSON.stringify([]),
            JSON.stringify([]),
            JSON.stringify([
              {
                number: 188,
                title: 'Add stacked git actions',
                url: 'https://github.com/Reliability-Works/orxacode/pull/188',
                baseRefName: 'main',
                headRefName: 'statemachine',
              },
            ]),
          ],
        },
      })

      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push_pr',
      })

      expect(result.pr.status).toBe('created')
      expect(result.pr.number).toBe(188)
      expect(
        ghCalls.some(call => call.includes('pr create --base main --head octocat:statemachine'))
      ).toBe(true)
      expect(
        ghCalls.some(call =>
          call.includes('pr create --base statemachine --head octocat:statemachine')
        )
      ).toBe(false)
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('rejects push/pr actions from detached HEAD', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '--detach', 'HEAD'])

      const { manager } = yield* makeManager()
      const errorMessage = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push',
      }).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )
      expect(errorMessage).toContain('detached HEAD')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('surfaces missing gh binary errors', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/gh-missing'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/gh-missing'])

      const { manager } = yield* makeManager({
        ghScenario: {
          failWith: new GitHubCliError({
            operation: 'execute',
            detail: 'GitHub CLI (`gh`) is required but not available on PATH.',
          }),
        },
      })

      const errorMessage = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push_pr',
      }).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )
      expect(errorMessage).toContain('GitHub CLI (`gh`) is required')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('surfaces gh auth errors with guidance', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/gh-auth'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/gh-auth'])

      const { manager } = yield* makeManager({
        ghScenario: {
          failWith: new GitHubCliError({
            operation: 'execute',
            detail: 'GitHub CLI is not authenticated. Run `gh auth login` and retry.',
          }),
        },
      })

      const errorMessage = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push_pr',
      }).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )
      expect(errorMessage).toContain('gh auth login')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('emits ordered progress events for commit hooks', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'hooked.txt'), 'hooked\n')
      fs.writeFileSync(
        path.join(repoDir, '.git', 'hooks', 'pre-commit'),
        '#!/bin/sh\necho "hook: start" >&2\nsleep 1\necho "hook: end" >&2\n',
        { mode: 0o755 }
      )

      const { manager } = yield* makeManager()
      const events: GitActionProgressEvent[] = []

      const result = yield* runStackedAction(
        manager,
        {
          cwd: repoDir,
          action: 'commit',
        },
        {
          actionId: 'action-1',
          progressReporter: {
            publish: event =>
              Effect.sync(() => {
                events.push(event)
              }),
          },
        }
      )

      expect(result.commit.status).toBe('created')
      expect(events.map(event => event.kind)).toContain('action_started')
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'phase_started',
            phase: 'commit',
          }),
          expect.objectContaining({
            kind: 'hook_started',
            hookName: 'pre-commit',
          }),
          expect.objectContaining({
            kind: 'hook_output',
            text: 'hook: start',
          }),
          expect.objectContaining({
            kind: 'hook_output',
            text: 'hook: end',
          }),
          expect.objectContaining({
            kind: 'hook_finished',
            hookName: 'pre-commit',
          }),
          expect.objectContaining({
            kind: 'action_finished',
          }),
        ])
      )
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('emits action_failed when a commit hook rejects', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'hook-failure.txt'), 'broken\n')
      fs.writeFileSync(
        path.join(repoDir, '.git', 'hooks', 'pre-commit'),
        '#!/bin/sh\necho "hook: fail" >&2\nexit 1\n',
        { mode: 0o755 }
      )

      const { manager } = yield* makeManager()
      const events: GitActionProgressEvent[] = []

      const errorMessage = yield* runStackedAction(
        manager,
        {
          cwd: repoDir,
          action: 'commit',
        },
        {
          actionId: 'action-2',
          progressReporter: {
            publish: event =>
              Effect.sync(() => {
                events.push(event)
              }),
          },
        }
      ).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )

      expect(errorMessage).toContain('hook: fail')
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'hook_started',
            hookName: 'pre-commit',
          }),
          expect.objectContaining({
            kind: 'action_failed',
            phase: 'commit',
          }),
        ])
      )
    })
  )
})
