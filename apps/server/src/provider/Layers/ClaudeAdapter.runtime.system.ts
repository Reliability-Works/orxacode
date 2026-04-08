/**
 * Claude adapter runtime system + telemetry helpers.
 *
 * Hosts the system-message routing helpers (hooks, tasks, files persisted),
 * SDK telemetry routing, and the high-level SDK message dispatcher. Each
 * helper is a top-level function that takes the shared `ClaudeAdapterDeps`
 * value and operates on a `ClaudeSessionContext` from the live layer.
 *
 * @module ClaudeAdapter.runtime.system
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { RuntimeTaskId } from '@orxa-code/contracts'
import { Effect } from 'effect'

import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import { normalizeClaudeTokenUsage } from './ClaudeAdapter.pure.ts'
import {
  ensureThreadId,
  emitRuntimeWarning,
  handleAssistantMessage,
  handleResultMessage,
  handleStreamEvent,
  handleUserMessage,
  logNativeSdkMessage,
} from './ClaudeAdapter.runtime.messages.ts'
import {
  type ClaudeSessionContext,
  type ClaudeSystemRuntimeEventBase,
} from './ClaudeAdapter.types.ts'
import { sdkNativeMethod } from './ClaudeAdapter.sdk.ts'
import { buildSdkMessageEventBase, type EventStamp } from './ClaudeAdapter.runtime.eventBase.ts'

function makeSdkMessageEventBase(
  context: ClaudeSessionContext,
  message: SDKMessage,
  stamp: EventStamp,
  messageType: string
) {
  return buildSdkMessageEventBase(context, stamp, {
    method: sdkNativeMethod(message),
    messageType,
    payload: message,
  })
}

export const buildSystemRuntimeEventBase = Effect.fn('buildSystemRuntimeEventBase')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: Extract<SDKMessage, { type: 'system' }>
) {
  const stamp = yield* deps.makeEventStamp()
  return makeSdkMessageEventBase(
    context,
    message,
    stamp,
    `${message.type}:${message.subtype}`
  ) satisfies ClaudeSystemRuntimeEventBase
})

export const emitSystemUsageUpdate = Effect.fn('emitSystemUsageUpdate')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  base: ClaudeSystemRuntimeEventBase,
  usage: unknown
) {
  if (!usage) {
    return
  }

  const normalizedUsage = normalizeClaudeTokenUsage(usage, context.lastKnownContextWindow)
  if (!normalizedUsage) {
    return
  }

  context.lastKnownTokenUsage = normalizedUsage
  const usageStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    ...base,
    eventId: usageStamp.eventId,
    createdAt: usageStamp.createdAt,
    type: 'thread.token-usage.updated',
    payload: {
      usage: normalizedUsage,
    },
  })
})

export const emitHookSystemMessage = Effect.fn('emitHookSystemMessage')(function* (
  deps: ClaudeAdapterDeps,
  base: ClaudeSystemRuntimeEventBase,
  message: Extract<SDKMessage, { type: 'system' }>
) {
  if (message.subtype === 'hook_started') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'hook.started',
      payload: {
        hookId: message.hook_id,
        hookName: message.hook_name,
        hookEvent: message.hook_event,
      },
    })
    return true
  }

  if (message.subtype === 'hook_progress') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'hook.progress',
      payload: {
        hookId: message.hook_id,
        output: message.output,
        stdout: message.stdout,
        stderr: message.stderr,
      },
    })
    return true
  }

  if (message.subtype !== 'hook_response') {
    return false
  }

  yield* deps.offerRuntimeEvent({
    ...base,
    type: 'hook.completed',
    payload: {
      hookId: message.hook_id,
      outcome: message.outcome,
      output: message.output,
      stdout: message.stdout,
      stderr: message.stderr,
      ...(typeof message.exit_code === 'number' ? { exitCode: message.exit_code } : {}),
    },
  })
  return true
})

export const emitTaskSystemMessage = Effect.fn('emitTaskSystemMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  base: ClaudeSystemRuntimeEventBase,
  message: Extract<SDKMessage, { type: 'system' }>
) {
  if (message.subtype === 'task_started') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'task.started',
      payload: {
        taskId: RuntimeTaskId.makeUnsafe(message.task_id),
        description: message.description,
        ...(message.task_type ? { taskType: message.task_type } : {}),
      },
    })
    return true
  }

  if (message.subtype === 'task_progress') {
    yield* emitSystemUsageUpdate(deps, context, base, message.usage)
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'task.progress',
      payload: {
        taskId: RuntimeTaskId.makeUnsafe(message.task_id),
        description: message.description,
        ...(message.summary ? { summary: message.summary } : {}),
        ...(message.usage ? { usage: message.usage } : {}),
        ...(message.last_tool_name ? { lastToolName: message.last_tool_name } : {}),
      },
    })
    return true
  }

  if (message.subtype !== 'task_notification') {
    return false
  }

  yield* emitSystemUsageUpdate(deps, context, base, message.usage)
  yield* deps.offerRuntimeEvent({
    ...base,
    type: 'task.completed',
    payload: {
      taskId: RuntimeTaskId.makeUnsafe(message.task_id),
      status: message.status,
      ...(message.summary ? { summary: message.summary } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
    },
  })
  return true
})

export const emitFilesPersistedSystemMessage = Effect.fn('emitFilesPersistedSystemMessage')(
  function* (
    deps: ClaudeAdapterDeps,
    base: ClaudeSystemRuntimeEventBase,
    message: Extract<SDKMessage, { type: 'system' }>
  ) {
    if (message.subtype !== 'files_persisted') {
      return false
    }

    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'files.persisted',
      payload: {
        files: Array.isArray(message.files)
          ? message.files.map((file: { filename: string; file_id: string }) => ({
              filename: file.filename,
              fileId: file.file_id,
            }))
          : [],
        ...(Array.isArray(message.failed)
          ? {
              failed: message.failed.map((entry: { filename: string; error: string }) => ({
                filename: entry.filename,
                error: entry.error,
              })),
            }
          : {}),
      },
    })
    return true
  }
)

export const handleSystemMessage = Effect.fn('handleSystemMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (message.type !== 'system') {
    return
  }

  const base = yield* buildSystemRuntimeEventBase(deps, context, message)

  switch (message.subtype) {
    case 'init':
      yield* deps.offerRuntimeEvent({
        ...base,
        type: 'session.configured',
        payload: {
          config: message as Record<string, unknown>,
        },
      })
      return
    case 'status':
      yield* deps.offerRuntimeEvent({
        ...base,
        type: 'session.state.changed',
        payload: {
          state: message.status === 'compacting' ? 'waiting' : 'running',
          reason: `status:${message.status ?? 'active'}`,
          detail: message,
        },
      })
      return
    case 'compact_boundary':
      yield* deps.offerRuntimeEvent({
        ...base,
        type: 'thread.state.changed',
        payload: {
          state: 'compacted',
          detail: message,
        },
      })
      return
    case 'hook_started':
    case 'hook_progress':
    case 'hook_response':
      yield* emitHookSystemMessage(deps, base, message)
      return
    case 'task_started':
    case 'task_progress':
    case 'task_notification':
      yield* emitTaskSystemMessage(deps, context, base, message)
      return
    case 'files_persisted':
      yield* emitFilesPersistedSystemMessage(deps, base, message)
      return
    default:
      yield* emitRuntimeWarning(
        deps,
        context,
        `Unhandled Claude system message subtype '${message.subtype}'.`,
        message
      )
      return
  }
})

export const handleSdkTelemetryMessage = Effect.fn('handleSdkTelemetryMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  const stamp = yield* deps.makeEventStamp()
  const base = makeSdkMessageEventBase(context, message, stamp, message.type)

  if (message.type === 'tool_progress') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'tool.progress',
      payload: {
        toolUseId: message.tool_use_id,
        toolName: message.tool_name,
        elapsedSeconds: message.elapsed_time_seconds,
        ...(message.task_id ? { summary: `task:${message.task_id}` } : {}),
      },
    })
    return
  }

  if (message.type === 'tool_use_summary') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'tool.summary',
      payload: {
        summary: message.summary,
        ...(message.preceding_tool_use_ids.length > 0
          ? { precedingToolUseIds: message.preceding_tool_use_ids }
          : {}),
      },
    })
    return
  }

  if (message.type === 'auth_status') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'auth.status',
      payload: {
        isAuthenticating: message.isAuthenticating,
        output: message.output,
        ...(message.error ? { error: message.error } : {}),
      },
    })
    return
  }

  if (message.type === 'rate_limit_event') {
    yield* deps.offerRuntimeEvent({
      ...base,
      type: 'account.rate-limits.updated',
      payload: {
        rateLimits: message,
      },
    })
    return
  }
})

export const handleSdkMessage = Effect.fn('handleSdkMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  yield* logNativeSdkMessage(deps, context, message)
  yield* ensureThreadId(deps, context, message)

  switch (message.type) {
    case 'stream_event':
      yield* handleStreamEvent(deps, context, message)
      return
    case 'user':
      yield* handleUserMessage(deps, context, message)
      return
    case 'assistant':
      yield* handleAssistantMessage(deps, context, message)
      return
    case 'result':
      yield* handleResultMessage(deps, context, message)
      return
    case 'system':
      yield* handleSystemMessage(deps, context, message)
      return
    case 'tool_progress':
    case 'tool_use_summary':
    case 'auth_status':
    case 'rate_limit_event':
      yield* handleSdkTelemetryMessage(deps, context, message)
      return
    default:
      yield* emitRuntimeWarning(
        deps,
        context,
        `Unhandled Claude SDK message type '${message.type}'.`,
        message
      )
      return
  }
})
