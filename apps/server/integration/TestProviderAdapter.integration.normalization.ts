import { type ProviderRuntimeEvent } from '@orxa-code/contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeTurnState(value: unknown): 'completed' | 'failed' | 'interrupted' | 'cancelled' {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted' ||
    value === 'cancelled'
  ) {
    return value
  }
  return 'completed'
}

function mapRequestType(
  requestKind: unknown
): 'command_execution_approval' | 'file_change_approval' | 'unknown' {
  if (requestKind === 'command') {
    return 'command_execution_approval'
  }
  if (requestKind === 'file-change') {
    return 'file_change_approval'
  }
  return 'unknown'
}

function mapItemType(toolKind: unknown): 'command_execution' | 'file_change' | 'unknown' {
  if (toolKind === 'command') {
    return 'command_execution'
  }
  if (toolKind === 'file-change') {
    return 'file_change'
  }
  return 'unknown'
}

function normalizeTurnStarted(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'turn.started',
    payload: isRecord(rawEvent.payload) ? rawEvent.payload : {},
  } as ProviderRuntimeEvent
}

function normalizeTurnCompleted(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'turn.completed',
    payload: isRecord(rawEvent.payload)
      ? rawEvent.payload
      : { state: normalizeTurnState(rawEvent.status) },
  } as ProviderRuntimeEvent
}

function normalizeMessageDelta(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'content.delta',
    payload: {
      streamKind: 'assistant_text',
      delta: typeof rawEvent.delta === 'string' ? rawEvent.delta : '',
    },
  } as ProviderRuntimeEvent
}

function normalizeMessageCompleted(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'item.completed',
    payload: {
      itemType: 'assistant_message',
      ...(typeof rawEvent.detail === 'string' ? { detail: rawEvent.detail } : {}),
    },
  } as ProviderRuntimeEvent
}

function normalizeToolStarted(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'item.started',
    payload: {
      itemType: mapItemType(rawEvent.toolKind),
      ...(typeof rawEvent.title === 'string' ? { title: rawEvent.title } : {}),
      ...(typeof rawEvent.detail === 'string' ? { detail: rawEvent.detail } : {}),
    },
  } as ProviderRuntimeEvent
}

function normalizeToolCompleted(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'item.completed',
    payload: {
      itemType: mapItemType(rawEvent.toolKind),
      status: 'completed',
      ...(typeof rawEvent.title === 'string' ? { title: rawEvent.title } : {}),
      ...(typeof rawEvent.detail === 'string' ? { detail: rawEvent.detail } : {}),
    },
  } as ProviderRuntimeEvent
}

function normalizeApprovalRequested(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'request.opened',
    payload: {
      requestType: mapRequestType(rawEvent.requestKind),
      ...(typeof rawEvent.detail === 'string' ? { detail: rawEvent.detail } : {}),
    },
  } as ProviderRuntimeEvent
}

function normalizeApprovalResolved(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    ...rawEvent,
    type: 'request.resolved',
    payload: {
      requestType: mapRequestType(rawEvent.requestKind),
      ...(typeof rawEvent.decision === 'string' ? { decision: rawEvent.decision } : {}),
    },
  } as ProviderRuntimeEvent
}

const FIXTURE_EVENT_NORMALIZERS: Record<
  string,
  (rawEvent: Record<string, unknown>) => ProviderRuntimeEvent
> = {
  'turn.started': normalizeTurnStarted,
  'turn.completed': normalizeTurnCompleted,
  'message.delta': normalizeMessageDelta,
  'message.completed': normalizeMessageCompleted,
  'tool.started': normalizeToolStarted,
  'tool.completed': normalizeToolCompleted,
  'approval.requested': normalizeApprovalRequested,
  'approval.resolved': normalizeApprovalResolved,
}

export function normalizeFixtureEvent(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  const type = typeof rawEvent.type === 'string' ? rawEvent.type : ''
  const normalizer = FIXTURE_EVENT_NORMALIZERS[type]
  return normalizer ? normalizer(rawEvent) : (rawEvent as ProviderRuntimeEvent)
}
