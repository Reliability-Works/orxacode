import { Effect, Layer, Schema } from 'effect'
import { PositiveInt, TrimmedNonEmptyString } from '@orxa-code/contracts'

import { runProcess } from '../../processRunner'
import { GitHubCliError } from '@orxa-code/contracts'
import {
  GitHubCli,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
  type GitHubPullRequestSummary,
} from '../Services/GitHubCli.ts'
import {
  buildCreatePullRequestArgs,
  buildGetPullRequestArgs,
  buildListOpenPullRequestsArgs,
} from './GitHubCli.args.ts'

const DEFAULT_TIMEOUT_MS = 30_000

function normalizeGitHubCliError(operation: 'execute' | 'stdout', error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes('Command not found: gh')) {
      return new GitHubCliError({
        operation,
        detail: 'GitHub CLI (`gh`) is required but not available on PATH.',
        cause: error,
      })
    }

    const lower = error.message.toLowerCase()
    if (
      lower.includes('authentication failed') ||
      lower.includes('not logged in') ||
      lower.includes('gh auth login') ||
      lower.includes('no oauth token')
    ) {
      return new GitHubCliError({
        operation,
        detail: 'GitHub CLI is not authenticated. Run `gh auth login` and retry.',
        cause: error,
      })
    }

    if (
      lower.includes('could not resolve to a pullrequest') ||
      lower.includes('repository.pullrequest') ||
      lower.includes('no pull requests found for branch') ||
      lower.includes('pull request not found')
    ) {
      return new GitHubCliError({
        operation,
        detail: 'Pull request not found. Check the PR number or URL and try again.',
        cause: error,
      })
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    })
  }

  return new GitHubCliError({
    operation,
    detail: 'GitHub CLI command failed.',
    cause: error,
  })
}

function normalizePullRequestState(input: {
  state?: string | null | undefined
  mergedAt?: string | null | undefined
}): 'open' | 'closed' | 'merged' {
  const mergedAt = input.mergedAt
  const state = input.state
  if ((typeof mergedAt === 'string' && mergedAt.trim().length > 0) || state === 'MERGED') {
    return 'merged'
  }
  if (state === 'CLOSED') {
    return 'closed'
  }
  return 'open'
}

const RawGitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.String,
      })
    )
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.String,
      })
    )
  ),
})

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
})

function normalizePullRequestSummary(
  raw: Schema.Schema.Type<typeof RawGitHubPullRequestSchema>
): GitHubPullRequestSummary {
  const headRepositoryNameWithOwner = raw.headRepository?.nameWithOwner ?? null
  const headRepositoryOwnerLogin =
    raw.headRepositoryOwner?.login ??
    (typeof headRepositoryNameWithOwner === 'string' && headRepositoryNameWithOwner.includes('/')
      ? (headRepositoryNameWithOwner.split('/')[0] ?? null)
      : null)
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizePullRequestState(raw),
    ...(typeof raw.isCrossRepository === 'boolean'
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  }
}

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  }
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: 'listOpenPullRequests' | 'getPullRequest' | 'getRepositoryCloneUrls',
  invalidDetail: string
): Effect.Effect<S['Type'], GitHubCliError, S['DecodingServices']> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      error =>
        new GitHubCliError({
          operation,
          detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
          cause: error,
        })
    )
  )
}

function makeExecute(): GitHubCliShape['execute'] {
  return input =>
    Effect.tryPromise({
      try: () =>
        runProcess('gh', input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: error => normalizeGitHubCliError('execute', error),
    })
}

function makeListOpenPullRequests(
  execute: GitHubCliShape['execute']
): GitHubCliShape['listOpenPullRequests'] {
  return input =>
    execute({ cwd: input.cwd, args: buildListOpenPullRequestsArgs(input) }).pipe(
      Effect.map(result => result.stdout.trim()),
      Effect.flatMap(raw =>
        raw.length === 0
          ? Effect.succeed([])
          : decodeGitHubJson(
              raw,
              Schema.Array(RawGitHubPullRequestSchema),
              'listOpenPullRequests',
              'GitHub CLI returned invalid PR list JSON.'
            )
      ),
      Effect.map(pullRequests => pullRequests.map(normalizePullRequestSummary))
    )
}

function makeGetPullRequest(execute: GitHubCliShape['execute']): GitHubCliShape['getPullRequest'] {
  return input =>
    execute({ cwd: input.cwd, args: buildGetPullRequestArgs(input) }).pipe(
      Effect.map(result => result.stdout.trim()),
      Effect.flatMap(raw =>
        decodeGitHubJson(
          raw,
          RawGitHubPullRequestSchema,
          'getPullRequest',
          'GitHub CLI returned invalid pull request JSON.'
        )
      ),
      Effect.map(normalizePullRequestSummary)
    )
}

function makeGetRepositoryCloneUrls(
  execute: GitHubCliShape['execute']
): GitHubCliShape['getRepositoryCloneUrls'] {
  return input =>
    execute({
      cwd: input.cwd,
      args: ['repo', 'view', input.repository, '--json', 'nameWithOwner,url,sshUrl'],
    }).pipe(
      Effect.map(result => result.stdout.trim()),
      Effect.flatMap(raw =>
        decodeGitHubJson(
          raw,
          RawGitHubRepositoryCloneUrlsSchema,
          'getRepositoryCloneUrls',
          'GitHub CLI returned invalid repository JSON.'
        )
      ),
      Effect.map(normalizeRepositoryCloneUrls)
    )
}

function makeCreatePullRequest(
  execute: GitHubCliShape['execute']
): GitHubCliShape['createPullRequest'] {
  return input =>
    execute({ cwd: input.cwd, args: buildCreatePullRequestArgs(input) }).pipe(Effect.asVoid)
}

function makeGetDefaultBranch(
  execute: GitHubCliShape['execute']
): GitHubCliShape['getDefaultBranch'] {
  return input =>
    execute({
      cwd: input.cwd,
      args: ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    }).pipe(
      Effect.map(value => {
        const trimmed = value.stdout.trim()
        return trimmed.length > 0 ? trimmed : null
      })
    )
}

function makeCheckoutPullRequest(
  execute: GitHubCliShape['execute']
): GitHubCliShape['checkoutPullRequest'] {
  return input =>
    execute({
      cwd: input.cwd,
      args: ['pr', 'checkout', input.reference, ...(input.force ? ['--force'] : [])],
    }).pipe(Effect.asVoid)
}

function makeGitHubCliService(execute: GitHubCliShape['execute']): GitHubCliShape {
  return {
    execute,
    listOpenPullRequests: makeListOpenPullRequests(execute),
    getPullRequest: makeGetPullRequest(execute),
    getRepositoryCloneUrls: makeGetRepositoryCloneUrls(execute),
    createPullRequest: makeCreatePullRequest(execute),
    getDefaultBranch: makeGetDefaultBranch(execute),
    checkoutPullRequest: makeCheckoutPullRequest(execute),
  } satisfies GitHubCliShape
}

const makeGitHubCli = Effect.sync(() => {
  const execute = makeExecute()

  const service = makeGitHubCliService(execute)
  return service
})

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli)
