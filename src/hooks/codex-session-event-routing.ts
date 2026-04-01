import type { MutableRefObject } from 'react'
import type { CodexNotification } from '@shared/ipc'
import type { SubagentInfo } from './codex-subagent-helpers'
import { extractSubagentMeta } from './codex-subagent-helpers'
import {
  getNotificationThreadId,
  getParentThreadIdFromSource,
} from './codex-session-notification-helpers'
import { asString } from './codex-session-notification-dispatch'

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseNotificationParams(notification: CodexNotification): Record<string, unknown> {
  if (notification.params && typeof notification.params === 'object' && !Array.isArray(notification.params)) {
    return notification.params as Record<string, unknown>
  }
  return {}
}

// ---------------------------------------------------------------------------
// Ownership check: does this notification belong to the active session?
// ---------------------------------------------------------------------------

type OwnershipContext = {
  method: string
  notificationThreadId: string | null
  notificationParams: Record<string, unknown>
  activeThreadId: string | null
  activeTurnId: string | null
  trackedSubagentIds: Set<string>
}

type OwnershipResult = {
  isOwned: boolean
  isTrackedSubagent: boolean
}

function checkNotificationOwnership(ctx: OwnershipContext): OwnershipResult {
  const { method, notificationThreadId, notificationParams, activeThreadId, activeTurnId, trackedSubagentIds } = ctx

  const isKnownTrackedThread =
    !!notificationThreadId &&
    (notificationThreadId === activeThreadId || trackedSubagentIds.has(notificationThreadId))

  const isTrackedSubagent =
    !!notificationThreadId &&
    !!activeThreadId &&
    notificationThreadId !== activeThreadId &&
    trackedSubagentIds.has(notificationThreadId)

  if (isKnownTrackedThread) {
    return { isOwned: true, isTrackedSubagent }
  }

  const couldBelongImplicitly =
    !!activeThreadId &&
    !notificationThreadId &&
    (method.startsWith('turn/') || method.startsWith('item/') || method === 'thread/status/changed')

  if (couldBelongImplicitly) {
    return { isOwned: true, isTrackedSubagent: false }
  }

  if (method === 'thread/started') {
    const threadSource = asRecord(notificationParams.thread)?.source
    if (getParentThreadIdFromSource(threadSource) === activeThreadId) {
      return { isOwned: true, isTrackedSubagent: false }
    }
    if (activeThreadId && activeTurnId && extractSubagentMeta(threadSource)) {
      return { isOwned: true, isTrackedSubagent: false }
    }
  }

  return { isOwned: false, isTrackedSubagent: false }
}

// ---------------------------------------------------------------------------
// Bookkeeping: track item/turn ↔ thread and clean up archived threads
// ---------------------------------------------------------------------------

type BookkeepingContext = {
  method: string
  notificationParams: Record<string, unknown>
  notificationThreadId: string | null
  subagentThreadIds: MutableRefObject<Set<string>>
  itemThreadIdsRef: MutableRefObject<Map<string, string>>
  turnThreadIdsRef: MutableRefObject<Map<string, string>>
  setActiveSubagentThreadIdState: (updater: (current: string | null) => string | null) => void
  setSubagentsState: (updater: (previous: SubagentInfo[]) => SubagentInfo[]) => void
}

function applyNotificationBookkeeping(ctx: BookkeepingContext) {
  const {
    method,
    notificationParams,
    notificationThreadId,
    subagentThreadIds,
    itemThreadIdsRef,
    turnThreadIdsRef,
    setActiveSubagentThreadIdState,
    setSubagentsState,
  } = ctx

  const itemId = asString(notificationParams.itemId ?? asRecord(notificationParams.item)?.id).trim()
  const turnId = asString(notificationParams.turnId ?? asRecord(notificationParams.turn)?.id).trim()

  if ((method === 'item/started' || method === 'item/completed') && itemId && notificationThreadId) {
    itemThreadIdsRef.current.set(itemId, notificationThreadId)
    if (method === 'item/completed') {
      itemThreadIdsRef.current.delete(itemId)
    }
  }

  if ((method === 'turn/started' || method === 'turn/completed') && turnId && notificationThreadId) {
    turnThreadIdsRef.current.set(turnId, notificationThreadId)
    if (method === 'turn/completed') {
      turnThreadIdsRef.current.delete(turnId)
    }
  }

  if (notificationThreadId && (method === 'thread/archived' || method === 'thread/closed')) {
    subagentThreadIds.current.delete(notificationThreadId)
    setActiveSubagentThreadIdState(current => (current === notificationThreadId ? null : current))
    setSubagentsState(previous => previous.filter(agent => agent.threadId !== notificationThreadId))
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RouteCodexNotificationParams = {
  notification: CodexNotification
  activeThreadId: string | null
  activeTurnIdRef: MutableRefObject<string | null>
  subagentThreadIds: MutableRefObject<Set<string>>
  itemThreadIdsRef: MutableRefObject<Map<string, string>>
  turnThreadIdsRef: MutableRefObject<Map<string, string>>
  setActiveSubagentThreadIdState: (updater: (current: string | null) => string | null) => void
  setSubagentsState: (updater: (previous: SubagentInfo[]) => SubagentInfo[]) => void
}

/**
 * Routes a codex notification to determine whether it should be dispatched to
 * the active session handler. Also updates thread-tracking bookkeeping refs as
 * a side-effect.
 *
 * Returns `'dispatch'` when the caller should feed the notification into the
 * main `handleNotification` path, or `'skip'` when the notification should be
 * silently dropped (e.g. belongs to a tracked-but-inactive subagent thread).
 */
export function routeCodexNotification(params: RouteCodexNotificationParams): 'dispatch' | 'skip' {
  const { notification, activeThreadId, activeTurnIdRef, subagentThreadIds, itemThreadIdsRef, turnThreadIdsRef } =
    params
  const notificationParams = parseNotificationParams(notification)
  const notificationThreadId = getNotificationThreadId(
    notification.method,
    notificationParams,
    itemThreadIdsRef.current,
    turnThreadIdsRef.current
  )

  const { isOwned, isTrackedSubagent } = checkNotificationOwnership({
    method: notification.method,
    notificationThreadId,
    notificationParams,
    activeThreadId,
    activeTurnId: activeTurnIdRef.current,
    trackedSubagentIds: subagentThreadIds.current,
  })

  if (!isOwned) {
    return 'skip'
  }

  applyNotificationBookkeeping({
    method: notification.method,
    notificationParams,
    notificationThreadId,
    subagentThreadIds,
    itemThreadIdsRef,
    turnThreadIdsRef,
    setActiveSubagentThreadIdState: params.setActiveSubagentThreadIdState,
    setSubagentsState: params.setSubagentsState,
  })

  return isTrackedSubagent ? 'skip' : 'dispatch'
}
