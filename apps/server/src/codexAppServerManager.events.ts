import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderSession,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'

import {
  normalizeCodexModelSlug,
  readArrayField,
  readObjectField,
  readProviderConversationId,
  readStringField,
  type JsonRpcNotification,
  type PendingApprovalRequest,
  type PendingRequest,
  type PendingRequestKey,
  type PendingUserInputRequest,
} from './codexAppServerManager.protocol'

export type CodexSessionContextLike = {
  session: ProviderSession
  account: import('./provider/codexAccount').CodexAccountSnapshot
  child: ChildProcessWithoutNullStreams
  output: readline.Interface
  pending: Map<PendingRequestKey, PendingRequest>
  pendingApprovals: Map<ApprovalRequestId, PendingApprovalRequest>
  pendingUserInputs: Map<ApprovalRequestId, PendingUserInputRequest>
  collabReceiverTurns: Map<string, TurnId>
  nextRequestId: number
  stopping: boolean
}

export function buildLifecycleEvent(
  context: CodexSessionContextLike,
  method: string,
  message: string
): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'session',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method,
    message,
  }
}

export function buildErrorEvent(
  context: CodexSessionContextLike,
  method: string,
  message: string
): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'error',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method,
    message,
  }
}

export function buildNotificationEvent(
  context: CodexSessionContextLike,
  method: string,
  message: string
): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'notification',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method,
    message,
  }
}

export function buildStartFailedErrorEvent(threadId: ThreadId, message: string): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'error',
    provider: 'codex',
    threadId,
    createdAt: new Date().toISOString(),
    method: 'session/startFailed',
    message,
  }
}

export function buildApprovalDecisionEvent(
  context: CodexSessionContextLike,
  pendingRequest: PendingApprovalRequest,
  decision: ProviderApprovalDecision
): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'notification',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method: 'item/requestApproval/decision',
    turnId: pendingRequest.turnId,
    itemId: pendingRequest.itemId,
    requestId: pendingRequest.requestId,
    requestKind: pendingRequest.requestKind,
    payload: {
      requestId: pendingRequest.requestId,
      requestKind: pendingRequest.requestKind,
      decision,
    },
  }
}

export function buildUserInputAnsweredEvent(
  context: CodexSessionContextLike,
  pendingRequest: PendingUserInputRequest,
  codexAnswers: Record<string, { answers: string[] }>
): ProviderEvent {
  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'notification',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method: 'item/tool/requestUserInput/answered',
    turnId: pendingRequest.turnId,
    itemId: pendingRequest.itemId,
    requestId: pendingRequest.requestId,
    payload: {
      requestId: pendingRequest.requestId,
      answers: codexAnswers,
    },
  }
}

export function buildProviderNotificationEvent(
  context: CodexSessionContextLike,
  notification: JsonRpcNotification,
  rawRoute: { turnId?: TurnId; itemId?: import('@orxa-code/contracts').ProviderItemId },
  childParentTurnId: TurnId | undefined
): ProviderEvent {
  const textDelta =
    notification.method === 'item/agentMessage/delta'
      ? readStringField(notification.params, 'delta')
      : undefined

  return {
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'notification',
    provider: 'codex',
    threadId: context.session.threadId,
    createdAt: new Date().toISOString(),
    method: notification.method,
    ...((childParentTurnId ?? rawRoute.turnId)
      ? { turnId: childParentTurnId ?? rawRoute.turnId }
      : {}),
    ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
    textDelta,
    payload: notification.params,
  }
}

export interface CreateSessionInput {
  readonly threadId: ThreadId
  readonly cwd?: string
  readonly model?: string
  readonly serviceTier?: string
  readonly resumeCursor?: unknown
  readonly binaryPath: string
  readonly homePath?: string
  readonly runtimeMode: import('@orxa-code/contracts').RuntimeMode
}

export function createSessionContext(
  input: CreateSessionInput,
  now: string,
  resolvedCwd: string
): CodexSessionContextLike {
  const session: ProviderSession = {
    provider: 'codex',
    status: 'connecting',
    runtimeMode: input.runtimeMode,
    model: normalizeCodexModelSlug(input.model),
    cwd: resolvedCwd,
    threadId: input.threadId,
    createdAt: now,
    updatedAt: now,
  }
  const codexHomePath = input.homePath

  const child = spawn(input.binaryPath, ['app-server'], {
    cwd: resolvedCwd,
    env: {
      ...process.env,
      ...(codexHomePath ? { CODEX_HOME: codexHomePath } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  return {
    session,
    account: {
      type: 'unknown',
      planType: null,
      sparkEnabled: true,
    },
    child,
    output: readline.createInterface({ input: child.stdout }),
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map(),
    nextRequestId: 1,
    stopping: false,
  }
}

export function readChildParentTurnId(
  context: CodexSessionContextLike,
  params: unknown
): TurnId | undefined {
  const providerConversationId = readProviderConversationId(params)
  if (!providerConversationId) {
    return undefined
  }
  return context.collabReceiverTurns.get(providerConversationId)
}

export function rememberCollabReceiverTurns(
  context: CodexSessionContextLike,
  params: unknown,
  parentTurnId: TurnId | undefined
): void {
  if (!parentTurnId) {
    return
  }
  const payload = readObjectField(params)
  const item = readObjectField(payload, 'item') ?? payload
  const itemType = readStringField(item, 'type') ?? readStringField(item, 'kind')
  if (itemType !== 'collabAgentToolCall') {
    return
  }

  const receiverThreadIds =
    readArrayField(item, 'receiverThreadIds')
      ?.map(value => (typeof value === 'string' ? value : null))
      .filter((value): value is string => value !== null) ?? []
  for (const receiverThreadId of receiverThreadIds) {
    context.collabReceiverTurns.set(receiverThreadId, parentTurnId)
  }
}
