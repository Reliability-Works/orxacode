import { type ProviderSession, TurnId } from '@orxa-code/contracts'
import type { CodexChildRoute } from './codexChildThreads'

import {
  normalizeProviderThreadId,
  readBooleanField,
  readObjectField,
  readStringField,
  toTurnId,
  type JsonRpcNotification,
} from './codexAppServerManager.protocol'

export interface NotificationSessionLike {
  session: ProviderSession
  collabReceiverTurns: Map<string, CodexChildRoute>
}

export type SessionUpdateFn = (updates: Partial<ProviderSession>) => void

export function applySessionNotificationStateExternal(
  context: NotificationSessionLike,
  notification: JsonRpcNotification,
  rawTurnId: TurnId | undefined,
  isChildConversation: boolean,
  updateSession: SessionUpdateFn
): void {
  switch (notification.method) {
    case 'thread/started':
      handleThreadStartedNotification(notification, updateSession)
      return
    case 'turn/started':
      if (!isChildConversation) {
        handleTurnStartedNotification(notification, rawTurnId, updateSession)
      }
      return
    case 'turn/completed':
      if (!isChildConversation) {
        handleTurnCompletedNotification(context, notification, updateSession)
      }
      return
    case 'error':
      if (!isChildConversation) {
        handleErrorNotification(context, notification, updateSession)
      }
      return
    default:
      return
  }
}

function handleThreadStartedNotification(
  notification: JsonRpcNotification,
  updateSession: SessionUpdateFn
): void {
  const providerThreadId = normalizeProviderThreadId(
    readStringField(readObjectField(notification.params)?.thread, 'id')
  )
  if (providerThreadId) {
    updateSession({ resumeCursor: { threadId: providerThreadId } })
  }
}

function handleTurnStartedNotification(
  notification: JsonRpcNotification,
  rawTurnId: TurnId | undefined,
  updateSession: SessionUpdateFn
): void {
  const turnId =
    rawTurnId ?? toTurnId(readStringField(readObjectField(notification.params)?.turn, 'id'))
  updateSession({
    status: 'running',
    activeTurnId: turnId,
  })
}

function handleTurnCompletedNotification(
  context: NotificationSessionLike,
  notification: JsonRpcNotification,
  updateSession: SessionUpdateFn
): void {
  context.collabReceiverTurns.clear()
  const turn = readObjectField(notification.params, 'turn')
  const status = readStringField(turn, 'status')
  const errorMessage = readStringField(readObjectField(turn, 'error'), 'message')

  updateSession({
    status: status === 'failed' ? 'error' : 'ready',
    activeTurnId: undefined,
    lastError: errorMessage ?? context.session.lastError,
  })
}

function handleErrorNotification(
  context: NotificationSessionLike,
  notification: JsonRpcNotification,
  updateSession: SessionUpdateFn
): void {
  const message = readStringField(readObjectField(notification.params)?.error, 'message')
  const willRetry = readBooleanField(notification.params, 'willRetry')

  updateSession({
    status: willRetry ? 'running' : 'error',
    lastError: message ?? context.session.lastError,
  })
}
