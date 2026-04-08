import { randomUUID } from 'node:crypto'

import { Effect, FileSystem, Option, Path, Ref } from 'effect'
import {
  type GitActionProgressPhase,
  type GitRunStackedActionResult,
  type ModelSelection,
} from '@orxa-code/contracts'
import { resolveAutoFeatureBranchName, sanitizeFeatureBranchName } from '@orxa-code/shared/git'

import type {
  GitActionProgressReporter,
  GitManagerShape,
  GitRunStackedActionOptions,
} from '../Services/GitManager.ts'
import type { GitCoreShape } from '../Services/GitCore.ts'
import type { GitHubCliShape } from '../Services/GitHubCli.ts'
import type { TextGenerationShape } from '../Services/TextGeneration.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import type { GitManagerServiceError } from '@orxa-code/contracts'
import {
  createActionScopedEmitter,
  createCommitProgress,
  createPhases,
  createProgressEmitter,
} from './GitManagerProgress.ts'
import {
  findOpenPr,
  resolveBaseBranch,
  resolveBranchHeadContext,
  type GitManagerPullRequestRuntimeDependencies,
} from './GitManagerPullRequestRuntime.ts'
import {
  formatCommitMessage,
  gitManagerError,
  limitContext,
  parseCustomCommitMessage,
  sanitizeCommitMessage,
  type CommitAndBranchSuggestion,
} from './GitManagerShared.ts'

const COMMIT_TIMEOUT_MS = 10 * 60_000

interface GitManagerStackedActionDependencies {
  readonly gitCore: GitCoreShape
  readonly gitHubCli: GitHubCliShape
  readonly textGeneration: TextGenerationShape
  readonly serverSettingsService: ServerSettingsShape
  readonly pullRequestRuntime: GitManagerPullRequestRuntimeDependencies
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly tempDir: string
}

const getModelSelection = Effect.fn('getModelSelection')(function* (
  deps: GitManagerStackedActionDependencies
): Effect.fn.Return<ModelSelection, GitManagerServiceError> {
  return yield* deps.serverSettingsService.getSettings.pipe(
    Effect.map(settings => settings.textGenerationModelSelection),
    Effect.mapError(cause =>
      gitManagerError('runStackedAction', 'Failed to get server settings.', cause)
    )
  )
})

const resolveCommitAndBranchSuggestion = Effect.fn('resolveCommitAndBranchSuggestion')(function* (
  deps: GitManagerStackedActionDependencies,
  input: {
    cwd: string
    branch: string | null
    commitMessage?: string
    includeBranch?: boolean
    filePaths?: readonly string[]
    modelSelection: ModelSelection
  }
) {
  const context = yield* deps.gitCore.prepareCommitContext(input.cwd, input.filePaths)
  if (!context) {
    return null
  }

  const customCommit = parseCustomCommitMessage(input.commitMessage ?? '')
  if (customCommit) {
    return {
      subject: customCommit.subject,
      body: customCommit.body,
      ...(input.includeBranch ? { branch: sanitizeFeatureBranchName(customCommit.subject) } : {}),
      commitMessage: formatCommitMessage(customCommit.subject, customCommit.body),
    }
  }

  const generated = yield* deps.textGeneration
    .generateCommitMessage({
      cwd: input.cwd,
      branch: input.branch,
      stagedSummary: limitContext(context.stagedSummary, 8_000),
      stagedPatch: limitContext(context.stagedPatch, 50_000),
      ...(input.includeBranch ? { includeBranch: true } : {}),
      modelSelection: input.modelSelection,
    })
    .pipe(Effect.map(result => sanitizeCommitMessage(result)))

  return {
    subject: generated.subject,
    body: generated.body,
    ...(generated.branch !== undefined ? { branch: generated.branch } : {}),
    commitMessage: formatCommitMessage(generated.subject, generated.body),
  }
})

const runCommitStep = Effect.fn('runCommitStep')(function* (
  deps: GitManagerStackedActionDependencies,
  modelSelection: ModelSelection,
  cwd: string,
  action: 'commit' | 'commit_push' | 'commit_push_pr',
  branch: string | null,
  commitMessage?: string,
  preResolvedSuggestion?: CommitAndBranchSuggestion,
  filePaths?: readonly string[],
  progressReporter?: GitActionProgressReporter,
  actionId?: string
) {
  const emit = createActionScopedEmitter({
    cwd,
    action,
    ...(progressReporter ? { progressReporter } : {}),
    ...(actionId ? { actionId } : {}),
  })
  let suggestion: CommitAndBranchSuggestion | null | undefined = preResolvedSuggestion

  if (!suggestion) {
    if (!commitMessage?.trim()) {
      yield* emit({
        kind: 'phase_started',
        phase: 'commit',
        label: 'Generating commit message...',
      })
    }
    suggestion = yield* resolveCommitAndBranchSuggestion(deps, {
      cwd,
      branch,
      ...(commitMessage ? { commitMessage } : {}),
      ...(filePaths ? { filePaths } : {}),
      modelSelection,
    })
  }

  if (!suggestion) {
    return { status: 'skipped_no_changes' as const }
  }

  yield* emit({
    kind: 'phase_started',
    phase: 'commit',
    label: 'Committing...',
  })

  const commitProgress = progressReporter && actionId ? createCommitProgress(emit) : null
  const { commitSha } = yield* deps.gitCore.commit(cwd, suggestion.subject, suggestion.body, {
    timeoutMs: COMMIT_TIMEOUT_MS,
    ...(commitProgress ? { progress: commitProgress.progress } : {}),
  })
  if (commitProgress) {
    yield* commitProgress.finishPendingHook()
  }

  return {
    status: 'created' as const,
    commitSha,
    subject: suggestion.subject,
  }
})

const createPullRequestFromGeneratedContent = Effect.fn('createPullRequestFromGeneratedContent')(
  function* (
    deps: GitManagerStackedActionDependencies,
    input: {
      cwd: string
      baseBranch: string
      headSelector: string
      title: string
      body: string
    }
  ) {
    const bodyFile = deps.path.join(deps.tempDir, `orxa-pr-body-${process.pid}-${randomUUID()}.md`)
    yield* deps.fileSystem
      .writeFileString(bodyFile, input.body)
      .pipe(
        Effect.mapError(cause =>
          gitManagerError('runPrStep', 'Failed to write pull request body temp file.', cause)
        )
      )
    yield* deps.gitHubCli
      .createPullRequest({
        cwd: input.cwd,
        baseBranch: input.baseBranch,
        headSelector: input.headSelector,
        title: input.title,
        bodyFile,
      })
      .pipe(Effect.ensuring(deps.fileSystem.remove(bodyFile).pipe(Effect.catch(() => Effect.void))))
  }
)

const runPrStep = Effect.fn('runPrStep')(function* (
  deps: GitManagerStackedActionDependencies,
  modelSelection: ModelSelection,
  cwd: string,
  fallbackBranch: string | null
) {
  const details = yield* deps.gitCore.statusDetails(cwd)
  const branch = details.branch ?? fallbackBranch
  if (!branch) {
    return yield* gitManagerError('runPrStep', 'Cannot create a pull request from detached HEAD.')
  }
  if (!details.hasUpstream) {
    return yield* gitManagerError(
      'runPrStep',
      'Current branch has not been pushed. Push before creating a PR.'
    )
  }

  const headContext = yield* resolveBranchHeadContext(deps.pullRequestRuntime, cwd, {
    branch,
    upstreamRef: details.upstreamRef,
  })
  const existing = yield* findOpenPr(deps.pullRequestRuntime, cwd, headContext.headSelectors)
  if (existing) {
    return {
      status: 'opened_existing' as const,
      url: existing.url,
      number: existing.number,
      baseBranch: existing.baseRefName,
      headBranch: existing.headRefName,
      title: existing.title,
    }
  }

  const baseBranch = yield* resolveBaseBranch(
    deps.pullRequestRuntime,
    cwd,
    branch,
    details.upstreamRef,
    headContext
  )
  const rangeContext = yield* deps.gitCore.readRangeContext(cwd, baseBranch)
  const generated = yield* deps.textGeneration.generatePrContent({
    cwd,
    baseBranch,
    headBranch: headContext.headBranch,
    commitSummary: limitContext(rangeContext.commitSummary, 20_000),
    diffSummary: limitContext(rangeContext.diffSummary, 20_000),
    diffPatch: limitContext(rangeContext.diffPatch, 60_000),
    modelSelection,
  })
  yield* createPullRequestFromGeneratedContent(deps, {
    cwd,
    baseBranch,
    headSelector: headContext.preferredHeadSelector,
    title: generated.title,
    body: generated.body,
  })

  const created = yield* findOpenPr(deps.pullRequestRuntime, cwd, headContext.headSelectors)
  if (!created) {
    return {
      status: 'created' as const,
      baseBranch,
      headBranch: headContext.headBranch,
      title: generated.title,
    }
  }

  return {
    status: 'created' as const,
    url: created.url,
    number: created.number,
    baseBranch: created.baseRefName,
    headBranch: created.headRefName,
    title: created.title,
  }
})

const runFeatureBranchStep = Effect.fn('runFeatureBranchStep')(function* (
  deps: GitManagerStackedActionDependencies,
  modelSelection: ModelSelection,
  cwd: string,
  branch: string | null,
  commitMessage?: string,
  filePaths?: readonly string[]
) {
  const suggestion = yield* resolveCommitAndBranchSuggestion(deps, {
    cwd,
    branch,
    ...(commitMessage ? { commitMessage } : {}),
    ...(filePaths ? { filePaths } : {}),
    includeBranch: true,
    modelSelection,
  })
  if (!suggestion) {
    return yield* gitManagerError(
      'runFeatureBranchStep',
      'Cannot create a feature branch because there are no changes to commit.'
    )
  }

  const preferredBranch = suggestion.branch ?? sanitizeFeatureBranchName(suggestion.subject)
  const existingBranchNames = yield* deps.gitCore.listLocalBranchNames(cwd)
  const resolvedBranch = resolveAutoFeatureBranchName(existingBranchNames, preferredBranch)
  yield* deps.gitCore.createBranch({ cwd, branch: resolvedBranch })
  yield* Effect.scoped(deps.gitCore.checkoutBranch({ cwd, branch: resolvedBranch }))

  return {
    branchStep: { status: 'created' as const, name: resolvedBranch },
    resolvedCommitMessage: suggestion.commitMessage,
    resolvedCommitSuggestion: suggestion,
  }
})

const prepareFeatureBranchIfRequested = Effect.fn('prepareFeatureBranchIfRequested')(function* (
  deps: GitManagerStackedActionDependencies,
  input: Parameters<GitManagerShape['runStackedAction']>[0],
  initialStatus: { branch: string | null },
  currentPhase: Ref.Ref<Option.Option<GitActionProgressPhase>>,
  progress: ReturnType<typeof createProgressEmitter>,
  modelSelection: ModelSelection
) {
  if (!input.featureBranch) {
    return {
      branchStep: { status: 'skipped_not_requested' as const },
      commitMessageForStep: input.commitMessage,
      preResolvedCommitSuggestion: undefined,
    }
  }

  yield* Ref.set(currentPhase, Option.some('branch'))
  yield* progress.emit({
    kind: 'phase_started',
    phase: 'branch',
    label: 'Preparing feature branch...',
  })
  const result = yield* runFeatureBranchStep(
    deps,
    modelSelection,
    input.cwd,
    initialStatus.branch,
    input.commitMessage,
    input.filePaths
  )

  return {
    branchStep: result.branchStep,
    commitMessageForStep: result.resolvedCommitMessage,
    preResolvedCommitSuggestion: result.resolvedCommitSuggestion,
  }
})

const validateStackedActionInput = (
  input: Parameters<GitManagerShape['runStackedAction']>[0],
  initialStatus: { branch: string | null }
) => {
  const wantsPush = input.action !== 'commit'
  const wantsPr = input.action === 'commit_push_pr'
  if (!input.featureBranch && wantsPush && !initialStatus.branch) {
    return gitManagerError('runStackedAction', 'Cannot push from detached HEAD.')
  }
  if (!input.featureBranch && wantsPr && !initialStatus.branch) {
    return gitManagerError('runStackedAction', 'Cannot create a pull request from detached HEAD.')
  }
  return null
}

const executeStackedAction = Effect.fn('executeStackedAction')(function* (
  deps: GitManagerStackedActionDependencies,
  input: Parameters<GitManagerShape['runStackedAction']>[0],
  options: GitRunStackedActionOptions | undefined,
  progress: ReturnType<typeof createProgressEmitter>,
  currentPhase: Ref.Ref<Option.Option<GitActionProgressPhase>>
): Effect.fn.Return<GitRunStackedActionResult, GitManagerServiceError> {
  const initialStatus = yield* deps.gitCore.statusDetails(input.cwd)
  const validationError = validateStackedActionInput(input, initialStatus)
  if (validationError) {
    return yield* validationError
  }

  const modelSelection = yield* getModelSelection(deps)
  const { branchStep, commitMessageForStep, preResolvedCommitSuggestion } =
    yield* prepareFeatureBranchIfRequested(
      deps,
      input,
      initialStatus,
      currentPhase,
      progress,
      modelSelection
    )

  const currentBranch = branchStep.status === 'created' ? branchStep.name : initialStatus.branch
  yield* Ref.set(currentPhase, Option.some('commit'))
  const commit = yield* runCommitStep(
    deps,
    modelSelection,
    input.cwd,
    input.action,
    currentBranch,
    commitMessageForStep,
    preResolvedCommitSuggestion,
    input.filePaths,
    options?.progressReporter,
    progress.actionId
  )

  const push =
    input.action !== 'commit'
      ? yield* progress
          .emit({
            kind: 'phase_started',
            phase: 'push',
            label: 'Pushing...',
          })
          .pipe(
            Effect.tap(() => Ref.set(currentPhase, Option.some('push'))),
            Effect.flatMap(() => deps.gitCore.pushCurrentBranch(input.cwd, currentBranch))
          )
      : { status: 'skipped_not_requested' as const }

  const pr =
    input.action === 'commit_push_pr'
      ? yield* progress
          .emit({
            kind: 'phase_started',
            phase: 'pr',
            label: 'Creating PR...',
          })
          .pipe(
            Effect.tap(() => Ref.set(currentPhase, Option.some('pr'))),
            Effect.flatMap(() => runPrStep(deps, modelSelection, input.cwd, currentBranch))
          )
      : { status: 'skipped_not_requested' as const }

  return {
    action: input.action,
    branch: branchStep,
    commit,
    push,
    pr,
  }
})

type RunStackedAction = (
  deps: GitManagerStackedActionDependencies,
  input: Parameters<GitManagerShape['runStackedAction']>[0],
  options?: GitRunStackedActionOptions
) => Effect.Effect<GitRunStackedActionResult, GitManagerServiceError>

export const runStackedAction: RunStackedAction = (deps, input, options) =>
  Effect.gen(function* () {
    const progress = createProgressEmitter(input, options)
    const currentPhase = yield* Ref.make<Option.Option<GitActionProgressPhase>>(Option.none())

    yield* progress.emit({
      kind: 'action_started',
      phases: createPhases(input),
    })

    return yield* executeStackedAction(deps, input, options, progress, currentPhase).pipe(
      Effect.tap(result =>
        progress.emit({
          kind: 'action_finished',
          result,
        })
      ),
      Effect.tapError(error =>
        Effect.flatMap(Ref.get(currentPhase), phase =>
          progress.emit({
            kind: 'action_failed',
            phase: Option.getOrNull(phase),
            message: error.message,
          })
        )
      )
    )
  })
