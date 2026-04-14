/**
 * Opencode adapter runtime method bindings.
 *
 * Hosts the `OpencodeAdapterShape` method implementations that operate on an
 * already-started session and have no business living inside the session
 * lifecycle, turn dispatch, or event-pump modules: `readThread`,
 * `rollbackThread`, `stopSession`, `listSessions`, `hasSession`, `stopAll`,
 * `respondToRequest`, and `respondToUserInput`.
 *
 * Mirrors `ClaudeAdapter.runtime.methods.ts` but is thinner because:
 *   - opencode does not maintain a per-turn item history at the runtime
 *     layer, so `readThread` returns an empty turn array; the orchestration
 *     layer is the source of truth for thread snapshots in this provider.
 *   - `rollbackThread` is structurally a no-op because we have nothing to
 *     splice; it returns the same empty snapshot.
 *
 * `respondToRequest` + `respondToUserInput` forward the UI decision to
 * opencode's permission/question reply endpoints. Pending requests are
 * tracked in `context.pendingPermissions` / `context.pendingQuestions` by
 * the event pump; that bookkeeping lets us translate our contract shape
 * (`ProviderApprovalDecision` / answers keyed by question id) into
 * opencode's wire shape (`"once" | "always" | "reject"` / positional
 * `Array<Array<string>>`).
 *
 * @module OpencodeAdapter.runtime.methods
 */
import {
  type ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderUserInputAnswers,
  type ThreadId,
} from '@orxa-code/contracts'
import { Effect } from 'effect'

import { ProviderAdapterRequestError } from '../Errors.ts'
import type { OpencodeAdapterShape } from '../Services/OpencodeAdapter.ts'
import type { OpencodeAdapterDeps } from './OpencodeAdapter.deps.ts'
import { requireOpencodeSession } from './OpencodeAdapter.runtime.eventBase.ts'
import {
  rejectOpencodeQuestion,
  replyOpencodePermission,
  replyOpencodeQuestion,
} from './OpencodeAdapter.sdk.ts'
import { stopSessionInternal } from './OpencodeAdapter.runtime.session.ts'
import { PROVIDER, type OpencodeSessionContext } from './OpencodeAdapter.types.ts'

function emptySnapshot(threadId: ThreadId): {
  readonly threadId: ThreadId
  readonly turns: ReadonlyArray<{ readonly id: never; readonly items: ReadonlyArray<unknown> }>
} {
  return { threadId, turns: [] }
}

export const readThread =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['readThread'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.map((context: OpencodeSessionContext) => emptySnapshot(context.session.threadId))
    )

export const rollbackThread =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['rollbackThread'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.map((context: OpencodeSessionContext) => emptySnapshot(context.session.threadId))
    )

function mapDecisionToPermissionReply(
  decision: ProviderApprovalDecision
): 'once' | 'always' | 'reject' {
  switch (decision) {
    case 'accept':
      return 'once'
    case 'acceptForSession':
      return 'always'
    case 'decline':
    case 'cancel':
      return 'reject'
  }
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return fallback
}

export const respondToRequest =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['respondToRequest'] =>
  (threadId: ThreadId, requestId: ApprovalRequestId, decision: ProviderApprovalDecision) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.flatMap((context: OpencodeSessionContext) =>
        Effect.tryPromise({
          try: () =>
            replyOpencodePermission({
              client: context.runtime.client,
              requestID: requestId,
              reply: mapDecisionToPermissionReply(decision),
              ...(context.session.cwd ? { directory: context.session.cwd } : {}),
            }),
          catch: cause =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: 'opencode:permission.reply',
              detail: `[thread ${threadId}] ${toErrorMessage(cause, 'permission.reply failed')}`,
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              context.pendingPermissions.delete(requestId)
            })
          )
        )
      )
    )

export const respondToUserInput =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['respondToUserInput'] =>
  (threadId: ThreadId, requestId: ApprovalRequestId, answers: ProviderUserInputAnswers) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.flatMap((context: OpencodeSessionContext) => {
        const pending = context.pendingQuestions.get(requestId)
        if (!pending) {
          return Effect.fail(
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: 'opencode:question.reply',
              detail:
                `Cannot reply to opencode question ${requestId} on thread ${threadId}: ` +
                `no pending question found. It may have already been answered or rejected.`,
            })
          )
        }
        const answerKeys = Object.keys(answers)
        const hasAnyAnswer = answerKeys.length > 0
        if (!hasAnyAnswer) {
          return Effect.tryPromise({
            try: () =>
              rejectOpencodeQuestion({
                client: context.runtime.client,
                requestID: requestId,
                ...(context.session.cwd ? { directory: context.session.cwd } : {}),
              }),
            catch: cause =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: 'opencode:question.reject',
                detail: `[thread ${threadId}] ${toErrorMessage(cause, 'question.reject failed')}`,
                cause,
              }),
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                context.pendingQuestions.delete(requestId)
              })
            )
          )
        }
        // Rebuild opencode's positional Array<Array<string>>. For each original
        // question id (in order), coerce whatever the renderer sent into an
        // array of strings. Missing ids become empty slots so the array stays
        // aligned with the original questions.
        const positional: Array<Array<string>> = pending.questionIds.map(id => {
          const raw = answers[id]
          if (Array.isArray(raw)) {
            return raw.filter((v): v is string => typeof v === 'string')
          }
          if (typeof raw === 'string') {
            return [raw]
          }
          return []
        })
        return Effect.tryPromise({
          try: () =>
            replyOpencodeQuestion({
              client: context.runtime.client,
              requestID: requestId,
              answers: positional,
              ...(context.session.cwd ? { directory: context.session.cwd } : {}),
            }),
          catch: cause =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: 'opencode:question.reply',
              detail: `[thread ${threadId}] ${toErrorMessage(cause, 'question.reply failed')}`,
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              context.pendingQuestions.delete(requestId)
            })
          )
        )
      })
    )

export const stopSession =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['stopSession'] =>
  (threadId: ThreadId) =>
    requireOpencodeSession(deps, threadId).pipe(
      Effect.flatMap(context => stopSessionInternal(deps, context, { emitExitEvent: true }))
    )

export const listSessions =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['listSessions'] =>
  () =>
    Effect.sync(() => Array.from(deps.sessions.values(), context => ({ ...context.session })))

export const hasSession =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['hasSession'] =>
  (threadId: ThreadId) =>
    Effect.sync(() => {
      const context = deps.sessions.get(threadId)
      return context !== undefined && !context.stopped
    })

export const stopAll =
  (deps: OpencodeAdapterDeps): OpencodeAdapterShape['stopAll'] =>
  () =>
    Effect.forEach(
      deps.sessions,
      ([, context]) => stopSessionInternal(deps, context, { emitExitEvent: true }),
      { discard: true }
    )
