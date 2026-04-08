import type { ChatAttachment, CommandId, ThreadId } from '@orxa-code/contracts'
import { Cause, Effect } from 'effect'

import type { GitCoreShape } from '../../git/Services/GitCore.ts'
import type { TextGenerationShape } from '../../git/Services/TextGeneration.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import type { ProviderCommandReactorResolveThread } from './ProviderCommandReactor.sessionRuntime.ts'

export interface ProviderCommandReactorFirstTurnDeps {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly git: GitCoreShape
  readonly textGeneration: TextGenerationShape
  readonly serverSettingsService: ServerSettingsShape
  readonly isTemporaryWorktreeBranch: (branch: string) => boolean
  readonly canReplaceThreadTitle: (currentTitle: string, titleSeed?: string) => boolean
  readonly buildGeneratedWorktreeBranchName: (raw: string) => string
  readonly createWorktreeRenameCommandId: () => CommandId
  readonly createThreadTitleRenameCommandId: () => CommandId
}

export function createGenerateAndRenameWorktreeBranchForFirstTurn(
  deps: ProviderCommandReactorFirstTurnDeps
) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId
    readonly branch: string | null
    readonly worktreePath: string | null
    readonly messageText: string
    readonly attachments?: ReadonlyArray<ChatAttachment>
  }) {
    if (!input.branch || !input.worktreePath || !deps.isTemporaryWorktreeBranch(input.branch)) {
      return
    }

    const oldBranch = input.branch
    const cwd = input.worktreePath
    const attachments = input.attachments ?? []
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* deps.serverSettingsService.getSettings
      const generated = yield* deps.textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      })
      const targetBranch = deps.buildGeneratedWorktreeBranchName(generated.branch)
      if (targetBranch === oldBranch) {
        return
      }

      const renamed = yield* deps.git.renameBranch({ cwd, oldBranch, newBranch: targetBranch })
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.meta.update',
        commandId: deps.createWorktreeRenameCommandId(),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      })
    }).pipe(
      Effect.catchCause(cause =>
        Effect.logWarning('provider command reactor failed to generate or rename worktree branch', {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        })
      )
    )
  })
}

export function createGenerateThreadTitleForFirstTurn(
  deps: ProviderCommandReactorFirstTurnDeps,
  resolveThread: ProviderCommandReactorResolveThread
) {
  return Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId
    readonly cwd: string
    readonly messageText: string
    readonly attachments?: ReadonlyArray<ChatAttachment>
    readonly titleSeed?: string
  }) {
    const attachments = input.attachments ?? []
    yield* Effect.gen(function* () {
      const { textGenerationModelSelection: modelSelection } =
        yield* deps.serverSettingsService.getSettings
      const generated = yield* deps.textGeneration.generateThreadTitle({
        cwd: input.cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      })
      const thread = yield* resolveThread(input.threadId)
      if (!thread || !deps.canReplaceThreadTitle(thread.title, input.titleSeed)) {
        return
      }

      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.meta.update',
        commandId: deps.createThreadTitleRenameCommandId(),
        threadId: input.threadId,
        title: generated.title,
      })
    }).pipe(
      Effect.catchCause(cause =>
        Effect.logWarning('provider command reactor failed to generate or rename thread title', {
          threadId: input.threadId,
          cwd: input.cwd,
          cause: Cause.pretty(cause),
        })
      )
    )
  })
}
