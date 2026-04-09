import { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import {
  ApprovalRequestId,
  EventId,
  type ProviderEvent,
  type ProviderSession,
} from '@orxa-code/contracts'
import type { CodexChildRoute } from './codexChildThreads'

import {
  readRouteFields,
  requestKindForMethod,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PendingApprovalRequest,
  type PendingRequest,
  type PendingRequestKey,
  type PendingUserInputRequest,
} from './codexAppServerManager.protocol'

export interface TransportContext {
  session: ProviderSession
  child: ChildProcessWithoutNullStreams
  pending: Map<PendingRequestKey, PendingRequest>
  pendingApprovals: Map<ApprovalRequestId, PendingApprovalRequest>
  pendingUserInputs: Map<ApprovalRequestId, PendingUserInputRequest>
  collabReceiverTurns: Map<string, CodexChildRoute>
  nextRequestId: number
}

export function writeMessage(context: TransportContext, message: unknown): void {
  const encoded = JSON.stringify(message)
  if (!context.child.stdin.writable) {
    throw new Error('Cannot write to codex app-server stdin.')
  }

  context.child.stdin.write(`${encoded}\n`)
}

export function sendRequest<TResponse>(
  context: TransportContext,
  method: string,
  params: unknown,
  timeoutMs = 20_000
): Promise<TResponse> {
  const id = context.nextRequestId
  context.nextRequestId += 1

  return new Promise<TResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      context.pending.delete(String(id))
      reject(new Error(`Timed out waiting for ${method}.`))
    }, timeoutMs)

    context.pending.set(String(id), {
      method,
      timeout,
      resolve: value => resolve(value as TResponse),
      reject,
    })
    writeMessage(context, {
      method,
      id,
      params,
    })
  })
}

export function handleResponse(context: TransportContext, response: JsonRpcResponse): void {
  const key = String(response.id)
  const pending = context.pending.get(key)
  if (!pending) {
    return
  }

  clearTimeout(pending.timeout)
  context.pending.delete(key)

  if (response.error?.message) {
    pending.reject(new Error(`${pending.method} failed: ${String(response.error.message)}`))
    return
  }

  pending.resolve(response.result)
}

export function handleServerRequest(
  context: TransportContext,
  request: JsonRpcRequest,
  childRoute: CodexChildRoute | undefined,
  emitEvent: (event: ProviderEvent) => void
): void {
  const rawRoute = readRouteFields(request.params)
  const effectiveTurnId = rawRoute.turnId
  const effectiveThreadId = childRoute?.childThreadId ?? context.session.threadId
  const requestKind = requestKindForMethod(request.method)
  let requestId: ApprovalRequestId | undefined
  if (requestKind) {
    requestId = ApprovalRequestId.makeUnsafe(randomUUID())
    const pendingRequest: PendingApprovalRequest = {
      requestId,
      jsonRpcId: request.id,
      method:
        requestKind === 'command'
          ? 'item/commandExecution/requestApproval'
          : requestKind === 'file-read'
            ? 'item/fileRead/requestApproval'
            : 'item/fileChange/requestApproval',
      requestKind,
      threadId: effectiveThreadId,
      ...(effectiveTurnId ? { turnId: effectiveTurnId } : {}),
      ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
    }
    context.pendingApprovals.set(requestId, pendingRequest)
  }

  if (request.method === 'item/tool/requestUserInput') {
    requestId = ApprovalRequestId.makeUnsafe(randomUUID())
    context.pendingUserInputs.set(requestId, {
      requestId,
      jsonRpcId: request.id,
      threadId: effectiveThreadId,
      ...(effectiveTurnId ? { turnId: effectiveTurnId } : {}),
      ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
    })
  }

  emitEvent({
    id: EventId.makeUnsafe(randomUUID()),
    kind: 'request',
    provider: 'codex',
    threadId: effectiveThreadId,
    createdAt: new Date().toISOString(),
    method: request.method,
    ...(effectiveTurnId ? { turnId: effectiveTurnId } : {}),
    ...(rawRoute.itemId ? { itemId: rawRoute.itemId } : {}),
    requestId,
    requestKind,
    payload: request.params,
  })

  if (requestKind) {
    return
  }

  if (request.method === 'item/tool/requestUserInput') {
    return
  }

  writeMessage(context, {
    id: request.id,
    error: {
      code: -32601,
      message: `Unsupported server request: ${request.method}`,
    },
  })
}
