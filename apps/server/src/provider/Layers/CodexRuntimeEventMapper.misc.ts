import { type ProviderEvent, type ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'

import {
  asNumber,
  asObject,
  asRuntimeTaskId,
  asString,
  codexEventBase,
  codexEventMessage,
  extractProposedPlanMarkdown,
  isFatalCodexProcessStderrMessage,
  runtimeEventBase,
  toRequestTypeFromKind,
  toRequestTypeFromResolvedPayload,
} from './CodexRuntimeEventUtils.ts'
import { runtimeEvents } from './CodexRuntimeEventMapper.shared.ts'

const CODEX_EVENT_MAPPERS: Record<
  string,
  (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
    payload: Record<string, unknown> | undefined,
    msg: Record<string, unknown> | undefined
  ) => ReadonlyArray<ProviderRuntimeEvent>
> = {
  'codex/event/task_started': (event, canonicalThreadId, payload, msg) => {
    const taskId = asString(payload?.id) ?? asString(msg?.turn_id)
    return taskId
      ? runtimeEvents({
          ...codexEventBase(event, canonicalThreadId),
          type: 'task.started',
          payload: {
            taskId: asRuntimeTaskId(taskId),
            ...(asString(msg?.collaboration_mode_kind)
              ? { taskType: asString(msg?.collaboration_mode_kind) }
              : {}),
          },
        })
      : []
  },
  'codex/event/agent_reasoning': (event, canonicalThreadId, payload, msg) => {
    const taskId = asString(payload?.id)
    const description = asString(msg?.text)
    return taskId && description
      ? runtimeEvents({
          ...codexEventBase(event, canonicalThreadId),
          type: 'task.progress',
          payload: { taskId: asRuntimeTaskId(taskId), description },
        })
      : []
  },
  'codex/event/reasoning_content_delta': (event, canonicalThreadId, _payload, msg) => {
    const delta = asString(msg?.delta)
    return delta
      ? runtimeEvents({
          ...codexEventBase(event, canonicalThreadId),
          type: 'content.delta',
          payload: {
            streamKind:
              asNumber(msg?.summary_index) !== undefined
                ? 'reasoning_summary_text'
                : 'reasoning_text',
            delta,
            ...(asNumber(msg?.summary_index) !== undefined
              ? { summaryIndex: asNumber(msg?.summary_index) }
              : {}),
          },
        })
      : []
  },
}

function mapCodexTaskCompleteEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined,
  msg: Record<string, unknown> | undefined
) {
  const taskId = asString(payload?.id) ?? asString(msg?.turn_id)
  const planMarkdown = extractProposedPlanMarkdown(asString(msg?.last_agent_message))
  if (!taskId) {
    return planMarkdown
      ? runtimeEvents({
          ...codexEventBase(event, canonicalThreadId),
          type: 'turn.proposed.completed',
          payload: { planMarkdown },
        })
      : []
  }
  return runtimeEvents(
    {
      ...codexEventBase(event, canonicalThreadId),
      type: 'task.completed',
      payload: {
        taskId: asRuntimeTaskId(taskId),
        status: 'completed',
        ...(asString(msg?.last_agent_message)
          ? { summary: asString(msg?.last_agent_message) }
          : {}),
      },
    },
    ...(planMarkdown
      ? [
          {
            ...codexEventBase(event, canonicalThreadId),
            type: 'turn.proposed.completed' as const,
            payload: { planMarkdown },
          },
        ]
      : [])
  )
}

export function mapCodexEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  const msg = codexEventMessage(payload)
  return event.method === 'codex/event/task_complete'
    ? mapCodexTaskCompleteEvent(event, canonicalThreadId, payload, msg)
    : CODEX_EVENT_MAPPERS[event.method]?.(event, canonicalThreadId, payload, msg)
}

const MISC_EVENT_MAPPERS: Record<
  string,
  (
    event: ProviderEvent,
    canonicalThreadId: ThreadId,
    payload: Record<string, unknown> | undefined
  ) => ReadonlyArray<ProviderRuntimeEvent>
> = {
  'model/rerouted': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'model.rerouted',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: {
        fromModel: asString(payload?.fromModel) ?? 'unknown',
        toModel: asString(payload?.toModel) ?? 'unknown',
        reason: asString(payload?.reason) ?? 'unknown',
      },
    }),
  deprecationNotice: (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'deprecation.notice',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: {
        summary: asString(payload?.summary) ?? 'Deprecation notice',
        ...(asString(payload?.details) ? { details: asString(payload?.details) } : {}),
      },
    }),
  configWarning: (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'config.warning',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: {
        summary: asString(payload?.summary) ?? 'Configuration warning',
        ...(asString(payload?.details) ? { details: asString(payload?.details) } : {}),
        ...(asString(payload?.path) ? { path: asString(payload?.path) } : {}),
        ...(payload?.range !== undefined ? { range: payload.range } : {}),
      },
    }),
  'account/updated': (event, canonicalThreadId) =>
    runtimeEvents({
      type: 'account.updated',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { account: event.payload ?? {} },
    }),
  'account/rateLimits/updated': (event, canonicalThreadId) =>
    runtimeEvents({
      type: 'account.rate-limits.updated',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: { rateLimits: event.payload ?? {} },
    }),
  'mcpServer/oauthLogin/completed': (event, canonicalThreadId, payload) =>
    runtimeEvents({
      type: 'mcp.oauth.completed',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: {
        success: payload?.success === true,
        ...(asString(payload?.name) ? { name: asString(payload?.name) } : {}),
        ...(asString(payload?.error) ? { error: asString(payload?.error) } : {}),
      },
    }),
}

function mapServerRequestResolvedEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  const resolvedRequestType = toRequestTypeFromResolvedPayload(payload)
  const requestType =
    resolvedRequestType !== 'unknown'
      ? resolvedRequestType
      : event.requestId && event.requestKind !== undefined
        ? toRequestTypeFromKind(event.requestKind)
        : 'unknown'
  return runtimeEvents({
    ...runtimeEventBase(event, canonicalThreadId),
    type: 'request.resolved',
    payload: { requestType, ...(event.payload !== undefined ? { resolution: event.payload } : {}) },
  })
}

function mapMiscErrorEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  payload: Record<string, unknown> | undefined
) {
  const message =
    asString(asObject(payload?.error)?.message) ?? event.message ?? 'Provider runtime error'
  const willRetry = payload?.willRetry === true
  return runtimeEvents({
    type: willRetry ? 'runtime.warning' : 'runtime.error',
    ...runtimeEventBase(event, canonicalThreadId),
    payload: {
      message,
      ...(!willRetry ? { class: 'provider_error' as const } : {}),
      ...(event.payload !== undefined ? { detail: event.payload } : {}),
    },
  })
}

function mapProcessStderrEvent(event: ProviderEvent, canonicalThreadId: ThreadId) {
  const message = event.message ?? 'Codex process stderr'
  const type = isFatalCodexProcessStderrMessage(message) ? 'runtime.error' : 'runtime.warning'
  return runtimeEvents({
    type,
    ...runtimeEventBase(event, canonicalThreadId),
    payload: {
      message,
      ...(type === 'runtime.error' ? { class: 'provider_error' as const } : {}),
      ...(event.payload !== undefined ? { detail: event.payload } : {}),
    },
  })
}

function mapWindowsSandboxSetupCompletedEvent(event: ProviderEvent, canonicalThreadId: ThreadId) {
  const success = asObject(event.payload)?.success
  const successMessage = event.message ?? 'Windows sandbox setup completed'
  const failureMessage = event.message ?? 'Windows sandbox setup failed'
  return runtimeEvents(
    {
      type: 'session.state.changed',
      ...runtimeEventBase(event, canonicalThreadId),
      payload: {
        state: success === false ? 'error' : 'ready',
        reason: success === false ? failureMessage : successMessage,
        ...(event.payload !== undefined ? { detail: event.payload } : {}),
      },
    },
    ...(success === false
      ? [
          {
            type: 'runtime.warning' as const,
            ...runtimeEventBase(event, canonicalThreadId),
            payload: {
              message: failureMessage,
              ...(event.payload !== undefined ? { detail: event.payload } : {}),
            },
          },
        ]
      : [])
  )
}

export function mapMiscEvent(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): ReadonlyArray<ProviderRuntimeEvent> | undefined {
  const payload = asObject(event.payload)
  if (event.method === 'serverRequest/resolved') {
    return mapServerRequestResolvedEvent(event, canonicalThreadId, payload)
  }
  if (event.method === 'error') {
    return mapMiscErrorEvent(event, canonicalThreadId, payload)
  }
  if (event.method === 'process/stderr') {
    return mapProcessStderrEvent(event, canonicalThreadId)
  }
  if (event.method === 'windows/worldWritableWarning') {
    return [
      {
        type: 'runtime.warning',
        ...runtimeEventBase(event, canonicalThreadId),
        payload: {
          message: event.message ?? 'Windows world-writable warning',
          ...(event.payload !== undefined ? { detail: event.payload } : {}),
        },
      },
    ]
  }
  return event.method === 'windowsSandbox/setupCompleted'
    ? mapWindowsSandboxSetupCompletedEvent(event, canonicalThreadId)
    : MISC_EVENT_MAPPERS[event.method]?.(event, canonicalThreadId, payload)
}
