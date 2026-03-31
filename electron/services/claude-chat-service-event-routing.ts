import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKTaskNotificationMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeSessionRuntime,
  ClaudeSubagentRuntime,
} from './claude-chat-service-types'
import type { ClaudeChatHandlerContext } from './claude-chat-service-message-handlers'
import {
  extractAssistantText,
  extractPartialAssistantText,
} from './claude-chat-service-message-handlers'

function updateTask(
  runtime: ClaudeSessionRuntime,
  taskId: string,
  updater: (task: ClaudeSubagentRuntime) => ClaudeSubagentRuntime
) {
  const index = runtime.runningTasks.findIndex(task => task.id === taskId)
  if (index >= 0) {
    runtime.runningTasks[index] = updater(runtime.runningTasks[index]!)
  }
}

function bindNextUnassignedTask(runtime: ClaudeSessionRuntime, providerThreadId: string) {
  const candidate = [...runtime.runningTasks]
    .reverse()
    .find(task => task.status === 'thinking' && !task.childSessionId)
  if (!candidate) return null
  candidate.childSessionId = providerThreadId
  return candidate.id
}

function trackProviderSession(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  sessionKey: string,
  sessionId: string
) {
  if (!runtime.mainProviderThreadId) {
    const previousThreadId = runtime.approvalThreadId?.trim()
    if (previousThreadId && previousThreadId !== sessionId) {
      context.remapProviderThreadApproval(previousThreadId, sessionId)
    }
    runtime.approvalThreadId = sessionId
    runtime.mainProviderThreadId = sessionId
    runtime.state = { ...runtime.state, status: 'connected', providerThreadId: sessionId }
    context.upsertProviderBinding(runtime, {
      status: 'running',
      resumeCursor: { resume: sessionId },
      runtimePayload: { directory: runtime.directory },
    })
    context.emitState(runtime.state)
    context.emitNotification({
      sessionKey,
      method: 'thread/started',
      params: { providerThreadId: sessionId, isSubagent: false, timestamp: Date.now() },
    })
    return
  }

  if (sessionId !== runtime.mainProviderThreadId) {
    const taskId = bindNextUnassignedTask(runtime, sessionId)
    context.emitNotification({
      sessionKey,
      method: 'thread/started',
      params: {
        providerThreadId: sessionId,
        isSubagent: true,
        ...(taskId ? { taskId } : {}),
        timestamp: Date.now(),
      },
    })
  }
}

function handleAssistantContent(
  context: ClaudeChatHandlerContext,
  sessionKey: string,
  turnId: string,
  message: SDKAssistantMessage
) {
  const content = extractAssistantText(message)
  if (content) {
    context.emitNotification({
      sessionKey,
      method: 'assistant/message',
      params: { id: message.uuid, turnId, content, timestamp: Date.now() },
    })
  }
}

function handleStreamContent(
  context: ClaudeChatHandlerContext,
  sessionKey: string,
  turnId: string,
  message: SDKMessage
) {
  const content = extractPartialAssistantText(message)
  if (content) {
    context.emitNotification({
      sessionKey,
      method: 'assistant/partial',
      params: { id: message.uuid, turnId, content, timestamp: Date.now() },
    })
  }
}

function handleToolProgressMsg(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  sessionKey: string,
  turnId: string,
  message: SDKToolProgressMessage
) {
  runtime.toolNamesById.set(message.tool_use_id, message.tool_name)
  context.emitNotification({
    sessionKey,
    method: 'tool/progress',
    params: {
      id: message.tool_use_id,
      turnId,
      toolName: message.tool_name,
      parentToolUseId: message.parent_tool_use_id,
      taskId: message.task_id,
      toolInput: runtime.toolInputsById.get(message.tool_use_id),
      elapsedTimeSeconds: message.elapsed_time_seconds,
      timestamp: Date.now(),
    },
  })
}

function handleToolUseSummaryMsg(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  sessionKey: string,
  turnId: string,
  message: SDKToolUseSummaryMessage
) {
  const toolUseId = message.preceding_tool_use_ids[0]
  context.emitNotification({
    sessionKey,
    method: 'tool/completed',
    params: {
      id: toolUseId ?? message.uuid,
      turnId,
      toolUseId,
      toolName: toolUseId ? runtime.toolNamesById.get(toolUseId) : undefined,
      toolInput: toolUseId ? runtime.toolInputsById.get(toolUseId) : undefined,
      summary: message.summary,
      precedingToolUseIds: message.preceding_tool_use_ids,
      timestamp: Date.now(),
    },
  })
}

function handleTaskNotification(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  sessionKey: string,
  turnId: string,
  message: SDKTaskNotificationMessage
) {
  const status =
    message.status === 'completed'
      ? 'completed'
      : message.status === 'stopped'
        ? 'idle'
        : 'awaiting_instruction'
  updateTask(runtime, message.task_id, task => ({
    ...task,
    status,
    statusText:
      message.status === 'completed'
        ? 'completed'
        : message.status === 'stopped'
          ? 'stopped'
          : 'failed',
    summary: message.summary,
  }))
  context.emitNotification({
    sessionKey,
    method: 'task/completed',
    params: {
      taskId: message.task_id,
      turnId,
      status: message.status,
      summary: message.summary,
      outputFile: message.output_file,
      toolUseId: message.tool_use_id,
      usage: message.usage,
      timestamp: Date.now(),
    },
  })
}

function handleSystemMsg(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  sessionKey: string,
  turnId: string,
  message: Extract<SDKMessage, { type: 'system' }>
) {
  if (message.subtype === 'task_started') {
    runtime.runningTasks.push({
      id: message.task_id,
      description: message.description,
      prompt: message.prompt,
      taskType: message.task_type,
      status: 'thinking',
      statusText: 'is running',
    })
    context.emitNotification({
      sessionKey,
      method: 'task/started',
      params: {
        taskId: message.task_id,
        turnId,
        description: message.description,
        prompt: message.prompt,
        taskType: message.task_type,
        toolUseId: message.tool_use_id,
        timestamp: Date.now(),
      },
    })
    return
  }

  if (message.subtype === 'task_progress') {
    updateTask(runtime, message.task_id, task => ({
      ...task,
      status: 'thinking',
      statusText: message.summary?.trim() || message.description.trim() || 'is running',
      summary: message.summary,
    }))
    context.emitNotification({
      sessionKey,
      method: 'task/progress',
      params: {
        taskId: message.task_id,
        turnId,
        description: message.description,
        summary: message.summary,
        lastToolName: message.last_tool_name,
        toolUseId: message.tool_use_id,
        usage: message.usage,
        timestamp: Date.now(),
      },
    })
    return
  }

  if (message.subtype === 'task_notification') {
    handleTaskNotification(context, runtime, sessionKey, turnId, message)
    return
  }

  if (message.subtype === 'api_retry') {
    context.emitNotification({
      sessionKey,
      method: 'status/retry',
      params: {
        turnId,
        attempt: message.attempt,
        maxRetries: message.max_retries,
        retryDelayMs: message.retry_delay_ms,
        error: message.error,
        timestamp: Date.now(),
      },
    })
  }
}

function handleResultMsg(
  context: ClaudeChatHandlerContext,
  sessionKey: string,
  turnId: string,
  message: SDKResultMessage
) {
  context.emitNotification({
    sessionKey,
    method: 'result',
    params: {
      turnId,
      subtype: message.subtype,
      isError: message.is_error,
      result: 'result' in message ? message.result : undefined,
      errors: 'errors' in message ? message.errors : undefined,
      timestamp: Date.now(),
    },
  })
}

export function handleClaudeMessage(
  context: ClaudeChatHandlerContext,
  runtime: ClaudeSessionRuntime,
  turnId: string,
  message: SDKMessage
) {
  const sessionKey = runtime.state.sessionKey
  const sessionId = typeof message.session_id === 'string' ? message.session_id : undefined
  if (sessionId) {
    trackProviderSession(context, runtime, sessionKey, sessionId)
  }

  if (message.type === 'assistant') {
    handleAssistantContent(context, sessionKey, turnId, message)
    return
  }
  if (message.type === 'stream_event') {
    handleStreamContent(context, sessionKey, turnId, message)
    return
  }
  if (message.type === 'tool_progress') {
    handleToolProgressMsg(context, runtime, sessionKey, turnId, message)
    return
  }
  if (message.type === 'tool_use_summary') {
    handleToolUseSummaryMsg(context, runtime, sessionKey, turnId, message)
    return
  }
  if (message.type === 'system') {
    handleSystemMsg(context, runtime, sessionKey, turnId, message)
    return
  }
  if (message.type === 'result') {
    handleResultMsg(context, sessionKey, turnId, message)
  }
}
