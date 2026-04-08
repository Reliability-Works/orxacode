import { spawnSync } from 'node:child_process'

import { GitHubCliError } from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { GitHubCliShape, GitHubPullRequestSummary } from '../Services/GitHubCli.ts'
import {
  buildCreatePullRequestArgs,
  buildGetPullRequestArgs,
  buildListOpenPullRequestsArgs,
} from './GitHubCli.args.ts'

export interface FakeGhScenario {
  prListSequence?: string[]
  prListByHeadSelector?: Record<string, string>
  createdPrUrl?: string
  defaultBranch?: string
  pullRequest?: {
    number: number
    title: string
    url: string
    baseRefName: string
    headRefName: string
    state?: 'open' | 'closed' | 'merged'
    isCrossRepository?: boolean
    headRepositoryNameWithOwner?: string | null
    headRepositoryOwnerLogin?: string | null
  }
  repositoryCloneUrls?: Record<string, { url: string; sshUrl: string }>
  failWith?: GitHubCliError
}

type FakePullRequest = NonNullable<FakeGhScenario['pullRequest']>
type FakeGhExecuteInput = Parameters<GitHubCliShape['execute']>[0]
type GitCommandResult = {
  stdout: string
  stderr: string
  code: number
  signal: NodeJS.Signals | null
  timedOut: boolean
}

function buildGhResult(stdout: string): GitCommandResult {
  return {
    stdout,
    stderr: '',
    code: 0,
    signal: null,
    timedOut: false,
  }
}

function runGitSyncForFakeGh(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  })
  if (result.status === 0) {
    return
  }
  throw new GitHubCliError({
    operation: 'execute',
    detail: `Failed to simulate gh checkout with git ${args.join(' ')}: ${result.stderr?.trim() || 'unknown error'}`,
  })
}

function isGitHubCliError(error: unknown): error is GitHubCliError {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as { _tag?: unknown })._tag === 'GitHubCliError'
  )
}

function readHeadSelector(args: readonly string[]): string | undefined {
  const headSelectorIndex = args.findIndex(value => value === '--head')
  return headSelectorIndex >= 0 && headSelectorIndex < args.length - 1
    ? args[headSelectorIndex + 1]
    : undefined
}

function serializePullRequest(pullRequest: FakePullRequest): string {
  return JSON.stringify({
    ...pullRequest,
    ...(pullRequest.headRepositoryNameWithOwner
      ? {
          headRepository: {
            nameWithOwner: pullRequest.headRepositoryNameWithOwner,
          },
        }
      : {}),
    ...(pullRequest.headRepositoryOwnerLogin
      ? {
          headRepositoryOwner: {
            login: pullRequest.headRepositoryOwnerLogin,
          },
        }
      : {}),
  })
}

function resolvePrListResult(
  args: readonly string[],
  scenario: FakeGhScenario,
  prListQueue: string[]
): GitCommandResult {
  const headSelector = readHeadSelector(args)
  const mappedStdout =
    typeof headSelector === 'string' ? scenario.prListByHeadSelector?.[headSelector] : undefined
  return buildGhResult(`${mappedStdout ?? prListQueue.shift() ?? '[]'}\n`)
}

function resolvePrViewResult(scenario: FakeGhScenario): GitCommandResult {
  const pullRequest: FakePullRequest = scenario.pullRequest ?? {
    number: 101,
    title: 'Pull request',
    url: 'https://github.com/Reliability-Works/orxacode/pull/101',
    baseRefName: 'main',
    headRefName: 'feature/pull-request',
    state: 'open',
  }
  return buildGhResult(`${serializePullRequest(pullRequest)}\n`)
}

function resolveRepoViewResult(args: readonly string[], scenario: FakeGhScenario) {
  const repository = args[2]
  if (typeof repository === 'string' && args.includes('nameWithOwner,url,sshUrl')) {
    const cloneUrls = scenario.repositoryCloneUrls?.[repository]
    if (!cloneUrls) {
      return Effect.fail(
        new GitHubCliError({
          operation: 'execute',
          detail: `Unexpected repository lookup: ${repository}`,
        })
      )
    }
    return Effect.succeed(
      buildGhResult(
        `${JSON.stringify({
          nameWithOwner: repository,
          url: cloneUrls.url,
          sshUrl: cloneUrls.sshUrl,
        })}\n`
      )
    )
  }

  return Effect.succeed(buildGhResult(`${scenario.defaultBranch ?? 'main'}\n`))
}

function resolvePrCheckoutResult(
  input: FakeGhExecuteInput,
  scenario: FakeGhScenario
): Effect.Effect<GitCommandResult, GitHubCliError> {
  return Effect.try({
    try: () => {
      const headBranch = scenario.pullRequest?.headRefName
      if (headBranch) {
        const existingBranch = spawnSync(
          'git',
          ['show-ref', '--verify', '--quiet', `refs/heads/${headBranch}`],
          {
            cwd: input.cwd,
            encoding: 'utf8',
          }
        )
        if (existingBranch.status === 0) {
          runGitSyncForFakeGh(input.cwd, ['checkout', headBranch])
        } else {
          runGitSyncForFakeGh(input.cwd, ['checkout', '-b', headBranch])
        }
      }
      return buildGhResult('')
    },
    catch: error =>
      isGitHubCliError(error)
        ? error
        : new GitHubCliError({
            operation: 'execute',
            detail:
              error instanceof Error
                ? `Failed to simulate gh checkout: ${error.message}`
                : 'Failed to simulate gh checkout.',
          }),
  })
}

function executeFakeGhCommand(
  input: FakeGhExecuteInput,
  scenario: FakeGhScenario,
  prListQueue: string[]
): Effect.Effect<GitCommandResult, GitHubCliError> {
  const args = [...input.args]
  if (scenario.failWith) {
    return Effect.fail(scenario.failWith)
  }
  if (args[0] === 'pr' && args[1] === 'list') {
    return Effect.succeed(resolvePrListResult(args, scenario, prListQueue))
  }
  if (args[0] === 'pr' && args[1] === 'create') {
    return Effect.succeed(
      buildGhResult(
        `${scenario.createdPrUrl ?? 'https://github.com/Reliability-Works/orxacode/pull/101'}\n`
      )
    )
  }
  if (args[0] === 'pr' && args[1] === 'view') {
    return Effect.succeed(resolvePrViewResult(scenario))
  }
  if (args[0] === 'pr' && args[1] === 'checkout') {
    return resolvePrCheckoutResult(input, scenario)
  }
  if (args[0] === 'repo' && args[1] === 'view') {
    return resolveRepoViewResult(args, scenario)
  }
  return Effect.fail(
    new GitHubCliError({
      operation: 'execute',
      detail: `Unexpected gh command: ${args.join(' ')}`,
    })
  )
}

function createFakeGhService(execute: GitHubCliShape['execute']): Omit<GitHubCliShape, 'execute'> {
  return {
    listOpenPullRequests: input =>
      execute({ cwd: input.cwd, args: buildListOpenPullRequestsArgs(input) }).pipe(
        Effect.map(result => JSON.parse(result.stdout) as ReadonlyArray<GitHubPullRequestSummary>)
      ),
    createPullRequest: input =>
      execute({ cwd: input.cwd, args: buildCreatePullRequestArgs(input) }).pipe(Effect.asVoid),
    getDefaultBranch: input =>
      execute({
        cwd: input.cwd,
        args: ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
      }).pipe(
        Effect.map(result => {
          const value = result.stdout.trim()
          return value.length > 0 ? value : null
        })
      ),
    getPullRequest: input =>
      execute({ cwd: input.cwd, args: buildGetPullRequestArgs(input) }).pipe(
        Effect.map(result => JSON.parse(result.stdout) as GitHubPullRequestSummary)
      ),
    getRepositoryCloneUrls: input =>
      execute({
        cwd: input.cwd,
        args: ['repo', 'view', input.repository, '--json', 'nameWithOwner,url,sshUrl'],
      }).pipe(Effect.map(result => JSON.parse(result.stdout))),
    checkoutPullRequest: input =>
      execute({
        cwd: input.cwd,
        args: ['pr', 'checkout', input.reference, ...(input.force ? ['--force'] : [])],
      }).pipe(Effect.asVoid),
  }
}

export function createGitHubCliWithFakeGh(scenario: FakeGhScenario = {}): {
  service: GitHubCliShape
  ghCalls: string[]
} {
  const prListQueue = [...(scenario.prListSequence ?? [])]
  const ghCalls: string[] = []
  const execute: GitHubCliShape['execute'] = input => {
    ghCalls.push(input.args.join(' '))
    return executeFakeGhCommand(input, scenario, prListQueue)
  }

  return {
    service: {
      execute,
      ...createFakeGhService(execute),
    },
    ghCalls,
  }
}
