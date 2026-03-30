import type {
  ClaudeChatApprovalRequest,
  ClaudeChatNotification,
  ClaudeChatState,
  ClaudeChatUserInputRequest,
  OrxaEvent,
} from '@shared/ipc'
import type { ClaudeChatMessageItem, ClaudeChatSubagentState } from './claude-chat-session-utils'
import {
  assistantMessageIdForTurn,
  buildClaudeExploreEntry,
  ensureThinkingRow,
  isClaudeExploreCandidate,
  nextClaudeMessageId,
  appendAssistantDelta,
  removeThinkingRow,
  upsertAssistantMessage,
  upsertClaudeTool,
  upsertExploreRow,
} from './claude-chat-session-utils'

export type ClaudeChatSessionEventContext = {
  directory: string
  sessionKey: string
  setClaudeChatConnectionState: (
    sessionKey: string,
    status: ClaudeChatState['status'],
    providerThreadId?: string,
    activeTurnId?: string | null,
    lastError?: string
  ) => void
  setClaudeChatProviderThreadId: (sessionKey: string, providerThreadId: string) => void
  setClaudeChatPendingApproval: (
    sessionKey: string,
    value: ClaudeChatApprovalRequest | null
  ) => void
  setClaudeChatPendingUserInput: (
    sessionKey: string,
    value: ClaudeChatUserInputRequest | null
  ) => void
  setClaudeChatStreaming: (sessionKey: string, value: boolean) => void
  setClaudeChatSubagents: (
    sessionKey: string,
    updater:
      | ClaudeChatSubagentState[]
      | ((previous: ClaudeChatSubagentState[]) => ClaudeChatSubagentState[])
  ) => void
  updateClaudeChatMessages: (
    sessionKey: string,
    updater: (previous: ClaudeChatMessageItem[]) => ClaudeChatMessageItem[]
  ) => void
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === 'number' ? value : undefined
}

function handleThreadStarted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const providerThreadId = readString(params.providerThreadId)
  const taskId = readString(params.taskId)
  const isSubagent = params.isSubagent === true
  if (!isSubagent && providerThreadId) {
    context.setClaudeChatProviderThreadId(context.sessionKey, providerThreadId)
  }
  if (isSubagent && providerThreadId && taskId) {
    context.setClaudeChatSubagents(context.sessionKey, previous =>
      previous.map(agent =>
        agent.id === taskId ? { ...agent, sessionID: providerThreadId } : agent
      )
    )
  }
}

function handleTurnStarted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  context.updateClaudeChatMessages(context.sessionKey, messages =>
    ensureThinkingRow(messages, turnId, timestamp)
  )
  context.setClaudeChatStreaming(context.sessionKey, true)
}

function handleThinkingStopped(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  context.updateClaudeChatMessages(context.sessionKey, messages => removeThinkingRow(messages, turnId))
}

function handleAssistantPartial(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  const fallbackId = readString(params.id) ?? nextClaudeMessageId(context.sessionKey)
  const id = assistantMessageIdForTurn(turnId, fallbackId)
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  const content = readString(params.content) ?? ''
  context.updateClaudeChatMessages(context.sessionKey, messages =>
    appendAssistantDelta(messages, id, content, timestamp)
  )
  context.setClaudeChatStreaming(context.sessionKey, true)
}

function handleAssistantMessage(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  const fallbackId = readString(params.id) ?? nextClaudeMessageId(context.sessionKey)
  const id = assistantMessageIdForTurn(turnId, fallbackId)
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  const content = readString(params.content) ?? ''
  context.updateClaudeChatMessages(context.sessionKey, messages =>
    upsertAssistantMessage(messages, id, content, timestamp)
  )
}

function handleToolProgress(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const id = readString(params.id) ?? nextClaudeMessageId(context.sessionKey)
  const toolName = readString(params.toolName) ?? 'Tool'
  const taskId = readString(params.taskId) ?? ''
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  const source = taskId ? ('delegated' as const) : ('main' as const)
  if (isClaudeExploreCandidate({ toolName })) {
    const entry = buildClaudeExploreEntry({
      id,
      toolName,
      status: 'running',
    })
    context.updateClaudeChatMessages(context.sessionKey, messages =>
      upsertExploreRow(messages, `explore:${id}`, entry, timestamp, 'exploring', source)
    )
    return
  }
  context.updateClaudeChatMessages(context.sessionKey, messages => {
    const toolItem: ClaudeChatMessageItem = {
      id,
      kind: 'tool',
      source,
      title: toolName,
      toolType: toolName,
      status: 'running',
      output:
        typeof params.elapsedTimeSeconds === 'number'
          ? `Running for ${params.elapsedTimeSeconds.toFixed(1)}s`
          : undefined,
      timestamp,
    }
    return upsertClaudeTool(messages, toolItem)
  })
}

function handleToolCompleted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const id = readString(params.id) ?? nextClaudeMessageId(context.sessionKey)
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  const toolName = readString(params.toolName) ?? 'Tool call'
  const summary = readString(params.summary)
  const taskId = readString(params.taskId) ?? ''
  const source = taskId ? ('delegated' as const) : ('main' as const)
  if (isClaudeExploreCandidate({ toolName, summary })) {
    const entry = buildClaudeExploreEntry({
      id,
      toolName,
      summary,
      status: 'completed',
    })
    context.updateClaudeChatMessages(context.sessionKey, messages =>
      upsertExploreRow(messages, `explore:${id}`, entry, timestamp, 'explored', source)
    )
    return
  }
  context.updateClaudeChatMessages(context.sessionKey, messages => {
    const toolItem: ClaudeChatMessageItem = {
      id,
      kind: 'tool',
      source,
      title: toolName,
      toolType: toolName,
      status: 'completed',
      output: summary,
      timestamp,
    }
    return upsertClaudeTool(messages, toolItem)
  })
}

function handleTaskStarted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const taskId = readString(params.taskId) ?? nextClaudeMessageId(context.sessionKey)
  const description = readString(params.description) ?? 'Subagent task'
  const prompt = readString(params.prompt)
  const taskType = readString(params.taskType)
  context.setClaudeChatSubagents(context.sessionKey, previous => [
    ...previous.filter(agent => agent.id !== taskId),
    {
      id: taskId,
      name: taskType ? taskType.replace(/[_-]/g, ' ') : 'subagent',
      role: taskType ? taskType.replace(/[_-]/g, ' ') : 'worker',
      status: 'thinking',
      statusText: 'is running',
      prompt,
      taskText: description,
    },
  ])
  if (isClaudeExploreCandidate({ description, taskType })) {
    const timestamp = readNumber(params.timestamp) ?? Date.now()
    const entry = buildClaudeExploreEntry({
      id: taskId,
      description,
      summary: prompt,
      taskType,
      status: 'running',
    })
    context.updateClaudeChatMessages(context.sessionKey, messages =>
      upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, 'exploring', 'delegated')
    )
  }
}

function handleTaskProgress(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const taskId = readString(params.taskId) ?? ''
  const description = readString(params.description)
  const summary = readString(params.summary)
  const lastToolName = readString(params.lastToolName)
  context.setClaudeChatSubagents(context.sessionKey, previous =>
    previous.map(agent =>
      agent.id === taskId
        ? {
            ...agent,
            status: 'thinking',
            statusText: summary || description || 'is running',
          }
        : agent
    )
  )
  if (taskId && isClaudeExploreCandidate({ description, summary, toolName: lastToolName })) {
    const timestamp = readNumber(params.timestamp) ?? Date.now()
    const entry = buildClaudeExploreEntry({
      id: taskId,
      toolName: lastToolName,
      description,
      summary,
      status: 'running',
    })
    context.updateClaudeChatMessages(context.sessionKey, messages =>
      upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, 'exploring', 'delegated')
    )
  }
}

function handleTaskCompleted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const taskId = readString(params.taskId) ?? ''
  const summary = readString(params.summary)
  context.setClaudeChatSubagents(context.sessionKey, previous =>
    previous.map(agent =>
      agent.id === taskId
        ? {
            ...agent,
            status: 'completed',
            statusText: 'completed',
          }
        : agent
    )
  )
  if (taskId && isClaudeExploreCandidate({ summary })) {
    const timestamp = readNumber(params.timestamp) ?? Date.now()
    const status =
      typeof params.status === 'string' && params.status !== 'completed'
        ? ('error' as const)
        : ('completed' as const)
    const entry = buildClaudeExploreEntry({
      id: taskId,
      summary,
      status,
    })
    context.updateClaudeChatMessages(context.sessionKey, messages =>
      upsertExploreRow(messages, `task:${taskId}`, entry, timestamp, 'explored', 'delegated')
    )
  }
}

function handleTurnCompleted(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  context.updateClaudeChatMessages(context.sessionKey, messages => removeThinkingRow(messages, turnId))
  context.setClaudeChatStreaming(context.sessionKey, false)
  context.setClaudeChatPendingApproval(context.sessionKey, null)
  context.setClaudeChatPendingUserInput(context.sessionKey, null)
}

function handleTurnError(
  context: ClaudeChatSessionEventContext,
  params: Record<string, unknown>
) {
  const turnId = readString(params.turnId) ?? ''
  const timestamp = readNumber(params.timestamp) ?? Date.now()
  const message = readString(params.message) ?? 'Claude turn failed.'
  context.updateClaudeChatMessages(context.sessionKey, messages => [
    ...removeThinkingRow(messages, turnId),
    {
      id: nextClaudeMessageId(context.sessionKey),
      kind: 'notice',
      label: 'Claude error',
      detail: message,
      tone: 'error',
      timestamp,
    },
  ])
  context.setClaudeChatStreaming(context.sessionKey, false)
}

function handleClaudeChatNotification(
  context: ClaudeChatSessionEventContext,
  notification: ClaudeChatNotification
) {
  const { method, params } = notification
  switch (method) {
    case 'thread/started':
      handleThreadStarted(context, params)
      return
    case 'turn/started':
      handleTurnStarted(context, params)
      return
    case 'thinking/stopped':
      handleThinkingStopped(context, params)
      return
    case 'assistant/partial':
      handleAssistantPartial(context, params)
      return
    case 'assistant/message':
      handleAssistantMessage(context, params)
      return
    case 'tool/progress':
      handleToolProgress(context, params)
      return
    case 'tool/completed':
      handleToolCompleted(context, params)
      return
    case 'task/started':
      handleTaskStarted(context, params)
      return
    case 'task/progress':
      handleTaskProgress(context, params)
      return
    case 'task/completed':
      handleTaskCompleted(context, params)
      return
    case 'turn/completed':
      handleTurnCompleted(context, params)
      return
    case 'turn/error':
      handleTurnError(context, params)
  }
}

export function subscribeClaudeChatSessionEvents(
  context: ClaudeChatSessionEventContext
) {
  return window.orxa.events.subscribe((event: OrxaEvent) => {
    if (event.type === 'claude-chat.state' && event.payload.sessionKey === context.sessionKey) {
      context.setClaudeChatConnectionState(
        context.sessionKey,
        event.payload.status,
        event.payload.providerThreadId,
        event.payload.activeTurnId,
        event.payload.lastError
      )
      return
    }
    if (event.type === 'claude-chat.approval' && event.payload.sessionKey === context.sessionKey) {
      context.setClaudeChatPendingApproval(context.sessionKey, event.payload)
      return
    }
    if (event.type === 'claude-chat.userInput' && event.payload.sessionKey === context.sessionKey) {
      context.setClaudeChatPendingUserInput(context.sessionKey, event.payload)
      return
    }
    if (event.type !== 'claude-chat.notification' || event.payload.sessionKey !== context.sessionKey) {
      return
    }
    handleClaudeChatNotification(context, event.payload)
  })
}
