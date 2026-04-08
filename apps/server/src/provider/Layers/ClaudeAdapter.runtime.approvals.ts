/**
 * Claude adapter runtime approvals + can-use-tool helpers.
 *
 * Hosts the approval-request lifecycle (open/resolve), the AskUserQuestion
 * handler, and the `buildCanUseTool` factory that wires those flows into the
 * SDK's `canUseTool` permission callback. Each helper is a top-level function
 * that takes the shared `ClaudeAdapterDeps`.
 *
 * @module ClaudeAdapter.runtime.approvals
 */
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import {
  ApprovalRequestId,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ThreadId,
  type UserInputQuestion,
} from '@orxa-code/contracts'
import { Deferred, Effect, Random, Ref } from 'effect'

import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import {
  asRuntimeRequestId,
  classifyRequestType,
  summarizeToolRequest,
} from './ClaudeAdapter.pure.ts'
import { emitProposedPlanCompleted } from './ClaudeAdapter.runtime.events.ts'
import { buildRequestEventBase } from './ClaudeAdapter.runtime.eventBase.ts'
import {
  extractExitPlanModePlan,
  parseAskUserQuestions,
  resolveApprovalDecision,
} from './ClaudeAdapter.sdk.ts'
import {
  type ClaudeSessionContext,
  type EffectForkRunner,
  type PendingApproval,
  type PendingUserInput,
} from './ClaudeAdapter.types.ts'

export const emitAskUserQuestionRequested = Effect.fn('emitAskUserQuestionRequested')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  requestId: ApprovalRequestId,
  questions: ReadonlyArray<UserInputQuestion>,
  callbackOptions: { readonly toolUseID?: string },
  toolInput: Record<string, unknown>
) {
  const requestedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'user-input.requested',
    ...buildRequestEventBase(
      context,
      requestedStamp,
      asRuntimeRequestId(requestId),
      callbackOptions.toolUseID
    ),
    payload: { questions },
    raw: {
      source: 'claude.sdk.permission',
      method: 'canUseTool/AskUserQuestion',
      payload: { toolName: 'AskUserQuestion', input: toolInput },
    },
  })
})

export const emitAskUserQuestionResolved = Effect.fn('emitAskUserQuestionResolved')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  callbackOptions: { readonly toolUseID?: string }
) {
  const resolvedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'user-input.resolved',
    ...buildRequestEventBase(
      context,
      resolvedStamp,
      asRuntimeRequestId(requestId),
      callbackOptions.toolUseID
    ),
    payload: { answers },
    raw: {
      source: 'claude.sdk.permission',
      method: 'canUseTool/AskUserQuestion/resolved',
      payload: { answers },
    },
  })
})

export const emitApprovalRequestOpened = Effect.fn('emitApprovalRequestOpened')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  requestId: ApprovalRequestId,
  requestType: CanonicalRequestType,
  detail: string | undefined,
  toolName: Parameters<CanUseTool>[0],
  toolInput: Parameters<CanUseTool>[1],
  callbackOptions: Parameters<CanUseTool>[2]
) {
  const requestedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'request.opened',
    ...buildRequestEventBase(
      context,
      requestedStamp,
      asRuntimeRequestId(requestId),
      callbackOptions.toolUseID
    ),
    payload: {
      requestType,
      detail,
      args: {
        toolName,
        input: toolInput,
        ...(callbackOptions.toolUseID ? { toolUseId: callbackOptions.toolUseID } : {}),
      },
    },
    raw: {
      source: 'claude.sdk.permission',
      method: 'canUseTool/request',
      payload: {
        toolName,
        input: toolInput,
      },
    },
  })
})

export const emitApprovalRequestResolved = Effect.fn('emitApprovalRequestResolved')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  requestId: ApprovalRequestId,
  requestType: CanonicalRequestType,
  decision: ProviderApprovalDecision,
  callbackOptions: Parameters<CanUseTool>[2]
) {
  const resolvedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'request.resolved',
    ...buildRequestEventBase(
      context,
      resolvedStamp,
      asRuntimeRequestId(requestId),
      callbackOptions.toolUseID
    ),
    payload: {
      requestType,
      decision,
    },
    raw: {
      source: 'claude.sdk.permission',
      method: 'canUseTool/decision',
      payload: {
        decision,
      },
    },
  })
})

export const handleApprovalRequest = Effect.fn('handleApprovalRequest')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  toolName: Parameters<CanUseTool>[0],
  toolInput: Parameters<CanUseTool>[1],
  callbackOptions: Parameters<CanUseTool>[2],
  pendingApprovals: Map<ApprovalRequestId, PendingApproval>,
  runFork: EffectForkRunner
) {
  const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4)
  const requestType = classifyRequestType(toolName)
  const detail = summarizeToolRequest(toolName, toolInput)
  const decisionDeferred = yield* Deferred.make<ProviderApprovalDecision>()
  const pendingApproval: PendingApproval = {
    requestType,
    detail,
    decision: decisionDeferred,
    ...(callbackOptions.suggestions ? { suggestions: callbackOptions.suggestions } : {}),
  }

  yield* emitApprovalRequestOpened(
    deps,
    context,
    requestId,
    requestType,
    detail,
    toolName,
    toolInput,
    callbackOptions
  )
  pendingApprovals.set(requestId, pendingApproval)

  const onAbort = () => {
    if (!pendingApprovals.has(requestId)) {
      return
    }
    pendingApprovals.delete(requestId)
    runFork(Deferred.succeed(decisionDeferred, 'cancel'))
  }

  callbackOptions.signal.addEventListener('abort', onAbort, {
    once: true,
  })

  const decision = yield* Deferred.await(decisionDeferred)
  pendingApprovals.delete(requestId)
  yield* emitApprovalRequestResolved(
    deps,
    context,
    requestId,
    requestType,
    decision,
    callbackOptions
  )
  return resolveApprovalDecision(decision, pendingApproval, toolInput)
})

export const handleAskUserQuestion = Effect.fn('handleAskUserQuestion')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  toolInput: Record<string, unknown>,
  callbackOptions: { readonly signal: AbortSignal; readonly toolUseID?: string },
  pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>,
  runFork: EffectForkRunner
) {
  const requestId = ApprovalRequestId.makeUnsafe(yield* Random.nextUUIDv4)
  const questions = parseAskUserQuestions(toolInput)
  const answersDeferred = yield* Deferred.make<ProviderUserInputAnswers>()
  let aborted = false
  const pendingInput: PendingUserInput = {
    questions,
    answers: answersDeferred,
  }

  yield* emitAskUserQuestionRequested(
    deps,
    context,
    requestId,
    questions,
    callbackOptions,
    toolInput
  )
  pendingUserInputs.set(requestId, pendingInput)

  const onAbort = () => {
    if (!pendingUserInputs.has(requestId)) {
      return
    }
    aborted = true
    pendingUserInputs.delete(requestId)
    runFork(Deferred.succeed(answersDeferred, {} as ProviderUserInputAnswers))
  }
  callbackOptions.signal.addEventListener('abort', onAbort, { once: true })

  const answers = yield* Deferred.await(answersDeferred)
  pendingUserInputs.delete(requestId)
  yield* emitAskUserQuestionResolved(deps, context, requestId, answers, callbackOptions)

  if (aborted) {
    return {
      behavior: 'deny',
      message: 'User cancelled tool execution.',
    } satisfies PermissionResult
  }

  return {
    behavior: 'allow',
    updatedInput: {
      questions: toolInput.questions,
      answers,
    },
  } satisfies PermissionResult
})

export const buildCanUseTool = Effect.fn('buildCanUseTool')(function* (
  deps: ClaudeAdapterDeps,
  input: {
    readonly threadId: ThreadId
    readonly runtimeMode: ProviderSession['runtimeMode']
    readonly contextRef: Ref.Ref<ClaudeSessionContext | undefined>
    readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>
    readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>
  }
) {
  const services = yield* Effect.services()
  const runFork = Effect.runForkWith(services)
  const runPromise = Effect.runPromiseWith(services)

  const canUseToolEffect = Effect.fn('canUseTool')(function* (
    toolName: Parameters<CanUseTool>[0],
    toolInput: Parameters<CanUseTool>[1],
    callbackOptions: Parameters<CanUseTool>[2]
  ) {
    const context = yield* Ref.get(input.contextRef)
    if (!context) {
      return {
        behavior: 'deny',
        message: 'Claude session context is unavailable.',
      } satisfies PermissionResult
    }

    if (toolName === 'AskUserQuestion') {
      return yield* handleAskUserQuestion(
        deps,
        context,
        toolInput,
        callbackOptions,
        input.pendingUserInputs,
        runFork
      )
    }

    if (toolName === 'ExitPlanMode') {
      const planMarkdown = extractExitPlanModePlan(toolInput)
      if (planMarkdown) {
        yield* emitProposedPlanCompleted(deps, context, {
          planMarkdown,
          toolUseId: callbackOptions.toolUseID,
          rawSource: 'claude.sdk.permission',
          rawMethod: 'canUseTool/ExitPlanMode',
          rawPayload: {
            toolName,
            input: toolInput,
          },
        })
      }

      return {
        behavior: 'deny',
        message:
          "The client captured your proposed plan. Stop here and wait for the user's feedback or implementation request in a later turn.",
      } satisfies PermissionResult
    }

    if ((input.runtimeMode ?? 'full-access') === 'full-access') {
      return {
        behavior: 'allow',
        updatedInput: toolInput,
      } satisfies PermissionResult
    }

    return yield* handleApprovalRequest(
      deps,
      context,
      toolName,
      toolInput,
      callbackOptions,
      input.pendingApprovals,
      runFork
    )
  })

  return ((toolName, toolInput, callbackOptions) =>
    runPromise(canUseToolEffect(toolName, toolInput, callbackOptions))) satisfies CanUseTool
})
