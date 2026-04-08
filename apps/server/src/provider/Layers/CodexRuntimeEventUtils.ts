import {
  type CanonicalItemType,
  type CanonicalRequestType,
  type ProviderEvent,
  type ProviderRuntimeEvent,
  type ProviderUserInputAnswers,
  type ThreadTokenUsageSnapshot,
  ProviderApprovalDecision,
  ProviderItemId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Schema } from 'effect'

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  return value as Record<string, unknown>
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function decodeProviderApprovalDecision(value: unknown) {
  return Schema.decodeUnknownSync(ProviderApprovalDecision)(value)
}

function readCodexNumber(
  record: Record<string, unknown> | undefined,
  snakeCaseKey: string,
  camelCaseKey: string
): number | undefined {
  if (!record) {
    return undefined
  }
  return asNumber(record[snakeCaseKey]) ?? asNumber(record[camelCaseKey])
}

const FATAL_CODEX_STDERR_SNIPPETS = ['failed to connect to websocket']
const PROPOSED_PLAN_BLOCK_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/i
type MutableThreadTokenUsageSnapshot = {
  -readonly [K in keyof ThreadTokenUsageSnapshot]: ThreadTokenUsageSnapshot[K]
}

const CANONICAL_ITEM_MARKERS = [
  { itemType: 'user_message', markers: ['user'] },
  { itemType: 'assistant_message', markers: ['agent message', 'assistant'] },
  { itemType: 'reasoning', markers: ['reasoning', 'thought'] },
  { itemType: 'plan', markers: ['plan', 'todo'] },
  { itemType: 'command_execution', markers: ['command'] },
  { itemType: 'file_change', markers: ['file change', 'patch', 'edit'] },
  { itemType: 'mcp_tool_call', markers: ['mcp'] },
  { itemType: 'dynamic_tool_call', markers: ['dynamic tool'] },
  { itemType: 'collab_agent_tool_call', markers: ['collab'] },
  { itemType: 'web_search', markers: ['web search'] },
  { itemType: 'image_view', markers: ['image'] },
  { itemType: 'review_entered', markers: ['review entered'] },
  { itemType: 'review_exited', markers: ['review exited'] },
  { itemType: 'context_compaction', markers: ['compact'] },
  { itemType: 'error', markers: ['error'] },
] as const satisfies ReadonlyArray<{
  itemType: CanonicalItemType
  markers: ReadonlyArray<string>
}>

export function isFatalCodexProcessStderrMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return FATAL_CODEX_STDERR_SNIPPETS.some(snippet => normalized.includes(snippet))
}

function assignTokenUsageSnapshotField<K extends keyof ThreadTokenUsageSnapshot>(
  snapshot: MutableThreadTokenUsageSnapshot,
  key: K,
  value: ThreadTokenUsageSnapshot[K] | undefined
) {
  if (value !== undefined) {
    snapshot[key] = value
  }
}

export function normalizeCodexTokenUsage(value: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = asObject(value)
  const totalUsage = asObject(usage?.total_token_usage ?? usage?.total)
  const lastUsage = asObject(usage?.last_token_usage ?? usage?.last)
  const totalProcessedTokens = readCodexNumber(totalUsage, 'total_tokens', 'totalTokens')
  const usedTokens =
    readCodexNumber(lastUsage, 'total_tokens', 'totalTokens') ?? totalProcessedTokens
  if (usedTokens === undefined || usedTokens <= 0) {
    return undefined
  }

  const maxTokens = readCodexNumber(usage, 'model_context_window', 'modelContextWindow')
  const inputTokens = readCodexNumber(lastUsage, 'input_tokens', 'inputTokens')
  const cachedInputTokens = readCodexNumber(lastUsage, 'cached_input_tokens', 'cachedInputTokens')
  const outputTokens = readCodexNumber(lastUsage, 'output_tokens', 'outputTokens')
  const reasoningOutputTokens = readCodexNumber(
    lastUsage,
    'reasoning_output_tokens',
    'reasoningOutputTokens'
  )
  const snapshot: MutableThreadTokenUsageSnapshot = {
    usedTokens,
    lastUsedTokens: usedTokens,
    compactsAutomatically: true,
  }
  if (totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens) {
    snapshot.totalProcessedTokens = totalProcessedTokens
  }
  assignTokenUsageSnapshotField(snapshot, 'maxTokens', maxTokens)
  assignTokenUsageSnapshotField(snapshot, 'inputTokens', inputTokens)
  assignTokenUsageSnapshotField(snapshot, 'cachedInputTokens', cachedInputTokens)
  assignTokenUsageSnapshotField(snapshot, 'outputTokens', outputTokens)
  assignTokenUsageSnapshotField(snapshot, 'reasoningOutputTokens', reasoningOutputTokens)
  assignTokenUsageSnapshotField(snapshot, 'lastInputTokens', inputTokens)
  assignTokenUsageSnapshotField(snapshot, 'lastCachedInputTokens', cachedInputTokens)
  assignTokenUsageSnapshotField(snapshot, 'lastOutputTokens', outputTokens)
  assignTokenUsageSnapshotField(snapshot, 'lastReasoningOutputTokens', reasoningOutputTokens)
  return snapshot
}

export function toTurnId(value: string | undefined): TurnId | undefined {
  return value?.trim() ? TurnId.makeUnsafe(value) : undefined
}

export function toProviderItemId(value: string | undefined): ProviderItemId | undefined {
  return value?.trim() ? ProviderItemId.makeUnsafe(value) : undefined
}

export function toTurnStatus(value: unknown): 'completed' | 'failed' | 'cancelled' | 'interrupted' {
  switch (value) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return value
    default:
      return 'completed'
  }
}

function normalizeItemType(raw: unknown): string {
  const type = asString(raw)
  if (!type) {
    return 'item'
  }
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function toCanonicalItemType(raw: unknown): CanonicalItemType {
  const type = normalizeItemType(raw)
  const matched = CANONICAL_ITEM_MARKERS.find(({ markers }) =>
    markers.some(marker => type.includes(marker))
  )
  return matched?.itemType ?? 'unknown'
}

export function itemTitle(itemType: CanonicalItemType): string | undefined {
  switch (itemType) {
    case 'assistant_message':
      return 'Assistant message'
    case 'user_message':
      return 'User message'
    case 'reasoning':
      return 'Reasoning'
    case 'plan':
      return 'Plan'
    case 'command_execution':
      return 'Ran command'
    case 'file_change':
      return 'File change'
    case 'mcp_tool_call':
      return 'MCP tool call'
    case 'dynamic_tool_call':
      return 'Tool call'
    case 'web_search':
      return 'Web search'
    case 'image_view':
      return 'Image view'
    case 'error':
      return 'Error'
    default:
      return undefined
  }
}

export function itemDetail(
  item: Record<string, unknown>,
  payload: Record<string, unknown>
): string | undefined {
  const nestedResult = asObject(item.result)
  const candidates = [
    asString(item.command),
    asString(item.title),
    asString(item.summary),
    asString(item.text),
    asString(item.path),
    asString(item.prompt),
    asString(nestedResult?.command),
    asString(payload.command),
    asString(payload.message),
    asString(payload.prompt),
  ]
  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return undefined
}

export function toRequestTypeFromMethod(method: string): CanonicalRequestType {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return 'command_execution_approval'
    case 'item/fileRead/requestApproval':
      return 'file_read_approval'
    case 'item/fileChange/requestApproval':
      return 'file_change_approval'
    case 'applyPatchApproval':
      return 'apply_patch_approval'
    case 'execCommandApproval':
      return 'exec_command_approval'
    case 'item/tool/requestUserInput':
      return 'tool_user_input'
    case 'item/tool/call':
      return 'dynamic_tool_call'
    case 'account/chatgptAuthTokens/refresh':
      return 'auth_tokens_refresh'
    default:
      return 'unknown'
  }
}

export function toRequestTypeFromKind(kind: unknown): CanonicalRequestType {
  switch (kind) {
    case 'command':
      return 'command_execution_approval'
    case 'file-read':
      return 'file_read_approval'
    case 'file-change':
      return 'file_change_approval'
    default:
      return 'unknown'
  }
}

export function toRequestTypeFromResolvedPayload(
  payload: Record<string, unknown> | undefined
): CanonicalRequestType {
  const request = asObject(payload?.request)
  const method = asString(request?.method) ?? asString(payload?.method)
  if (method) {
    return toRequestTypeFromMethod(method)
  }
  const requestKind = asString(request?.kind) ?? asString(payload?.requestKind)
  return requestKind ? toRequestTypeFromKind(requestKind) : 'unknown'
}

export function toCanonicalUserInputAnswers(
  answers: ProviderUserInputAnswers | undefined
): ProviderUserInputAnswers {
  if (!answers) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(answers).flatMap(([questionId, value]) => {
      if (typeof value === 'string') {
        return [[questionId, value] as const]
      }
      if (Array.isArray(value)) {
        const normalized = value.filter((entry): entry is string => typeof entry === 'string')
        return [[questionId, normalized.length === 1 ? normalized[0] : normalized] as const]
      }

      const answerObject = asObject(value)
      const answerList = asArray(answerObject?.answers)?.filter(
        (entry): entry is string => typeof entry === 'string'
      )
      return answerList ? [[questionId, answerList.length === 1 ? answerList[0] : answerList]] : []
    })
  )
}

export function toUserInputQuestions(payload: Record<string, unknown> | undefined) {
  const questions = asArray(payload?.questions)
  if (!questions) {
    return undefined
  }

  const parsedQuestions = questions
    .map(entry => {
      const question = asObject(entry)
      const options = asArray(question?.options)
        ?.map(option => {
          const optionRecord = asObject(option)
          const label = asString(optionRecord?.label)?.trim()
          const description = asString(optionRecord?.description)?.trim()
          return label && description ? { label, description } : undefined
        })
        .filter((option): option is { label: string; description: string } => option !== undefined)
      const id = asString(question?.id)?.trim()
      const header = asString(question?.header)?.trim()
      const prompt = asString(question?.question)?.trim()
      return id && header && prompt && options && options.length > 0
        ? { id, header, question: prompt, options }
        : undefined
    })
    .filter(
      (
        question
      ): question is {
        id: string
        header: string
        question: string
        options: Array<{ label: string; description: string }>
      } => question !== undefined
    )

  return parsedQuestions.length > 0 ? parsedQuestions : undefined
}

export function toThreadState(
  value: unknown
): 'active' | 'idle' | 'archived' | 'closed' | 'compacted' | 'error' {
  switch (value) {
    case 'idle':
      return 'idle'
    case 'archived':
      return 'archived'
    case 'closed':
      return 'closed'
    case 'compacted':
      return 'compacted'
    case 'error':
    case 'failed':
      return 'error'
    default:
      return 'active'
  }
}

export function contentStreamKindFromMethod(
  method: string
):
  | 'assistant_text'
  | 'reasoning_text'
  | 'reasoning_summary_text'
  | 'plan_text'
  | 'command_output'
  | 'file_change_output' {
  switch (method) {
    case 'item/agentMessage/delta':
      return 'assistant_text'
    case 'item/reasoning/textDelta':
      return 'reasoning_text'
    case 'item/reasoning/summaryTextDelta':
      return 'reasoning_summary_text'
    case 'item/commandExecution/outputDelta':
      return 'command_output'
    case 'item/fileChange/outputDelta':
      return 'file_change_output'
    default:
      return 'assistant_text'
  }
}

export function extractProposedPlanMarkdown(text: string | undefined): string | undefined {
  const match = text ? PROPOSED_PLAN_BLOCK_REGEX.exec(text) : null
  const planMarkdown = match?.[1]?.trim()
  return planMarkdown && planMarkdown.length > 0 ? planMarkdown : undefined
}

export function asRuntimeItemId(itemId: ProviderItemId): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(itemId)
}

export function asRuntimeRequestId(requestId: string): RuntimeRequestId {
  return RuntimeRequestId.makeUnsafe(requestId)
}

export function asRuntimeTaskId(taskId: string): RuntimeTaskId {
  return RuntimeTaskId.makeUnsafe(taskId)
}

export function codexEventMessage(
  payload: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  return asObject(payload?.msg)
}

export function runtimeEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): Omit<ProviderRuntimeEvent, 'type' | 'payload'> {
  const refs: Record<string, string> = {}
  if (event.turnId) refs.providerTurnId = event.turnId
  if (event.itemId) refs.providerItemId = event.itemId
  if (event.requestId) refs.providerRequestId = event.requestId

  return {
    eventId: event.id,
    provider: event.provider,
    threadId: canonicalThreadId,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.itemId ? { itemId: asRuntimeItemId(event.itemId) } : {}),
    ...(event.requestId ? { requestId: asRuntimeRequestId(event.requestId) } : {}),
    ...(Object.keys(refs).length > 0
      ? { providerRefs: refs as ProviderRuntimeEvent['providerRefs'] }
      : {}),
    raw: {
      source:
        event.kind === 'request' ? 'codex.app-server.request' : 'codex.app-server.notification',
      method: event.method,
      payload: event.payload ?? {},
    },
  }
}

export function codexEventBase(
  event: ProviderEvent,
  canonicalThreadId: ThreadId
): Omit<ProviderRuntimeEvent, 'type' | 'payload'> {
  const payload = asObject(event.payload)
  const msg = codexEventMessage(payload)
  const turnId = event.turnId ?? toTurnId(asString(msg?.turn_id) ?? asString(msg?.turnId))
  const itemId = event.itemId ?? toProviderItemId(asString(msg?.item_id) ?? asString(msg?.itemId))
  const requestId = asString(msg?.request_id) ?? asString(msg?.requestId)
  const base = runtimeEventBase(event, canonicalThreadId)
  const providerRefs = {
    ...(base.providerRefs ?? {}),
    ...(turnId ? { providerTurnId: turnId } : {}),
    ...(itemId ? { providerItemId: itemId } : {}),
    ...(requestId ? { providerRequestId: requestId } : {}),
  }

  return {
    ...base,
    ...(turnId ? { turnId } : {}),
    ...(itemId ? { itemId: asRuntimeItemId(itemId) } : {}),
    ...(requestId ? { requestId: asRuntimeRequestId(requestId) } : {}),
    ...(Object.keys(providerRefs).length > 0 ? { providerRefs } : {}),
  }
}

export function mapItemLifecycle(
  event: ProviderEvent,
  canonicalThreadId: ThreadId,
  lifecycle: 'item.started' | 'item.updated' | 'item.completed'
): ProviderRuntimeEvent | undefined {
  const payload = asObject(event.payload)
  const item = asObject(payload?.item)
  const source = item ?? payload
  if (!source) {
    return undefined
  }

  const itemType = toCanonicalItemType(source.type ?? source.kind)
  if (itemType === 'unknown' && lifecycle !== 'item.updated') {
    return undefined
  }

  const status =
    lifecycle === 'item.started'
      ? 'inProgress'
      : lifecycle === 'item.completed'
        ? 'completed'
        : undefined

  return {
    ...runtimeEventBase(event, canonicalThreadId),
    type: lifecycle,
    payload: {
      itemType,
      ...(status ? { status } : {}),
      ...(itemTitle(itemType) ? { title: itemTitle(itemType) } : {}),
      ...(itemDetail(source, payload ?? {}) ? { detail: itemDetail(source, payload ?? {}) } : {}),
      ...(event.payload !== undefined ? { data: event.payload } : {}),
    },
  }
}
