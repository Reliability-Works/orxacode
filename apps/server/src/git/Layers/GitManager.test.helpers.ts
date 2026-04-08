import type { ModelSelection } from '@orxa-code/contracts'
import { GitCommandError, TextGenerationError } from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Effect, FileSystem, Layer, PlatformError, Scope } from 'effect'

import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { GitCore } from '../Services/GitCore.ts'
import { GitHubCli } from '../Services/GitHubCli.ts'
import { type GitManagerShape } from '../Services/GitManager.ts'
import { type TextGenerationShape, TextGeneration } from '../Services/TextGeneration.ts'
import { GitCoreLive } from './GitCore.ts'
import { makeGitManager } from './GitManager.ts'
import { makeTempDirectoryScoped } from './GitTestUtils.shared.ts'
import { type FakeGhScenario, createGitHubCliWithFakeGh } from './GitManager.test.fakeGh.ts'

interface FakeGitTextGeneration {
  generateCommitMessage: (input: {
    cwd: string
    branch: string | null
    stagedSummary: string
    stagedPatch: string
    includeBranch?: boolean
    modelSelection: ModelSelection
  }) => Effect.Effect<
    { subject: string; body: string; branch?: string | undefined },
    TextGenerationError
  >
  generatePrContent: (input: {
    cwd: string
    baseBranch: string
    headBranch: string
    commitSummary: string
    diffSummary: string
    diffPatch: string
    modelSelection: ModelSelection
  }) => Effect.Effect<{ title: string; body: string }, TextGenerationError>
  generateBranchName: (input: {
    cwd: string
    message: string
    modelSelection: ModelSelection
  }) => Effect.Effect<{ branch: string }, TextGenerationError>
  generateThreadTitle: (input: {
    cwd: string
    message: string
    modelSelection: ModelSelection
  }) => Effect.Effect<{ title: string }, TextGenerationError>
}

export function makeTempDir(
  prefix: string
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return makeTempDirectoryScoped(prefix)
}

export function runGit(
  cwd: string,
  args: readonly string[],
  allowNonZeroExit = false
): Effect.Effect<
  { readonly code: number; readonly stdout: string; readonly stderr: string },
  GitCommandError,
  GitCore
> {
  return Effect.gen(function* () {
    const gitCore = yield* GitCore
    return yield* gitCore.execute({
      operation: 'GitManager.test.runGit',
      cwd,
      args,
      allowNonZeroExit,
    })
  })
}

export function initRepo(
  cwd: string
): Effect.Effect<
  void,
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Scope.Scope | GitCore
> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* runGit(cwd, ['init', '--initial-branch=main'])
    yield* runGit(cwd, ['config', 'user.email', 'test@example.com'])
    yield* runGit(cwd, ['config', 'user.name', 'Test User'])
    yield* fileSystem.writeFileString(`${cwd}/README.md`, 'hello\n')
    yield* runGit(cwd, ['add', 'README.md'])
    yield* runGit(cwd, ['commit', '-m', 'Initial commit'])
  })
}

export function createBareRemote(): Effect.Effect<
  string,
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Scope.Scope | GitCore
> {
  return Effect.gen(function* () {
    const remoteDir = yield* makeTempDir('orxa-git-remote-')
    yield* runGit(remoteDir, ['init', '--bare'])
    return remoteDir
  })
}

function createTextGeneration(overrides: Partial<FakeGitTextGeneration> = {}): TextGenerationShape {
  const implementation: FakeGitTextGeneration = {
    generateCommitMessage: input =>
      Effect.succeed({
        subject: 'Implement stacked git actions',
        body: '',
        ...(input.includeBranch ? { branch: 'feature/implement-stacked-git-actions' } : {}),
      }),
    generatePrContent: () =>
      Effect.succeed({
        title: 'Add stacked git actions',
        body: '## Summary\n- Add stacked git workflow\n\n## Testing\n- Not run',
      }),
    generateBranchName: () => Effect.succeed({ branch: 'update-workflow' }),
    generateThreadTitle: () => Effect.succeed({ title: 'Update workflow' }),
    ...overrides,
  }

  return {
    generateCommitMessage: input =>
      implementation.generateCommitMessage(input).pipe(
        Effect.mapError(
          cause =>
            new TextGenerationError({
              operation: 'generateCommitMessage',
              detail: 'fake text generation failed',
              ...(cause !== undefined ? { cause } : {}),
            })
        )
      ),
    generatePrContent: input =>
      implementation.generatePrContent(input).pipe(
        Effect.mapError(
          cause =>
            new TextGenerationError({
              operation: 'generatePrContent',
              detail: 'fake text generation failed',
              ...(cause !== undefined ? { cause } : {}),
            })
        )
      ),
    generateBranchName: input =>
      implementation.generateBranchName(input).pipe(
        Effect.mapError(
          cause =>
            new TextGenerationError({
              operation: 'generateBranchName',
              detail: 'fake text generation failed',
              ...(cause !== undefined ? { cause } : {}),
            })
        )
      ),
    generateThreadTitle: input =>
      implementation.generateThreadTitle(input).pipe(
        Effect.mapError(
          cause =>
            new TextGenerationError({
              operation: 'generateThreadTitle',
              detail: 'fake text generation failed',
              ...(cause !== undefined ? { cause } : {}),
            })
        )
      ),
  }
}

export function runStackedAction(
  manager: GitManagerShape,
  input: {
    cwd: string
    action: 'commit' | 'commit_push' | 'commit_push_pr'
    actionId?: string
    commitMessage?: string
    featureBranch?: boolean
    filePaths?: readonly string[]
  },
  options?: Parameters<GitManagerShape['runStackedAction']>[1]
) {
  return manager.runStackedAction(
    {
      ...input,
      actionId: input.actionId ?? 'test-action-id',
    },
    options
  )
}

export function resolvePullRequest(
  manager: GitManagerShape,
  input: { cwd: string; reference: string }
) {
  return manager.resolvePullRequest(input)
}

export function preparePullRequestThread(
  manager: GitManagerShape,
  input: { cwd: string; reference: string; mode: 'local' | 'worktree' }
) {
  return manager.preparePullRequestThread(input)
}

export function makeManager(input?: {
  ghScenario?: FakeGhScenario
  textGeneration?: Partial<FakeGitTextGeneration>
}) {
  const { service: gitHubCli, ghCalls } = createGitHubCliWithFakeGh(input?.ghScenario)
  const textGeneration = createTextGeneration(input?.textGeneration)
  const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
    prefix: 'orxa-git-manager-test-',
  })
  const serverSettingsLayer = ServerSettingsService.layerTest()
  const gitCoreLayer = GitCoreLive.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(serverConfigLayer)
  )
  const managerLayer = Layer.mergeAll(
    Layer.succeed(GitHubCli, gitHubCli),
    Layer.succeed(TextGeneration, textGeneration),
    gitCoreLayer,
    serverSettingsLayer
  ).pipe(Layer.provideMerge(NodeServices.layer))

  return makeGitManager().pipe(
    Effect.provide(managerLayer),
    Effect.map(manager => ({ manager, ghCalls }))
  )
}

export const GitManagerTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: 'orxa-git-manager-test-' })),
  Layer.provideMerge(NodeServices.layer)
)
