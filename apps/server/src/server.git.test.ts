import { GitCommandError, WS_METHODS } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { assertFailure } from '@effect/vitest/utils'
import { Effect, Stream } from 'effect'

import {
  buildAppUnderTest,
  getWsServerUrl,
  provideServerTest,
  type TestServerLayerOverrides,
  withWsRpcClient,
} from './server.test.helpers.ts'

const gitSuccessLayers: TestServerLayerOverrides = {
  gitManager: {
    status: () =>
      Effect.succeed({
        branch: 'main',
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    runStackedAction: (input, options) =>
      Effect.gen(function* () {
        const result = {
          action: 'commit' as const,
          branch: { status: 'skipped_not_requested' as const },
          commit: {
            status: 'created' as const,
            commitSha: 'abc123',
            subject: 'feat: demo',
          },
          push: { status: 'skipped_not_requested' as const },
          pr: { status: 'skipped_not_requested' as const },
        }

        yield* options?.progressReporter?.publish({
          actionId: options.actionId ?? input.actionId,
          cwd: input.cwd,
          action: input.action,
          kind: 'phase_started',
          phase: 'commit',
          label: 'Committing...',
        }) ?? Effect.void

        yield* options?.progressReporter?.publish({
          actionId: options.actionId ?? input.actionId,
          cwd: input.cwd,
          action: input.action,
          kind: 'action_finished',
          result,
        }) ?? Effect.void

        return result
      }),
    resolvePullRequest: () =>
      Effect.succeed({
        pullRequest: {
          number: 1,
          title: 'Demo PR',
          url: 'https://example.com/pr/1',
          baseBranch: 'main',
          headBranch: 'feature/demo',
          state: 'open',
        },
      }),
    preparePullRequestThread: () =>
      Effect.succeed({
        pullRequest: {
          number: 1,
          title: 'Demo PR',
          url: 'https://example.com/pr/1',
          baseBranch: 'main',
          headBranch: 'feature/demo',
          state: 'open',
        },
        branch: 'feature/demo',
        worktreePath: null,
      }),
  },
  gitCore: {
    pullCurrentBranch: () =>
      Effect.succeed({
        status: 'pulled',
        branch: 'main',
        upstreamBranch: 'origin/main',
      }),
    listBranches: () =>
      Effect.succeed({
        branches: [
          {
            name: 'main',
            current: true,
            isDefault: true,
            worktreePath: null,
          },
        ],
        isRepo: true,
        hasOriginRemote: true,
      }),
    createWorktree: () =>
      Effect.succeed({
        worktree: { path: '/tmp/wt', branch: 'feature/demo' },
      }),
    removeWorktree: () => Effect.void,
    createBranch: () => Effect.void,
    checkoutBranch: () => Effect.void,
    initRepo: () => Effect.void,
  },
}

const buildGitSuccessApp = () => buildAppUnderTest({ layers: gitSuccessLayers })

it.effect('routes websocket rpc git status and pull', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildGitSuccessApp()
      const wsUrl = yield* getWsServerUrl('/ws')

      const status = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[WS_METHODS.gitStatus]({ cwd: '/tmp/repo' }))
      )
      assert.equal(status.branch, 'main')

      const pull = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[WS_METHODS.gitPull]({ cwd: '/tmp/repo' }))
      )
      assert.equal(pull.status, 'pulled')
    })
  )
)

it.effect('routes websocket rpc git stacked action and PR helpers', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildGitSuccessApp()
      const wsUrl = yield* getWsServerUrl('/ws')

      const stackedEvents = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitRunStackedAction]({
            actionId: 'action-1',
            cwd: '/tmp/repo',
            action: 'commit',
          }).pipe(
            Stream.runCollect,
            Effect.map(events => Array.from(events))
          )
        )
      )
      const lastStackedEvent = stackedEvents.at(-1)
      assert.equal(lastStackedEvent?.kind, 'action_finished')
      if (lastStackedEvent?.kind === 'action_finished') {
        assert.equal(lastStackedEvent.result.action, 'commit')
      }

      const resolvedPr = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitResolvePullRequest]({
            cwd: '/tmp/repo',
            reference: '1',
          })
        )
      )
      assert.equal(resolvedPr.pullRequest.number, 1)

      const prepared = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitPreparePullRequestThread]({
            cwd: '/tmp/repo',
            reference: '1',
            mode: 'local',
          })
        )
      )
      assert.equal(prepared.branch, 'feature/demo')
    })
  )
)

it.effect('routes websocket rpc git branch and worktree operations', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildGitSuccessApp()
      const wsUrl = yield* getWsServerUrl('/ws')

      const branches = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[WS_METHODS.gitListBranches]({ cwd: '/tmp/repo' }))
      )
      assert.equal(branches.branches[0]?.name, 'main')

      const worktree = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitCreateWorktree]({
            cwd: '/tmp/repo',
            branch: 'main',
            path: null,
          })
        )
      )
      assert.equal(worktree.worktree.branch, 'feature/demo')

      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitRemoveWorktree]({
            cwd: '/tmp/repo',
            path: '/tmp/wt',
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitCreateBranch]({
            cwd: '/tmp/repo',
            branch: 'feature/new',
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitCheckout]({
            cwd: '/tmp/repo',
            branch: 'main',
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.gitInit]({
            cwd: '/tmp/repo',
          })
        )
      )
    })
  )
)

it.effect('routes websocket rpc git.pull errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      const gitError = new GitCommandError({
        operation: 'pull',
        command: 'git pull --ff-only',
        cwd: '/tmp/repo',
        detail: 'upstream missing',
      })
      yield* buildAppUnderTest({
        layers: {
          gitCore: {
            pullCurrentBranch: () => Effect.fail(gitError),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[WS_METHODS.gitPull]({ cwd: '/tmp/repo' })).pipe(
          Effect.result
        )
      )

      assertFailure(result, gitError)
    })
  )
)
