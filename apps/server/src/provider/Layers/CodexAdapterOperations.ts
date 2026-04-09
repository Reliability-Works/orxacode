import type {
  ProviderApprovalDecision,
  ProviderSendTurnInput,
  ProviderUserInputAnswers,
  ThreadId,
} from '@orxa-code/contracts'
import { Effect, FileSystem } from 'effect'

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
} from '../Errors.ts'
import type { CodexAdapterShape } from '../Services/CodexAdapter.ts'
import type {
  CodexAppServerManager,
  CodexAppServerStartSessionInput,
} from '../../codexAppServerManager.ts'
import { resolveAttachmentPath } from '../../attachmentStore.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import { CODEX_PROVIDER, toMessage, toRequestError } from './CodexAdapterShared.ts'

type CodexAdapterOperationsDependencies = {
  readonly manager: CodexAppServerManager
  readonly attachmentsDir: string
  readonly fileSystem: FileSystem.FileSystem
  readonly serverSettingsService: ServerSettingsShape
}

function buildManagerStartSessionInput(
  input: Parameters<CodexAdapterShape['startSession']>[0],
  binaryPath: string,
  homePath: string | undefined
): CodexAppServerStartSessionInput {
  return {
    threadId: input.threadId,
    provider: CODEX_PROVIDER,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
    runtimeMode: input.runtimeMode,
    binaryPath,
    ...(homePath ? { homePath } : {}),
    ...(input.modelSelection?.provider === CODEX_PROVIDER
      ? { model: input.modelSelection.model }
      : {}),
    ...(input.modelSelection?.provider === CODEX_PROVIDER && input.modelSelection.options?.fastMode
      ? { serviceTier: 'fast' }
      : {}),
  }
}

const resolveAttachment = Effect.fn('resolveCodexAttachment')(function* (
  dependencies: CodexAdapterOperationsDependencies,
  input: ProviderSendTurnInput,
  attachment: NonNullable<ProviderSendTurnInput['attachments']>[number]
) {
  const attachmentPath = resolveAttachmentPath({
    attachmentsDir: dependencies.attachmentsDir,
    attachment,
  })
  if (!attachmentPath) {
    return yield* toRequestError(
      input.threadId,
      'turn/start',
      new Error(`Invalid attachment id '${attachment.id}'.`)
    )
  }
  const bytes = yield* dependencies.fileSystem.readFile(attachmentPath).pipe(
    Effect.mapError(
      cause =>
        new ProviderAdapterRequestError({
          provider: CODEX_PROVIDER,
          method: 'turn/start',
          detail: toMessage(cause, 'Failed to read attachment file.'),
          cause,
        })
    )
  )
  return {
    type: 'image' as const,
    url: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString('base64')}`,
  }
})

function createStartSessionOperation(
  manager: CodexAppServerManager,
  serverSettingsService: ServerSettingsShape
): CodexAdapterShape['startSession'] {
  return Effect.fn('startSession')(function* (input) {
    if (input.provider !== undefined && input.provider !== CODEX_PROVIDER) {
      return yield* new ProviderAdapterValidationError({
        provider: CODEX_PROVIDER,
        operation: 'startSession',
        issue: `Expected provider '${CODEX_PROVIDER}' but received '${input.provider}'.`,
      })
    }

    const codexSettings = yield* serverSettingsService.getSettings.pipe(
      Effect.map(settings => settings.providers.codex),
      Effect.mapError(
        error =>
          new ProviderAdapterProcessError({
            provider: CODEX_PROVIDER,
            threadId: input.threadId,
            detail: error.message,
            cause: error,
          })
      )
    )

    return yield* Effect.tryPromise({
      try: () =>
        manager.startSession(
          buildManagerStartSessionInput(input, codexSettings.binaryPath, codexSettings.homePath)
        ),
      catch: cause =>
        new ProviderAdapterProcessError({
          provider: CODEX_PROVIDER,
          threadId: input.threadId,
          detail: toMessage(cause, 'Failed to start Codex adapter session.'),
          cause,
        }),
    })
  })
}

function createSendTurnOperation(
  dependencies: CodexAdapterOperationsDependencies,
  manager: CodexAppServerManager
): CodexAdapterShape['sendTurn'] {
  return Effect.fn('sendTurn')(function* (input) {
    const codexAttachments = yield* Effect.forEach(
      input.attachments ?? [],
      attachment => resolveAttachment(dependencies, input, attachment),
      { concurrency: 1 }
    )

    return yield* Effect.tryPromise({
      try: () =>
        manager.sendTurn({
          threadId: input.threadId,
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(input.modelSelection?.provider === CODEX_PROVIDER
            ? { model: input.modelSelection.model }
            : {}),
          ...(input.modelSelection?.provider === CODEX_PROVIDER &&
          input.modelSelection.options?.reasoningEffort !== undefined
            ? { effort: input.modelSelection.options.reasoningEffort }
            : {}),
          ...(input.modelSelection?.provider === CODEX_PROVIDER &&
          input.modelSelection.options?.fastMode
            ? { serviceTier: 'fast' }
            : {}),
          ...(input.interactionMode !== undefined
            ? { interactionMode: input.interactionMode }
            : {}),
          ...(codexAttachments.length > 0 ? { attachments: codexAttachments } : {}),
        }),
      catch: cause => toRequestError(input.threadId, 'turn/start', cause),
    }).pipe(
      Effect.map(result => ({
        ...result,
        threadId: input.threadId,
      }))
    )
  })
}

function createThreadStateOperations(
  manager: CodexAppServerManager
): Pick<CodexAdapterShape, 'interruptTurn' | 'readThread' | 'rollbackThread'> {
  const interruptTurn: CodexAdapterShape['interruptTurn'] = (threadId, turnId, providerThreadId) =>
    Effect.tryPromise({
      try: () => manager.interruptTurn(threadId, turnId, providerThreadId),
      catch: cause => toRequestError(threadId, 'turn/interrupt', cause),
    })

  const readThread: CodexAdapterShape['readThread'] = threadId =>
    Effect.tryPromise({
      try: () => manager.readThread(threadId),
      catch: cause => toRequestError(threadId, 'thread/read', cause),
    }).pipe(
      Effect.map(snapshot => ({
        threadId,
        turns: snapshot.turns,
      }))
    )

  const rollbackThread: CodexAdapterShape['rollbackThread'] = (threadId, numTurns) => {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: CODEX_PROVIDER,
          operation: 'rollbackThread',
          issue: 'numTurns must be an integer >= 1.',
        })
      )
    }

    return Effect.tryPromise({
      try: () => manager.rollbackThread(threadId, numTurns),
      catch: cause => toRequestError(threadId, 'thread/rollback', cause),
    }).pipe(
      Effect.map(snapshot => ({
        threadId,
        turns: snapshot.turns,
      }))
    )
  }

  return {
    interruptTurn,
    readThread,
    rollbackThread,
  }
}

function createSessionControlOperations(
  manager: CodexAppServerManager
): Pick<
  CodexAdapterShape,
  | 'respondToRequest'
  | 'respondToUserInput'
  | 'stopSession'
  | 'listSessions'
  | 'hasSession'
  | 'stopAll'
> {
  const respondToRequest: CodexAdapterShape['respondToRequest'] = (
    threadId,
    requestId,
    decision: ProviderApprovalDecision
  ) =>
    Effect.tryPromise({
      try: () => manager.respondToRequest(threadId, requestId, decision),
      catch: cause => toRequestError(threadId, 'item/requestApproval/decision', cause),
    })

  const respondToUserInput: CodexAdapterShape['respondToUserInput'] = (
    threadId,
    requestId,
    answers: ProviderUserInputAnswers
  ) =>
    Effect.tryPromise({
      try: () => manager.respondToUserInput(threadId, requestId, answers),
      catch: cause => toRequestError(threadId, 'item/tool/requestUserInput', cause),
    })

  const stopSession: CodexAdapterShape['stopSession'] = (threadId: ThreadId) =>
    Effect.sync(() => {
      manager.stopSession(threadId)
    })

  const listSessions: CodexAdapterShape['listSessions'] = () =>
    Effect.sync(() => manager.listSessions())

  const hasSession: CodexAdapterShape['hasSession'] = (threadId: ThreadId) =>
    Effect.sync(() => manager.hasSession(threadId))

  const stopAll: CodexAdapterShape['stopAll'] = () =>
    Effect.sync(() => {
      manager.stopAll()
    })

  return {
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    stopAll,
  }
}

export function createCodexAdapterOperations(
  dependencies: CodexAdapterOperationsDependencies
): Omit<CodexAdapterShape, 'provider' | 'capabilities' | 'streamEvents'> {
  const { manager, serverSettingsService } = dependencies

  return {
    startSession: createStartSessionOperation(manager, serverSettingsService),
    sendTurn: createSendTurnOperation(dependencies, manager),
    ...createThreadStateOperations(manager),
    ...createSessionControlOperations(manager),
  }
}
