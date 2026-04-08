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
  runGit,
  runStackedAction,
} from './GitManager.test.helpers.ts'

const layer = it.layer(GitManagerTestLayer)

layer('GitManager stacked actions', it => {
  it.effect('creates a commit when working tree is dirty', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\nworld\n')

      const { manager } = yield* makeManager()
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.commit.status).toBe('created')
      expect(result.push.status).toBe('skipped_not_requested')
      expect(result.pr.status).toBe('skipped_not_requested')
      expect(
        yield* runGit(repoDir, ['log', '-1', '--pretty=%s']).pipe(
          Effect.map(result => result.stdout.trim())
        )
      ).toBe('Implement stacked git actions')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('uses custom commit message when provided', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\ncustom\n')
      let generatedCount = 0

      const { manager } = yield* makeManager({
        textGeneration: {
          generateCommitMessage: input =>
            Effect.sync(() => {
              generatedCount += 1
              return {
                subject: 'this should not be used',
                body: '',
                ...(input.includeBranch ? { branch: 'feature/unused' } : {}),
              }
            }),
        },
      })
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
        commitMessage: 'feat: custom summary line\n\n- details from user',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.commit.status).toBe('created')
      expect(result.commit.subject).toBe('feat: custom summary line')
      expect(generatedCount).toBe(0)
      expect(
        yield* runGit(repoDir, ['log', '-1', '--pretty=%s']).pipe(
          Effect.map(result => result.stdout.trim())
        )
      ).toBe('feat: custom summary line')
      expect(
        yield* runGit(repoDir, ['log', '-1', '--pretty=%b']).pipe(
          Effect.map(result => result.stdout.trim())
        )
      ).toContain('- details from user')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('commits only selected files when filePaths is provided', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'file a\n')
      fs.writeFileSync(path.join(repoDir, 'b.txt'), 'file b\n')

      const { manager } = yield* makeManager()
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
        filePaths: ['a.txt'],
      })

      expect(result.commit.status).toBe('created')

      // b.txt should remain in the working tree
      const statusStdout = yield* runGit(repoDir, ['status', '--porcelain']).pipe(
        Effect.map(r => r.stdout)
      )
      expect(statusStdout).toContain('b.txt')
      expect(statusStdout).not.toContain('a.txt')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('creates feature branch, commits, and pushes with featureBranch option', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'main'])
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\nfeature-branch\n')
      let generatedCount = 0

      const { manager } = yield* makeManager({
        textGeneration: {
          generateCommitMessage: input =>
            Effect.sync(() => {
              generatedCount += 1
              return {
                subject: 'Implement stacked git actions',
                body: '',
                ...(input.includeBranch ? { branch: 'feature/implement-stacked-git-actions' } : {}),
              }
            }),
        },
      })
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push',
        featureBranch: true,
      })

      expect(result.branch.status).toBe('created')
      expect(result.branch.name).toBe('feature/implement-stacked-git-actions')
      expect(result.commit.status).toBe('created')
      expect(result.push.status).toBe('pushed')
      expect(
        yield* runGit(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']).pipe(
          Effect.map(result => result.stdout.trim())
        )
      ).toBe('feature/implement-stacked-git-actions')

      const mainSha = yield* runGit(repoDir, ['rev-parse', 'main']).pipe(
        Effect.map(r => r.stdout.trim())
      )
      const mergeBase = yield* runGit(repoDir, ['merge-base', 'main', 'HEAD']).pipe(
        Effect.map(r => r.stdout.trim())
      )
      expect(mergeBase).toBe(mainSha)
      expect(generatedCount).toBe(1)
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('featureBranch uses custom commit message and derives branch name', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\ncustom-feature\n')
      let generatedCount = 0

      const { manager } = yield* makeManager({
        textGeneration: {
          generateCommitMessage: input =>
            Effect.sync(() => {
              generatedCount += 1
              return {
                subject: 'unused',
                body: '',
                ...(input.includeBranch ? { branch: 'feature/unused' } : {}),
              }
            }),
        },
      })
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
        featureBranch: true,
        commitMessage: 'feat: custom summary line\n\n- details from user',
      })

      expect(result.branch.status).toBe('created')
      expect(result.branch.name).toBe('feature/feat-custom-summary-line')
      expect(result.commit.status).toBe('created')
      expect(result.commit.subject).toBe('feat: custom summary line')
      expect(generatedCount).toBe(0)

      const mainSha = yield* runGit(repoDir, ['rev-parse', 'main']).pipe(
        Effect.map(r => r.stdout.trim())
      )
      const mergeBase = yield* runGit(repoDir, ['merge-base', 'main', result.branch.name!]).pipe(
        Effect.map(r => r.stdout.trim())
      )
      expect(mergeBase).toBe(mainSha)
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('skips commit when there are no uncommitted changes', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)

      const { manager } = yield* makeManager()
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.commit.status).toBe('skipped_no_changes')
      expect(result.push.status).toBe('skipped_not_requested')
      expect(result.pr.status).toBe('skipped_not_requested')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('featureBranch returns error when worktree is clean', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)

      const { manager } = yield* makeManager()
      const errorMessage = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit',
        featureBranch: true,
      }).pipe(
        Effect.flip,
        Effect.map(error => error.message)
      )

      expect(errorMessage).toContain('no changes to commit')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('commits and pushes with upstream auto-setup when needed', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/stacked-flow'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature\n')

      const { manager } = yield* makeManager()
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.commit.status).toBe('created')
      expect(result.push.status).toBe('pushed')
      expect(result.push.setUpstream).toBe(true)
      expect(
        yield* runGit(repoDir, ['rev-parse', '--abbrev-ref', '@{upstream}']).pipe(
          Effect.map(result => result.stdout.trim())
        )
      ).toBe('origin/feature/stacked-flow')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect(
    'pushes and creates PR from a no-upstream branch when local commits are ahead of base',
    () =>
      Effect.gen(function* () {
        const repoDir = yield* makeTempDir('orxa-git-manager-')
        yield* initRepo(repoDir)
        yield* runGit(repoDir, ['checkout', '-b', 'feature/no-upstream-pr'])
        const remoteDir = yield* createBareRemote()
        yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
        fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature\n')

        const { manager, ghCalls } = yield* makeManager({
          ghScenario: {
            prListSequence: [
              '[]',
              JSON.stringify([
                {
                  number: 77,
                  title: 'Add no-upstream PR flow',
                  url: 'https://github.com/Reliability-Works/orxacode/pull/77',
                  baseRefName: 'main',
                  headRefName: 'feature/no-upstream-pr',
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
        expect(result.commit.status).toBe('created')
        expect(result.push.status).toBe('pushed')
        expect(result.push.setUpstream).toBe(true)
        expect(result.pr.status).toBe('created')
        expect(
          yield* runGit(repoDir, ['rev-parse', '--abbrev-ref', '@{upstream}']).pipe(
            Effect.map(result => result.stdout.trim())
          )
        ).toBe('origin/feature/no-upstream-pr')
        expect(
          ghCalls.some(call => call.includes('pr create --base main --head feature/no-upstream-pr'))
        ).toBe(true)
      })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('skips push when branch is already up to date', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/up-to-date'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/up-to-date'])

      const { manager } = yield* makeManager()
      const result = yield* runStackedAction(manager, {
        cwd: repoDir,
        action: 'commit_push',
      })

      expect(result.branch.status).toBe('skipped_not_requested')
      expect(result.commit.status).toBe('skipped_no_changes')
      expect(result.push.status).toBe('skipped_up_to_date')
    })
  )
})

layer('GitManager stacked actions', it => {
  it.effect('returns existing PR metadata for commit/push/pr action', () =>
    Effect.gen(function* () {
      const repoDir = yield* makeTempDir('orxa-git-manager-')
      yield* initRepo(repoDir)
      yield* runGit(repoDir, ['checkout', '-b', 'feature/existing-pr'])
      const remoteDir = yield* createBareRemote()
      yield* runGit(repoDir, ['remote', 'add', 'origin', remoteDir])
      yield* runGit(repoDir, ['push', '-u', 'origin', 'feature/existing-pr'])

      const { manager, ghCalls } = yield* makeManager({
        ghScenario: {
          prListSequence: [
            JSON.stringify([
              {
                number: 42,
                title: 'Existing PR',
                url: 'https://github.com/Reliability-Works/orxacode/pull/42',
                baseRefName: 'main',
                headRefName: 'feature/existing-pr',
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
      expect(result.pr.status).toBe('opened_existing')
      expect(result.pr.number).toBe(42)
      expect(ghCalls.some(call => call.startsWith('pr view '))).toBe(false)
    })
  )
})
