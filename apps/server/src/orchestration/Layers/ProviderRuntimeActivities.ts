import {
  ApprovalRequestId,
  isToolLifecycleItemType,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
  type ThreadTokenUsageSnapshot,
  TurnId,
} from '@orxa-code/contracts'
import { asObjectRecord, asTrimmedString } from '@orxa-code/shared/records'
import { formatSubagentLabel } from '@orxa-code/shared/subagent'

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.makeUnsafe(String(value))
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : ApprovalRequestId.makeUnsafe(value)
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value
}

function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent
): ThreadTokenUsageSnapshot | undefined {
  if (event.type !== 'thread.token-usage.updated' || event.payload.usage.usedTokens <= 0) {
    return undefined
  }
  return event.payload.usage
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined
): 'command' | 'file-read' | 'file-change' | undefined {
  switch (requestType) {
    case 'command_execution_approval':
    case 'exec_command_approval':
      return 'command'
    case 'file_read_approval':
      return 'file-read'
    case 'file_change_approval':
    case 'apply_patch_approval':
      return 'file-change'
    default:
      return undefined
  }
}

function sequencePayload(event: ProviderRuntimeEvent): { sequence?: number } {
  const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number }
  return eventWithSequence.sessionSequence !== undefined
    ? { sequence: eventWithSequence.sessionSequence }
    : {}
}

function buildActivity(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number },
  params: {
    readonly tone: OrchestrationThreadActivity['tone']
    readonly kind: string
    readonly summary: string
    readonly payload: OrchestrationThreadActivity['payload']
  }
): OrchestrationThreadActivity {
  return {
    id: event.eventId,
    createdAt: event.createdAt,
    tone: params.tone,
    kind: params.kind,
    summary: params.summary,
    payload: params.payload,
    turnId: toTurnId(event.turnId) ?? null,
    ...maybeSequence,
  }
}

function extractSubagentLabel(payload: unknown): string | null {
  const data = asObjectRecord(payload)
  const item = asObjectRecord(data?.item) ?? data
  const input = asObjectRecord(item?.input)
  return formatSubagentLabel(
    asTrimmedString(item?.subagent_type) ??
      asTrimmedString(item?.subagentType) ??
      asTrimmedString(item?.agent_label) ??
      asTrimmedString(item?.agentLabel) ??
      asTrimmedString(input?.subagent_type) ??
      asTrimmedString(input?.subagentType) ??
      asTrimmedString(input?.agent_label) ??
      asTrimmedString(input?.agentLabel)
  )
}

function subagentLifecycleSummary(
  event: Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.updated' | 'item.completed' }>
): string | null {
  if (event.payload.itemType !== 'collab_agent_tool_call') {
    return null
  }
  const agentLabel = extractSubagentLabel(event.payload.data)
  switch (event.type) {
    case 'item.started':
      return agentLabel ? `Delegating to ${agentLabel}` : 'Delegating to subagent'
    case 'item.updated':
      return agentLabel ? `${agentLabel} update` : 'Subagent update'
    case 'item.completed':
      return agentLabel ? `Delegated to ${agentLabel}` : 'Delegated to subagent'
  }
}

function requestActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'request.opened': {
      if (event.payload.requestType === 'tool_user_input') {
        return []
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType)
      return [
        buildActivity(event, maybeSequence, {
          tone: 'approval',
          kind: 'approval.requested',
          summary:
            requestKind === 'command'
              ? 'Command approval requested'
              : requestKind === 'file-read'
                ? 'File-read approval requested'
                : requestKind === 'file-change'
                  ? 'File-change approval requested'
                  : 'Approval requested',
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
          },
        }),
      ]
    }

    case 'request.resolved': {
      if (event.payload.requestType === 'tool_user_input') {
        return []
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType)
      return [
        buildActivity(event, maybeSequence, {
          tone: 'approval',
          kind: 'approval.resolved',
          summary: 'Approval resolved',
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.decision ? { decision: event.payload.decision } : {}),
          },
        }),
      ]
    }
    default:
      return []
  }
}

function runtimeMessageActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'runtime.error':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'error',
          kind: 'runtime.error',
          summary: 'Runtime error',
          payload: {
            message: truncateDetail(event.payload.message),
          },
        }),
      ]

    case 'runtime.warning':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'runtime.warning',
          summary: 'Runtime warning',
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
        }),
      ]
    default:
      return []
  }
}

function planAndUserInputActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'turn.plan.updated':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'turn.plan.updated',
          summary: 'Plan updated',
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
        }),
      ]

    case 'user-input.requested':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'user-input.requested',
          summary: 'User input requested',
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
        }),
      ]

    case 'user-input.resolved':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'user-input.resolved',
          summary: 'User input submitted',
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
        }),
      ]
    default:
      return []
  }
}

function taskActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'task.started':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'task.started',
          summary:
            event.payload.taskType === 'plan'
              ? 'Plan task started'
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : 'Task started',
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
          },
        }),
      ]

    case 'task.progress':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'task.progress',
          summary: 'Reasoning update',
          payload: {
            taskId: event.payload.taskId,
            detail: truncateDetail(event.payload.summary ?? event.payload.description),
            ...(event.payload.summary ? { summary: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.lastToolName ? { lastToolName: event.payload.lastToolName } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
        }),
      ]

    case 'task.completed':
      return [
        buildActivity(event, maybeSequence, {
          tone: event.payload.status === 'failed' ? 'error' : 'info',
          kind: 'task.completed',
          summary:
            event.payload.status === 'failed'
              ? 'Task failed'
              : event.payload.status === 'stopped'
                ? 'Task stopped'
                : 'Task completed',
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(event.payload.summary ? { detail: truncateDetail(event.payload.summary) } : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
          },
        }),
      ]
    default:
      return []
  }
}

function threadStateActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'thread.state.changed': {
      if (event.payload.state !== 'compacted') {
        return []
      }
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'context-compaction',
          summary: 'Context compacted',
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
        }),
      ]
    }

    case 'thread.token-usage.updated': {
      const payload = buildContextWindowActivityPayload(event)
      if (!payload) {
        return []
      }
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'context-window.updated',
          summary: 'Context window updated',
          payload,
        }),
      ]
    }
    case 'account.rate-limits.updated':
      return [
        buildActivity(event, maybeSequence, {
          tone: 'info',
          kind: 'rate-limits.updated',
          summary: 'Rate limits updated',
          payload: event.payload.rateLimits,
        }),
      ]
    default:
      return []
  }
}

function toolLifecycleActivities(
  event: ProviderRuntimeEvent,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  switch (event.type) {
    case 'item.updated':
      return toolUpdatedActivities(event, maybeSequence)

    case 'item.completed': {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return []
      }
      const summary = subagentLifecycleSummary(event) ?? event.payload.title ?? 'Tool'
      return [buildToolLifecycleActivity(event, maybeSequence, 'tool.completed', summary)]
    }

    case 'item.started': {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return []
      }
      const summary = subagentLifecycleSummary(event) ?? `${event.payload.title ?? 'Tool'} started`
      return [buildToolLifecycleActivity(event, maybeSequence, 'tool.started', summary)]
    }
    default:
      return []
  }
}

function toolUpdatedActivities(
  event: Extract<ProviderRuntimeEvent, { type: 'item.updated' }>,
  maybeSequence: { sequence?: number }
): ReadonlyArray<OrchestrationThreadActivity> {
  if (!isToolLifecycleItemType(event.payload.itemType)) {
    return []
  }
  if (event.payload.itemType === 'collab_agent_tool_call') {
    return []
  }
  const summary = subagentLifecycleSummary(event) ?? event.payload.title ?? 'Tool updated'
  return [
    buildToolLifecycleActivity(event, maybeSequence, 'tool.updated', summary, {
      status: event.payload.status,
    }),
  ]
}

function buildToolLifecyclePayload(
  event: Extract<
    ProviderRuntimeEvent,
    { type: 'item.started' | 'item.updated' | 'item.completed' }
  >,
  input?: { readonly status?: string | null | undefined }
) {
  return {
    itemType: event.payload.itemType,
    ...(input?.status ? { status: input.status } : {}),
    ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
    ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
  }
}

function buildToolLifecycleActivity(
  event: Extract<
    ProviderRuntimeEvent,
    { type: 'item.started' | 'item.updated' | 'item.completed' }
  >,
  maybeSequence: { sequence?: number },
  kind: 'tool.started' | 'tool.updated' | 'tool.completed',
  summary: string,
  input?: { readonly status?: string | null | undefined }
) {
  return buildActivity(event, maybeSequence, {
    tone: 'tool',
    kind,
    summary,
    payload: buildToolLifecyclePayload(event, input),
  })
}

export function runtimeEventToActivities(
  event: ProviderRuntimeEvent
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = sequencePayload(event)

  const requestResults = requestActivities(event, maybeSequence)
  if (requestResults.length > 0) {
    return requestResults
  }

  const runtimeResults = runtimeMessageActivities(event, maybeSequence)
  if (runtimeResults.length > 0) {
    return runtimeResults
  }

  const planAndInputResults = planAndUserInputActivities(event, maybeSequence)
  if (planAndInputResults.length > 0) {
    return planAndInputResults
  }

  const taskResults = taskActivities(event, maybeSequence)
  if (taskResults.length > 0) {
    return taskResults
  }

  const threadResults = threadStateActivities(event, maybeSequence)
  if (threadResults.length > 0) {
    return threadResults
  }

  return toolLifecycleActivities(event, maybeSequence)
}
