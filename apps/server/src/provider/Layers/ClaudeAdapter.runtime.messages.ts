/**
 * Claude adapter runtime message-handler helpers.
 *
 * Hosts handlers for SDK stream events, user messages, assistant messages,
 * and result messages. This module bridges the low-level event emitters in
 * `ClaudeAdapter.runtime.events.ts` and the turn lifecycle in
 * `ClaudeAdapter.runtime.turns.ts` into the top-level `handleSdkMessage`
 * dispatcher in `ClaudeAdapter.runtime.system.ts`. All helpers take the
 * shared `ClaudeAdapterDeps`.
 *
 * @module ClaudeAdapter.runtime.messages
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { Effect } from 'effect'

import type { ClaudeAdapterDeps } from './ClaudeAdapter.deps.ts'
import {
  asRuntimeItemId,
  classifyToolItemType,
  summarizeToolRequest,
  titleForTool,
} from './ClaudeAdapter.pure.ts'
import {
  backfillAssistantTextBlocksFromSnapshot,
  emitProposedPlanCompleted,
  emitRuntimeError,
  ensureAssistantTextBlock,
  ensureThreadId as ensureThreadIdEvent,
  logNativeSdkMessage as logNativeSdkMessageEvent,
  completeAssistantTextBlock,
  updateResumeCursor,
} from './ClaudeAdapter.runtime.events.ts'
import { completeTurn, ensureSyntheticAssistantTurn } from './ClaudeAdapter.runtime.turns.ts'
import {
  extractContentBlockText,
  extractExitPlanModePlan,
  nativeProviderRefs,
  streamKindFromDeltaType,
  toolInputFingerprint,
  toolResultBlocksFromUserMessage,
  toolResultStreamKind,
  tryParseJsonRecord,
  turnStatusFromResult,
} from './ClaudeAdapter.sdk.ts'
import {
  PROVIDER,
  type AssistantTextBlockState,
  type ClaudeSessionContext,
  type ToolInFlight,
} from './ClaudeAdapter.types.ts'

// Re-export helpers needed by the system module so it has a single import surface.
export { emitRuntimeWarning } from './ClaudeAdapter.runtime.events.ts'

import {
  buildContentDeltaEventBase,
  buildToolItemEventBase,
} from './ClaudeAdapter.runtime.eventBase.ts'

type ToolItemEventStatus = 'inProgress' | 'failed' | 'completed'

function buildToolItemPayload(
  tool: Pick<ToolInFlight, 'itemType' | 'title' | 'detail'>,
  status: ToolItemEventStatus,
  data: Record<string, unknown>
) {
  return {
    itemType: tool.itemType,
    status,
    title: tool.title,
    ...(tool.detail ? { detail: tool.detail } : {}),
    data,
  }
}

function buildClaudeUserToolRaw(message: SDKMessage) {
  return {
    source: 'claude.sdk.message' as const,
    method: 'claude/user',
    payload: message,
  }
}

export const logNativeSdkMessage = logNativeSdkMessageEvent
export const ensureThreadId = ensureThreadIdEvent

export const emitStreamTextDelta = Effect.fn('emitStreamTextDelta')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: Extract<SDKMessage, { type: 'stream_event' }>
) {
  const { event } = message
  if (
    event.type !== 'content_block_delta' ||
    !context.turnState ||
    (event.delta.type !== 'text_delta' && event.delta.type !== 'thinking_delta')
  ) {
    return false
  }

  const deltaText =
    event.delta.type === 'text_delta'
      ? event.delta.text
      : typeof event.delta.thinking === 'string'
        ? event.delta.thinking
        : ''
  if (deltaText.length === 0) {
    return true
  }

  const assistantBlockEntry =
    event.delta.type === 'text_delta'
      ? yield* ensureAssistantTextBlock(deps, context, event.index)
      : context.turnState.assistantTextBlocks.get(event.index)
        ? {
            blockIndex: event.index,
            block: context.turnState.assistantTextBlocks.get(
              event.index
            ) as AssistantTextBlockState,
          }
        : undefined
  if (assistantBlockEntry?.block && event.delta.type === 'text_delta') {
    assistantBlockEntry.block.emittedTextDelta = true
  }

  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'content.delta',
    eventId: stamp.eventId,
    provider: PROVIDER,
    createdAt: stamp.createdAt,
    threadId: context.session.threadId,
    turnId: context.turnState.turnId,
    ...(assistantBlockEntry?.block
      ? { itemId: asRuntimeItemId(assistantBlockEntry.block.itemId) }
      : {}),
    payload: {
      streamKind: streamKindFromDeltaType(event.delta.type),
      delta: deltaText,
    },
    providerRefs: nativeProviderRefs(context),
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/stream_event/content_block_delta',
      payload: message,
    },
  })
  return true
})

export const emitInputJsonToolDelta = Effect.fn('emitInputJsonToolDelta')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: Extract<SDKMessage, { type: 'stream_event' }>
) {
  const { event } = message
  if (event.type !== 'content_block_delta' || event.delta.type !== 'input_json_delta') {
    return false
  }

  const tool = context.inFlightTools.get(event.index)
  if (!tool || typeof event.delta.partial_json !== 'string') {
    return true
  }

  const partialInputJson = tool.partialInputJson + event.delta.partial_json
  const parsedInput = tryParseJsonRecord(partialInputJson)
  const detail = parsedInput ? summarizeToolRequest(tool.toolName, parsedInput) : tool.detail
  let nextTool: ToolInFlight = {
    ...tool,
    partialInputJson,
    ...(parsedInput ? { input: parsedInput } : {}),
    ...(detail ? { detail } : {}),
  }

  const nextFingerprint =
    parsedInput && Object.keys(parsedInput).length > 0
      ? toolInputFingerprint(parsedInput)
      : undefined
  context.inFlightTools.set(event.index, nextTool)

  if (!parsedInput || !nextFingerprint || tool.lastEmittedInputFingerprint === nextFingerprint) {
    return true
  }

  nextTool = {
    ...nextTool,
    lastEmittedInputFingerprint: nextFingerprint,
  }
  context.inFlightTools.set(event.index, nextTool)

  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'item.updated',
    ...buildToolItemEventBase(context, stamp, nextTool.itemId),
    payload: buildToolItemPayload(nextTool, 'inProgress', {
      toolName: nextTool.toolName,
      input: nextTool.input,
    }),
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/stream_event/content_block_delta/input_json_delta',
      payload: message,
    },
  })
  return true
})

export const handleStreamBlockStart = Effect.fn('handleStreamBlockStart')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: Extract<SDKMessage, { type: 'stream_event' }>
) {
  const { event } = message
  if (event.type !== 'content_block_start') {
    return false
  }

  const { index, content_block: block } = event
  if (block.type === 'text') {
    yield* ensureAssistantTextBlock(deps, context, index, {
      fallbackText: extractContentBlockText(block),
    })
    return true
  }
  if (
    block.type !== 'tool_use' &&
    block.type !== 'server_tool_use' &&
    block.type !== 'mcp_tool_use'
  ) {
    return true
  }

  const toolName = block.name
  const itemType = classifyToolItemType(toolName)
  const toolInput =
    typeof block.input === 'object' && block.input !== null
      ? (block.input as Record<string, unknown>)
      : {}
  const detail = summarizeToolRequest(toolName, toolInput)
  const inputFingerprint =
    Object.keys(toolInput).length > 0 ? toolInputFingerprint(toolInput) : undefined

  const tool: ToolInFlight = {
    itemId: block.id,
    itemType,
    toolName,
    title: titleForTool(itemType),
    detail,
    input: toolInput,
    partialInputJson: '',
    ...(inputFingerprint ? { lastEmittedInputFingerprint: inputFingerprint } : {}),
  }
  context.inFlightTools.set(index, tool)

  const stamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'item.started',
    ...buildToolItemEventBase(context, stamp, tool.itemId),
    payload: buildToolItemPayload(tool, 'inProgress', {
      toolName: tool.toolName,
      input: toolInput,
    }),
    raw: {
      source: 'claude.sdk.message',
      method: 'claude/stream_event/content_block_start',
      payload: message,
    },
  })
  return true
})

export const handleStreamBlockStop = Effect.fn('handleStreamBlockStop')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: Extract<SDKMessage, { type: 'stream_event' }>
) {
  const { event } = message
  if (event.type !== 'content_block_stop') {
    return false
  }

  const assistantBlock = context.turnState?.assistantTextBlocks.get(event.index)
  if (!assistantBlock) {
    return true
  }

  assistantBlock.streamClosed = true
  yield* completeAssistantTextBlock(deps, context, assistantBlock, {
    rawMethod: 'claude/stream_event/content_block_stop',
    rawPayload: message,
  })
  return true
})

export const handleStreamEvent = Effect.fn('handleStreamEvent')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (message.type !== 'stream_event') {
    return
  }

  if (yield* emitStreamTextDelta(deps, context, message)) {
    return
  }
  if (yield* emitInputJsonToolDelta(deps, context, message)) {
    return
  }
  if (yield* handleStreamBlockStart(deps, context, message)) {
    return
  }
  if (yield* handleStreamBlockStop(deps, context, message)) {
    return
  }
})

export const emitUserToolResultUpdate = Effect.fn('emitUserToolResultUpdate')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage,
  tool: ToolInFlight,
  toolResult: ReturnType<typeof toolResultBlocksFromUserMessage>[number],
  toolData: {
    readonly toolName: string
    readonly input: Record<string, unknown>
    readonly result: unknown
  }
) {
  const updatedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'item.updated',
    ...buildToolItemEventBase(context, updatedStamp, tool.itemId),
    payload: buildToolItemPayload(tool, toolResult.isError ? 'failed' : 'inProgress', toolData),
    raw: buildClaudeUserToolRaw(message),
  })
})

export const emitUserToolResultDelta = Effect.fn('emitUserToolResultDelta')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage,
  tool: ToolInFlight,
  toolResult: ReturnType<typeof toolResultBlocksFromUserMessage>[number]
) {
  const streamKind = toolResultStreamKind(tool.itemType)
  if (!streamKind || toolResult.text.length === 0 || !context.turnState) {
    return
  }

  const deltaStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'content.delta',
    ...buildContentDeltaEventBase({
      context,
      stamp: deltaStamp,
      turnId: context.turnState.turnId,
      itemId: tool.itemId,
      providerRefs: nativeProviderRefs(context, { providerItemId: tool.itemId }),
    }),
    payload: {
      streamKind,
      delta: toolResult.text,
    },
    raw: buildClaudeUserToolRaw(message),
  })
})

export const emitUserToolResultCompletion = Effect.fn('emitUserToolResultCompletion')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage,
  tool: ToolInFlight,
  itemStatus: 'failed' | 'completed',
  toolData: {
    readonly toolName: string
    readonly input: Record<string, unknown>
    readonly result: unknown
  }
) {
  const completedStamp = yield* deps.makeEventStamp()
  yield* deps.offerRuntimeEvent({
    type: 'item.completed',
    ...buildToolItemEventBase(context, completedStamp, tool.itemId),
    payload: buildToolItemPayload(tool, itemStatus, toolData),
    raw: buildClaudeUserToolRaw(message),
  })
})

export const emitToolResultFromUserMessage = Effect.fn('emitToolResultFromUserMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage,
  toolResult: ReturnType<typeof toolResultBlocksFromUserMessage>[number]
) {
  const toolEntry = Array.from(context.inFlightTools.entries()).find(
    ([, tool]) => tool.itemId === toolResult.toolUseId
  )
  if (!toolEntry) {
    return
  }

  const [index, tool] = toolEntry
  const itemStatus = toolResult.isError ? 'failed' : 'completed'
  const toolData = {
    toolName: tool.toolName,
    input: tool.input,
    result: toolResult.block,
  }

  yield* emitUserToolResultUpdate(deps, context, message, tool, toolResult, toolData)
  yield* emitUserToolResultDelta(deps, context, message, tool, toolResult)
  yield* emitUserToolResultCompletion(deps, context, message, tool, itemStatus, toolData)
  context.inFlightTools.delete(index)
})

export const handleUserMessage = Effect.fn('handleUserMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (message.type !== 'user') {
    return
  }

  if (context.turnState) {
    context.turnState.items.push(message.message)
  }

  for (const toolResult of toolResultBlocksFromUserMessage(message)) {
    yield* emitToolResultFromUserMessage(deps, context, message, toolResult)
  }
})

export const emitAssistantExitPlanFromMessage = Effect.fn('emitAssistantExitPlanFromMessage')(
  function* (
    deps: ClaudeAdapterDeps,
    context: ClaudeSessionContext,
    message: Extract<SDKMessage, { type: 'assistant' }>
  ) {
    const content = message.message?.content
    if (!Array.isArray(content)) {
      return
    }

    for (const block of content) {
      if (!block || typeof block !== 'object') {
        continue
      }
      const toolUse = block as {
        type?: unknown
        id?: unknown
        name?: unknown
        input?: unknown
      }
      if (toolUse.type !== 'tool_use' || toolUse.name !== 'ExitPlanMode') {
        continue
      }
      const planMarkdown = extractExitPlanModePlan(toolUse.input)
      if (!planMarkdown) {
        continue
      }
      yield* emitProposedPlanCompleted(deps, context, {
        planMarkdown,
        toolUseId: typeof toolUse.id === 'string' ? toolUse.id : undefined,
        rawSource: 'claude.sdk.message',
        rawMethod: 'claude/assistant',
        rawPayload: message,
      })
    }
  }
)

export const handleAssistantMessage = Effect.fn('handleAssistantMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (message.type !== 'assistant') {
    return
  }

  yield* ensureSyntheticAssistantTurn(deps, context)
  yield* emitAssistantExitPlanFromMessage(deps, context, message)

  if (context.turnState) {
    context.turnState.items.push(message.message)
    yield* backfillAssistantTextBlocksFromSnapshot(deps, context, message)
  }

  context.lastAssistantUuid = message.uuid
  yield* updateResumeCursor(deps, context)
})

export const handleResultMessage = Effect.fn('handleResultMessage')(function* (
  deps: ClaudeAdapterDeps,
  context: ClaudeSessionContext,
  message: SDKMessage
) {
  if (message.type !== 'result') {
    return
  }

  const status = turnStatusFromResult(message)
  const errorMessage = message.subtype === 'success' ? undefined : message.errors[0]

  if (status === 'failed') {
    yield* emitRuntimeError(deps, context, errorMessage ?? 'Claude turn failed.')
  }

  yield* completeTurn(deps, context, status, errorMessage, message)
})
