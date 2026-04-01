import type { Event as OpencodeEvent } from '@opencode-ai/sdk/v2/client'
import type { OrxaEvent } from '@shared/ipc'

export type ProjectRuntimeEventContext = {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  addSessionFeedNotice: (
    directory: string,
    sessionID: string,
    notice: { label: string; detail: string; tone: 'info' | 'error' }
  ) => void
  applyOpencodeStreamEvent: (directory: string, event: OpencodeEvent) => void
  buildSessionFeedNoticeKey: (directory: string, sessionID: string) => string
  getManualSessionStopState: (
    sessionKey: string | null
  ) => { requestedAt?: number; noticeEmitted?: boolean } | undefined
  isRecoverableSessionError: (message: string, code: string) => boolean
  markManualSessionStopNoticeEmitted: (sessionKey: string, at: number) => void
  pruneManualSessionStops: (now: number) => void
  pushToast: (message: string, tone: 'info' | 'warning' | 'error') => void
  queueRefresh: (message: string, delayMs: number, scope?: 'project' | 'messages' | 'both') => void
  scheduleGitRefresh: (delayMs: number) => void
  setStatusLine: (value: string) => void
  stopResponsePolling: () => void
}

type ProjectEventMetadata = {
  eventProperties: Record<string, unknown> | undefined
  eventSessionID: string | undefined
  eventSessionKey: string | null
  isRecentManualStop: boolean
  kind: string
  manualStopAt: number | undefined
  manualStopState: { requestedAt?: number; noticeEmitted?: boolean } | undefined
  now: number
}

function readProjectEventMetadata(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  context: Pick<
    ProjectRuntimeEventContext,
    'buildSessionFeedNoticeKey' | 'getManualSessionStopState' | 'pruneManualSessionStops'
  >
): ProjectEventMetadata {
  const eventProperties =
    event.payload.event.properties && typeof event.payload.event.properties === 'object'
      ? (event.payload.event.properties as Record<string, unknown>)
      : undefined
  const eventSessionID =
    eventProperties && typeof eventProperties.sessionID === 'string'
      ? eventProperties.sessionID
      : undefined
  const eventSessionKey = eventSessionID
    ? context.buildSessionFeedNoticeKey(event.payload.directory, eventSessionID)
    : null
  const now = Date.now()
  context.pruneManualSessionStops(now)
  const manualStopState = context.getManualSessionStopState(eventSessionKey)
  const manualStopAt = manualStopState?.requestedAt
  return {
    eventProperties,
    eventSessionID,
    eventSessionKey,
    isRecentManualStop: typeof manualStopAt === 'number' && now - manualStopAt < 30_000,
    kind: String(event.payload.event.type),
    manualStopAt,
    manualStopState,
    now,
  }
}

function shouldQueueProjectRefresh(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  activeProjectDir: string | undefined,
  kind: string
) {
  return (
    event.payload.directory === activeProjectDir &&
    (kind === 'pty.created' || kind === 'pty.deleted' || kind === 'lsp.updated')
  )
}

function shouldScheduleGitRefresh(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  activeProjectDir: string | undefined,
  kind: string
) {
  return (
    event.payload.directory === activeProjectDir &&
    (kind === 'message.created' ||
      kind === 'message.updated' ||
      kind === 'message.part.created' ||
      kind === 'message.part.updated' ||
      kind === 'message.part.delta' ||
      kind === 'message.part.removed' ||
      kind === 'message.removed' ||
      kind === 'session.diff' ||
      kind === 'session.updated' ||
      kind === 'session.deleted' ||
      kind === 'session.status' ||
      kind === 'session.idle' ||
      kind === 'session.error')
  )
}

type SessionErrorState = {
  detail: string
  interruptedAlreadyNoticed: boolean
  sessionID: string | undefined
  useInterruptedReason: boolean
  useRecoverableReason: boolean
}

function buildSessionErrorState(
  errorRecord: Record<string, unknown> | undefined,
  metadata: ProjectEventMetadata,
  activeSessionID: string | undefined,
  isRecoverableSessionError: ProjectRuntimeEventContext['isRecoverableSessionError']
): SessionErrorState {
  const message = typeof errorRecord?.message === 'string' ? errorRecord.message.trim() : ''
  const errorCode = typeof errorRecord?.code === 'string' ? errorRecord.code.trim() : ''
  const interruptedDetail = 'User interrupted. Send a new message to continue.'
  const useInterruptedReason = metadata.isRecentManualStop
  const useRecoverableReason =
    !useInterruptedReason && isRecoverableSessionError(message, errorCode)
  return {
    detail: useInterruptedReason ? interruptedDetail : message || 'Session stopped due to an error.',
    interruptedAlreadyNoticed: Boolean(metadata.manualStopState?.noticeEmitted),
    sessionID: metadata.eventSessionID ?? activeSessionID,
    useInterruptedReason,
    useRecoverableReason,
  }
}

function maybeSkipInterruptedSessionError(
  state: SessionErrorState,
  activeSessionID: string | undefined,
  stopResponsePolling: ProjectRuntimeEventContext['stopResponsePolling']
) {
  if (!state.useInterruptedReason || !state.interruptedAlreadyNoticed) {
    return false
  }
  if (state.sessionID && state.sessionID === activeSessionID) {
    stopResponsePolling()
  }
  return true
}

function emitSessionErrorNotice(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  state: SessionErrorState,
  addSessionFeedNotice: ProjectRuntimeEventContext['addSessionFeedNotice']
) {
  if (!state.sessionID) {
    return
  }
  addSessionFeedNotice(event.payload.directory, state.sessionID, {
    label: state.useInterruptedReason
      ? 'Session stopped by user'
      : state.useRecoverableReason
        ? 'Session warning'
        : 'Session stopped due to an error',
    detail: state.detail,
    tone: state.useInterruptedReason || state.useRecoverableReason ? 'info' : 'error',
  })
}

function finalizeSessionError(
  metadata: ProjectEventMetadata,
  state: SessionErrorState,
  context: Pick<
    ProjectRuntimeEventContext,
    'activeSessionID' | 'markManualSessionStopNoticeEmitted' | 'pushToast' | 'setStatusLine' | 'stopResponsePolling'
  >
) {
  if (state.useInterruptedReason && metadata.eventSessionKey) {
    context.markManualSessionStopNoticeEmitted(metadata.eventSessionKey, metadata.manualStopAt ?? metadata.now)
  }
  if (!state.useInterruptedReason) {
    context.setStatusLine(state.detail)
  }
  if (state.useRecoverableReason && !state.useInterruptedReason) {
    context.pushToast(state.detail, 'warning')
  }
  if (state.sessionID && state.sessionID === context.activeSessionID) {
    context.stopResponsePolling()
  }
}

function handleSessionErrorEvent(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  metadata: ProjectEventMetadata,
  context: Pick<
    ProjectRuntimeEventContext,
    | 'activeSessionID'
    | 'addSessionFeedNotice'
    | 'isRecoverableSessionError'
    | 'markManualSessionStopNoticeEmitted'
    | 'pushToast'
    | 'setStatusLine'
    | 'stopResponsePolling'
  >
) {
  const errorRecord =
    metadata.eventProperties?.error && typeof metadata.eventProperties.error === 'object'
      ? (metadata.eventProperties.error as Record<string, unknown>)
      : undefined
  const state = buildSessionErrorState(
    errorRecord,
    metadata,
    context.activeSessionID,
    context.isRecoverableSessionError
  )

  if (maybeSkipInterruptedSessionError(state, context.activeSessionID, context.stopResponsePolling)) {
    return
  }

  emitSessionErrorNotice(event, state, context.addSessionFeedNotice)
  finalizeSessionError(metadata, state, context)
}

function handleSessionIdleEvent(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  metadata: ProjectEventMetadata,
  context: Pick<
    ProjectRuntimeEventContext,
    'activeSessionID' | 'addSessionFeedNotice' | 'markManualSessionStopNoticeEmitted' | 'stopResponsePolling'
  >
) {
  if (!metadata.isRecentManualStop || !metadata.eventSessionID) {
    return
  }

  if (!metadata.manualStopState?.noticeEmitted) {
    context.addSessionFeedNotice(event.payload.directory, metadata.eventSessionID, {
      label: 'Session stopped by user',
      detail: 'User interrupted. Send a new message to continue.',
      tone: 'info',
    })
    if (metadata.eventSessionKey) {
      context.markManualSessionStopNoticeEmitted(metadata.eventSessionKey, metadata.manualStopAt ?? metadata.now)
    }
  }

  if (metadata.eventSessionID === context.activeSessionID) {
    context.stopResponsePolling()
  }
}

export function handleProjectRuntimeEvent(
  event: Extract<OrxaEvent, { type: 'opencode.project' }>,
  context: ProjectRuntimeEventContext
) {
  context.applyOpencodeStreamEvent(event.payload.directory, event.payload.event)
  const metadata = readProjectEventMetadata(event, context)

  if (shouldQueueProjectRefresh(event, context.activeProjectDir, metadata.kind)) {
    context.queueRefresh(`Updated from event: ${metadata.kind}`, 180, 'project')
  }

  if (shouldScheduleGitRefresh(event, context.activeProjectDir, metadata.kind)) {
    context.scheduleGitRefresh(metadata.kind.startsWith('message.') ? 420 : 280)
  }

  if (metadata.kind === 'session.error') {
    handleSessionErrorEvent(event, metadata, context)
    return
  }

  if (metadata.kind === 'session.idle') {
    handleSessionIdleEvent(event, metadata, context)
  }
}
