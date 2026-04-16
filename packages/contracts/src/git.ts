import { Schema } from 'effect'
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from './baseSchemas'

const TrimmedNonEmptyStringSchema = TrimmedNonEmptyString

// Domain Types

export const GitStackedAction = Schema.Literals(['commit', 'commit_push', 'commit_push_pr'])
export type GitStackedAction = typeof GitStackedAction.Type
export const GitActionProgressPhase = Schema.Literals(['branch', 'commit', 'push', 'pr'])
export type GitActionProgressPhase = typeof GitActionProgressPhase.Type
export const GitActionProgressKind = Schema.Literals([
  'action_started',
  'phase_started',
  'hook_started',
  'hook_output',
  'hook_finished',
  'action_finished',
  'action_failed',
])
export type GitActionProgressKind = typeof GitActionProgressKind.Type
export const GitActionProgressStream = Schema.Literals(['stdout', 'stderr'])
export type GitActionProgressStream = typeof GitActionProgressStream.Type
const GitCommitStepStatus = Schema.Literals(['created', 'skipped_no_changes'])
const GitPushStepStatus = Schema.Literals(['pushed', 'skipped_not_requested', 'skipped_up_to_date'])
const GitBranchStepStatus = Schema.Literals(['created', 'skipped_not_requested'])
const GitPrStepStatus = Schema.Literals(['created', 'opened_existing', 'skipped_not_requested'])
const GitStatusPrState = Schema.Literals(['open', 'closed', 'merged'])
const GitPullRequestReference = TrimmedNonEmptyStringSchema
const GitPullRequestState = Schema.Literals(['open', 'closed', 'merged'])
const GitPreparePullRequestThreadMode = Schema.Literals(['local', 'worktree'])

export const GitBranch = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  isRemote: Schema.optional(Schema.Boolean),
  remoteName: Schema.optional(TrimmedNonEmptyStringSchema),
  current: Schema.Boolean,
  isDefault: Schema.Boolean,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
})
export type GitBranch = typeof GitBranch.Type

const GitWorktree = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
})
const GitResolvedPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitPullRequestState,
})
export type GitResolvedPullRequest = typeof GitResolvedPullRequest.Type

// RPC Inputs

export const GitStatusInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitStatusInput = typeof GitStatusInput.Type

export const GitPullInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitPullInput = typeof GitPullInput.Type

export const GitRunStackedActionInput = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
  commitMessage: Schema.optional(TrimmedNonEmptyStringSchema.check(Schema.isMaxLength(10_000))),
  featureBranch: Schema.optional(Schema.Boolean),
  filePaths: Schema.optional(
    Schema.Array(TrimmedNonEmptyStringSchema).check(Schema.isMinLength(1))
  ),
})
export type GitRunStackedActionInput = typeof GitRunStackedActionInput.Type

export const GitListBranchesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitListBranchesInput = typeof GitListBranchesInput.Type

export const GitCreateWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
  newBranch: Schema.optional(TrimmedNonEmptyStringSchema),
  path: Schema.NullOr(TrimmedNonEmptyStringSchema),
})
export type GitCreateWorktreeInput = typeof GitCreateWorktreeInput.Type

export const GitPullRequestRefInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
})
export type GitPullRequestRefInput = typeof GitPullRequestRefInput.Type

export const GitPreparePullRequestThreadInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  reference: GitPullRequestReference,
  mode: GitPreparePullRequestThreadMode,
})
export type GitPreparePullRequestThreadInput = typeof GitPreparePullRequestThreadInput.Type

export const GitRemoveWorktreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  force: Schema.optional(Schema.Boolean),
})
export type GitRemoveWorktreeInput = typeof GitRemoveWorktreeInput.Type

export const GitPushWorktreeToParentInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  sourceBranch: TrimmedNonEmptyStringSchema,
  parentBranch: TrimmedNonEmptyStringSchema,
})
export type GitPushWorktreeToParentInput = typeof GitPushWorktreeToParentInput.Type

const GitPushWorktreeToParentFailureReason = Schema.Literals([
  'non_fast_forward',
  'protected',
  'other',
])
export type GitPushWorktreeToParentFailureReason = typeof GitPushWorktreeToParentFailureReason.Type

export const GitPushWorktreeToParentResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: GitPushWorktreeToParentFailureReason,
    message: Schema.String,
  }),
])
export type GitPushWorktreeToParentResult = typeof GitPushWorktreeToParentResult.Type

export const GitCreateBranchInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
})
export type GitCreateBranchInput = typeof GitCreateBranchInput.Type

export const GitCheckoutInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  branch: TrimmedNonEmptyStringSchema,
})
export type GitCheckoutInput = typeof GitCheckoutInput.Type

export const GitInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitInitInput = typeof GitInitInput.Type

export const GitDiscoverReposInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitDiscoverReposInput = typeof GitDiscoverReposInput.Type

const GitDiscoveredRepo = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  name: TrimmedNonEmptyStringSchema,
})

export const GitDiscoverReposResult = Schema.Struct({
  repos: Schema.Array(GitDiscoveredRepo),
})
export type GitDiscoverReposResult = typeof GitDiscoverReposResult.Type

// RPC Results

const GitStatusPr = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyStringSchema,
  headBranch: TrimmedNonEmptyStringSchema,
  state: GitStatusPrState,
})

export const GitStatusResult = Schema.Struct({
  branch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
  hasWorkingTreeChanges: Schema.Boolean,
  workingTree: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: TrimmedNonEmptyStringSchema,
        insertions: NonNegativeInt,
        deletions: NonNegativeInt,
      })
    ),
    insertions: NonNegativeInt,
    deletions: NonNegativeInt,
  }),
  hasUpstream: Schema.Boolean,
  aheadCount: NonNegativeInt,
  behindCount: NonNegativeInt,
  pr: Schema.NullOr(GitStatusPr),
})
export type GitStatusResult = typeof GitStatusResult.Type

export const GitListBranchesResult = Schema.Struct({
  branches: Schema.Array(GitBranch),
  isRepo: Schema.Boolean,
  hasOriginRemote: Schema.Boolean,
})
export type GitListBranchesResult = typeof GitListBranchesResult.Type

export const GitCreateWorktreeResult = Schema.Struct({
  worktree: GitWorktree,
})
export type GitCreateWorktreeResult = typeof GitCreateWorktreeResult.Type

export const GitResolvePullRequestResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
})
export type GitResolvePullRequestResult = typeof GitResolvePullRequestResult.Type

export const GitPreparePullRequestThreadResult = Schema.Struct({
  pullRequest: GitResolvedPullRequest,
  branch: TrimmedNonEmptyStringSchema,
  worktreePath: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
})
export type GitPreparePullRequestThreadResult = typeof GitPreparePullRequestThreadResult.Type

export const GitRunStackedActionResult = Schema.Struct({
  action: GitStackedAction,
  branch: Schema.Struct({
    status: GitBranchStepStatus,
    name: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  commit: Schema.Struct({
    status: GitCommitStepStatus,
    commitSha: Schema.optional(TrimmedNonEmptyStringSchema),
    subject: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
  push: Schema.Struct({
    status: GitPushStepStatus,
    branch: Schema.optional(TrimmedNonEmptyStringSchema),
    upstreamBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    setUpstream: Schema.optional(Schema.Boolean),
  }),
  pr: Schema.Struct({
    status: GitPrStepStatus,
    url: Schema.optional(Schema.String),
    number: Schema.optional(PositiveInt),
    baseBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    headBranch: Schema.optional(TrimmedNonEmptyStringSchema),
    title: Schema.optional(TrimmedNonEmptyStringSchema),
  }),
})
export type GitRunStackedActionResult = typeof GitRunStackedActionResult.Type

export const GitPullResult = Schema.Struct({
  status: Schema.Literals(['pulled', 'skipped_up_to_date']),
  branch: TrimmedNonEmptyStringSchema,
  upstreamBranch: TrimmedNonEmptyStringSchema.pipe(Schema.NullOr),
})
export type GitPullResult = typeof GitPullResult.Type

// RPC / domain errors
export class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()('GitCommandError', {
  operation: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git command failed in ${this.operation}: ${this.command} (${this.cwd}) - ${this.detail}`
  }
}

export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()('GitHubCliError', {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`
  }
}

export class TextGenerationError extends Schema.TaggedErrorClass<TextGenerationError>()(
  'TextGenerationError',
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`
  }
}

export class GitManagerError extends Schema.TaggedErrorClass<GitManagerError>()('GitManagerError', {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Git manager failed in ${this.operation}: ${this.detail}`
  }
}

export const GitManagerServiceError = Schema.Union([
  GitManagerError,
  GitCommandError,
  GitHubCliError,
  TextGenerationError,
])
export type GitManagerServiceError = typeof GitManagerServiceError.Type

const GitActionProgressBase = Schema.Struct({
  actionId: TrimmedNonEmptyStringSchema,
  cwd: TrimmedNonEmptyStringSchema,
  action: GitStackedAction,
})

const GitActionStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('action_started'),
  phases: Schema.Array(GitActionProgressPhase),
})
const GitActionPhaseStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('phase_started'),
  phase: GitActionProgressPhase,
  label: TrimmedNonEmptyStringSchema,
})
const GitActionHookStartedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('hook_started'),
  hookName: TrimmedNonEmptyStringSchema,
})
const GitActionHookOutputEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('hook_output'),
  hookName: Schema.NullOr(TrimmedNonEmptyStringSchema),
  stream: GitActionProgressStream,
  text: TrimmedNonEmptyStringSchema,
})
const GitActionHookFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('hook_finished'),
  hookName: TrimmedNonEmptyStringSchema,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: Schema.NullOr(NonNegativeInt),
})
const GitActionFinishedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('action_finished'),
  result: GitRunStackedActionResult,
})
const GitActionFailedEvent = Schema.Struct({
  ...GitActionProgressBase.fields,
  kind: Schema.Literal('action_failed'),
  phase: Schema.NullOr(GitActionProgressPhase),
  message: TrimmedNonEmptyStringSchema,
})

export const GitActionProgressEvent = Schema.Union([
  GitActionStartedEvent,
  GitActionPhaseStartedEvent,
  GitActionHookStartedEvent,
  GitActionHookOutputEvent,
  GitActionHookFinishedEvent,
  GitActionFinishedEvent,
  GitActionFailedEvent,
])
export type GitActionProgressEvent = typeof GitActionProgressEvent.Type

// ---------------------------------------------------------------------------
// Diff / log / panel contracts (used by the right-side git sidebar)
// ---------------------------------------------------------------------------

/** One-character status code copied from `git status --porcelain`. */
export const GitDiffFileStatus = Schema.Literals(['M', 'A', 'D', 'R', 'C', 'U', '?'])
export type GitDiffFileStatus = typeof GitDiffFileStatus.Type

/** Where a file is in the diff surface. */
export const GitDiffSectionKind = Schema.Literals(['staged', 'unstaged', 'untracked', 'branch'])
export type GitDiffSectionKind = typeof GitDiffSectionKind.Type

/** A single rendered line in a unified/split diff. */
export const GitDiffLine = Schema.Struct({
  type: Schema.Literals(['context', 'add', 'del']),
  content: Schema.String,
  oldLineNumber: Schema.optional(NonNegativeInt),
  newLineNumber: Schema.optional(NonNegativeInt),
})
export type GitDiffLine = typeof GitDiffLine.Type

/** A hunk inside a file's diff. */
export const GitDiffHunk = Schema.Struct({
  oldStart: NonNegativeInt,
  oldLines: NonNegativeInt,
  newStart: NonNegativeInt,
  newLines: NonNegativeInt,
  header: Schema.String,
  lines: Schema.Array(GitDiffLine),
})
export type GitDiffHunk = typeof GitDiffHunk.Type

/**
 * A single changed file. `patch` preserves the raw unified diff for clients
 * that render via `@pierre/diffs` without re-parsing; `hunks` is the parsed
 * form for tree-building and inline list views.
 */
export const GitDiffFile = Schema.Struct({
  path: TrimmedNonEmptyStringSchema,
  oldPath: Schema.optional(TrimmedNonEmptyStringSchema),
  status: GitDiffFileStatus,
  section: GitDiffSectionKind,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  isBinary: Schema.Boolean,
  patch: Schema.String,
  hunks: Schema.Array(GitDiffHunk),
})
export type GitDiffFile = typeof GitDiffFile.Type

export const GitDiffScopeKind = Schema.Literals(['unstaged', 'staged', 'branch'])
export type GitDiffScopeKind = typeof GitDiffScopeKind.Type
export type GitDiffScope = typeof GitDiffScopeKind.Type

export const GitDiffScopeSummary = Schema.Struct({
  scope: GitDiffScopeKind,
  label: TrimmedNonEmptyStringSchema,
  available: Schema.Boolean,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  fileCount: NonNegativeInt,
  baseRef: Schema.NullOr(TrimmedNonEmptyStringSchema),
  compareLabel: Schema.NullOr(TrimmedNonEmptyStringSchema),
})
export type GitDiffScopeSummary = typeof GitDiffScopeSummary.Type

export const GitBranchDiff = Schema.Struct({
  headRef: TrimmedNonEmptyStringSchema,
  baseRef: TrimmedNonEmptyStringSchema,
  compareLabel: TrimmedNonEmptyStringSchema,
  files: Schema.Array(GitDiffFile),
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  fileCount: NonNegativeInt,
})
export type GitBranchDiff = typeof GitBranchDiff.Type

export const GitDiffResult = Schema.Struct({
  staged: Schema.Array(GitDiffFile),
  unstaged: Schema.Array(GitDiffFile),
  untracked: Schema.Array(GitDiffFile),
  branch: Schema.NullOr(GitBranchDiff),
  scopeSummaries: Schema.Array(GitDiffScopeSummary),
  totalAdditions: NonNegativeInt,
  totalDeletions: NonNegativeInt,
})
export type GitDiffResult = typeof GitDiffResult.Type

export const GitLogEntry = Schema.Struct({
  hash: TrimmedNonEmptyStringSchema,
  shortHash: TrimmedNonEmptyStringSchema,
  author: TrimmedNonEmptyStringSchema,
  email: Schema.String,
  date: Schema.String,
  subject: TrimmedNonEmptyStringSchema,
  body: Schema.String,
})
export type GitLogEntry = typeof GitLogEntry.Type

// RPC inputs for the panel surface

export const GitGetDiffInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitGetDiffInput = typeof GitGetDiffInput.Type

export const GitGetDiffResult = GitDiffResult
export type GitGetDiffResult = typeof GitGetDiffResult.Type

export const GitGetLogInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(PositiveInt),
})
export type GitGetLogInput = typeof GitGetLogInput.Type

export const GitGetLogResult = Schema.Struct({
  entries: Schema.Array(GitLogEntry),
})
export type GitGetLogResult = typeof GitGetLogResult.Type

export const GitGetIssuesInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(PositiveInt),
})
export type GitGetIssuesInput = typeof GitGetIssuesInput.Type

const GitHubActor = Schema.Struct({
  login: Schema.String,
})

const GitHubLabel = Schema.Struct({
  name: TrimmedNonEmptyStringSchema,
  color: Schema.optional(Schema.String),
})

export const GitIssueEntry = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  state: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  author: Schema.optional(Schema.NullOr(GitHubActor)),
  labels: Schema.optional(Schema.Array(GitHubLabel)),
})
export type GitIssueEntry = typeof GitIssueEntry.Type

export const GitGetIssuesResult = Schema.Struct({
  entries: Schema.Array(GitIssueEntry),
})
export type GitGetIssuesResult = typeof GitGetIssuesResult.Type

export const GitGetPullRequestsInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  limit: Schema.optional(PositiveInt),
})
export type GitGetPullRequestsInput = typeof GitGetPullRequestsInput.Type

export const GitPullRequestListEntry = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyStringSchema,
  url: Schema.String,
  state: Schema.String,
  isDraft: Schema.optional(Schema.Boolean),
  updatedAt: Schema.String,
  headRefName: TrimmedNonEmptyStringSchema,
  baseRefName: TrimmedNonEmptyStringSchema,
  author: Schema.optional(Schema.NullOr(GitHubActor)),
})
export type GitPullRequestListEntry = typeof GitPullRequestListEntry.Type

export const GitGetPullRequestsResult = Schema.Struct({
  entries: Schema.Array(GitPullRequestListEntry),
})
export type GitGetPullRequestsResult = typeof GitGetPullRequestsResult.Type

export const GitStageAllInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitStageAllInput = typeof GitStageAllInput.Type

export const GitRestoreAllUnstagedInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
})
export type GitRestoreAllUnstagedInput = typeof GitRestoreAllUnstagedInput.Type

export const GitStagePathInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
})
export type GitStagePathInput = typeof GitStagePathInput.Type

export const GitUnstagePathInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
})
export type GitUnstagePathInput = typeof GitUnstagePathInput.Type

export const GitRestorePathInput = Schema.Struct({
  cwd: TrimmedNonEmptyStringSchema,
  path: TrimmedNonEmptyStringSchema,
  staged: Schema.optional(Schema.Boolean),
})
export type GitRestorePathInput = typeof GitRestorePathInput.Type
