/**
 * Claude adapter runtime method helpers.
 *
 * Hosts the `ClaudeAdapterShape` method implementations that operate on an
 * already-started session: turn begin/send, interrupt, read/rollback thread,
 * approval/user-input responses, stop/list/hasSession/stopAll. Startup and
 * stream-lifecycle helpers live in `ClaudeAdapter.runtime.session.ts`.
 *
 * @module ClaudeAdapter.runtime.methods
 */
import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderSendTurnInput,
  type ProviderUserInputAnswers,
  type ThreadId,
} from '@orxa-code/contracts'
import { resolveApiModelId } from '@orxa-code/shared/model'
import { Deferred, Effect, Queue } from 'effect'

import { ProviderAdapterRequestError } from '../Errors.ts'
import type { ClaudeAdapterShape } from '../Services/ClaudeAdapter.ts'
import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import { buildUserMessageEffect } from './ClaudeAdapter.pure.ts'
import { updateResumeCursor } from './ClaudeAdapter.runtime.events.ts'
import { requireSession, stopSessionInternal } from './ClaudeAdapter.runtime.session.ts'
import {
  completeTurn,
  emitTurnStarted,
  snapshotThread,
  startNewTurn,
} from './ClaudeAdapter.runtime.turns.ts'
import { toRequestError } from './ClaudeAdapter.sdk.ts'
import {
  PROVIDER,
  type ClaudeModelSelection,
  type ClaudeSessionContext,
} from './ClaudeAdapter.types.ts'

export const syncTurnModelSelection = Effect.fn('syncTurnModelSelection')(function* (
  _deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  threadId: ThreadId,
  modelSelection: ClaudeModelSelection | undefined
) {
  if (!modelSelection?.model) {
    return
  }

  const apiModelId = resolveApiModelId(modelSelection)
  if (context.currentApiModelId !== apiModelId) {
    yield* Effect.tryPromise({
      try: () => context.query.setModel(apiModelId),
      catch: cause => toRequestError(threadId, 'turn/setModel', cause),
    })
    context.currentApiModelId = apiModelId
  }

  context.session = {
    ...context.session,
    model: modelSelection.model,
  }
})

export const applyTurnInteractionMode = Effect.fn('applyTurnInteractionMode')(function* (
  _deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  threadId: ThreadId,
  interactionMode: ProviderSendTurnInput['interactionMode']
) {
  const permissionMode =
    interactionMode === 'plan'
      ? 'plan'
      : interactionMode === 'default'
        ? (context.basePermissionMode ?? 'bypassPermissions')
        : undefined
  if (!permissionMode) {
    return
  }

  yield* Effect.tryPromise({
    try: () => context.query.setPermissionMode(permissionMode),
    catch: cause => toRequestError(threadId, 'turn/setPermissionMode', cause),
  })
})

export const beginTurn = Effect.fn('beginTurn')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  modelSelection: ClaudeModelSelection | undefined
) {
  const { turnId } = yield* startNewTurn(deps, context)

  context.session = {
    ...context.session,
    status: 'running',
    activeTurnId: turnId,
    updatedAt: yield* deps.nowIso,
  }

  yield* emitTurnStarted(deps, context, turnId, {
    payload: modelSelection?.model ? { model: modelSelection.model } : {},
    providerRefs: {},
  })

  return turnId
})

export const sendTurn = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['sendTurn'] =>
  Effect.fn('sendTurn')(function* (input) {
    const context = yield* requireSession(deps, input.threadId)
    const modelSelection =
      input.modelSelection?.provider === 'claudeAgent' ? input.modelSelection : undefined

    if (context.turnState) {
      // Auto-close a stale synthetic turn (from background agent responses
      // between user prompts) to prevent blocking the user's next turn.
      yield* completeTurn(deps, context, 'completed')
    }

    yield* syncTurnModelSelection(deps, context, input.threadId, modelSelection)
    yield* applyTurnInteractionMode(deps, context, input.threadId, input.interactionMode)
    const turnId = yield* beginTurn(deps, context, modelSelection)

    const message = yield* buildUserMessageEffect(input, {
      fileSystem: deps.fileSystem,
      attachmentsDir: deps.serverConfig.attachmentsDir,
    })

    yield* Queue.offer(context.promptQueue, {
      type: 'message',
      message,
    }).pipe(Effect.mapError(cause => toRequestError(input.threadId, 'turn/start', cause)))

    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    }
  })

export const interruptTurn = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['interruptTurn'] =>
  Effect.fn('interruptTurn')(function* (threadId) {
    const context = yield* requireSession(deps, threadId)
    yield* Effect.tryPromise({
      try: () => context.query.interrupt(),
      catch: cause => toRequestError(threadId, 'turn/interrupt', cause),
    })
  })

export const readThread = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['readThread'] =>
  Effect.fn('readThread')(function* (threadId) {
    const context = yield* requireSession(deps, threadId)
    return yield* snapshotThread(deps, context)
  })

export const rollbackThread = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['rollbackThread'] =>
  Effect.fn('rollbackThread')(function* (threadId, numTurns) {
    const context = yield* requireSession(deps, threadId)
    const nextLength = Math.max(0, context.turns.length - numTurns)
    context.turns.splice(nextLength)
    yield* updateResumeCursor(deps, context)
    return yield* snapshotThread(deps, context)
  })

export const respondToRequest = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['respondToRequest'] =>
  Effect.fn('respondToRequest')(function* (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision
  ) {
    const context = yield* requireSession(deps, threadId)
    const pending = context.pendingApprovals.get(requestId)
    if (!pending) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: 'item/requestApproval/decision',
        detail: `Unknown pending approval request: ${requestId}`,
      })
    }

    context.pendingApprovals.delete(requestId)
    yield* Deferred.succeed(pending.decision, decision)
  })

export const respondToUserInput = (
  deps: ClaudeAdapterDeps
): ClaudeAdapterShape['respondToUserInput'] =>
  Effect.fn('respondToUserInput')(function* (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers
  ) {
    const context = yield* requireSession(deps, threadId)
    const pending = context.pendingUserInputs.get(requestId)
    if (!pending) {
      return yield* new ProviderAdapterRequestError({
        provider: PROVIDER,
        method: 'item/tool/respondToUserInput',
        detail: `Unknown pending user-input request: ${requestId}`,
      })
    }

    context.pendingUserInputs.delete(requestId)
    yield* Deferred.succeed(pending.answers, answers)
  })

export const stopSession = (deps: ClaudeAdapterDeps): ClaudeAdapterShape['stopSession'] =>
  Effect.fn('stopSession')(function* (threadId) {
    const context = yield* requireSession(deps, threadId)
    yield* stopSessionInternal(deps, context, {
      emitExitEvent: true,
    })
  })

export const listSessions =
  (deps: ClaudeAdapterDeps): ClaudeAdapterShape['listSessions'] =>
  () =>
    Effect.sync(() => Array.from(deps.sessions.values(), ({ session }) => ({ ...session })))

export const hasSession =
  (deps: ClaudeAdapterDeps): ClaudeAdapterShape['hasSession'] =>
  threadId =>
    Effect.sync(() => {
      const context = deps.sessions.get(threadId)
      return context !== undefined && !context.stopped
    })

export const stopAll =
  (deps: ClaudeAdapterDeps): ClaudeAdapterShape['stopAll'] =>
  () =>
    Effect.forEach(
      deps.sessions,
      ([, context]) =>
        stopSessionInternal(deps, context, {
          emitExitEvent: true,
        }),
      { discard: true }
    )
