import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  getSessionMessages,
  query,
  renameSession,
  tagSession,
  type Options as ClaudeQueryOptions,
  type ElicitationRequest,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SDKTaskNotificationMessage,
  type SDKToolProgressMessage,
  type SDKToolUseSummaryMessage,
  type SDKUserMessage,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeChatAttachment,
  ClaudeChatApprovalDecision,
  ClaudeChatApprovalRequest,
  ClaudeChatHealthStatus,
  ClaudeChatHistoryMessage,
  ClaudeChatModelEntry,
  ClaudeChatNotification,
  ClaudeChatState,
  ClaudeChatTurnOptions,
  ClaudeChatUserInputRequest,
} from '@shared/ipc'
import { ProviderSessionDirectory } from './provider-session-directory'

type PendingApproval = {
  sessionKey: string
  turnId: string
  itemId: string
  toolName: string
  resolve: (result: PermissionResult) => void
}

type PendingUserInput = {
  sessionKey: string
  turnId: string
  request: ElicitationRequest
  resolve: (result: {
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
  }) => void
}

type ClaudeSubagentRuntime = {
  id: string
  description: string
  prompt?: string
  taskType?: string
  childSessionId?: string
  status: 'thinking' | 'awaiting_instruction' | 'completed' | 'idle'
  statusText: string
  summary?: string
}

type ClaudeSessionRuntime = {
  state: ClaudeChatState
  directory: string
  activeQuery: Query | null
  runningTasks: ClaudeSubagentRuntime[]
  mainProviderThreadId?: string
  toolNamesById: Map<string, string>
}

type CachedClaudeHealth = {
  value: ClaudeChatHealthStatus
  cachedAt: number
}

const CLAUDE_MODELS: ClaudeChatModelEntry[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    isDefault: false,
    supportsFastMode: true,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'max', 'ultrathink'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    isDefault: true,
    supportsFastMode: false,
    supportsThinkingToggle: false,
    supportedReasoningEfforts: ['low', 'medium', 'high', 'ultrathink'],
    defaultReasoningEffort: 'high',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    isDefault: false,
    supportsFastMode: false,
    supportsThinkingToggle: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  },
]
const CLAUDE_HEALTH_CACHE_TTL_MS = 10_000
const CLAUDE_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])
const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const

function supportsClaudeFastMode(model: string | null | undefined) {
  return model?.trim() === 'claude-opus-4-6'
}

function supportsClaudeAdaptiveReasoning(model: string | null | undefined) {
  const normalized = model?.trim()
  return normalized === 'claude-opus-4-6' || normalized === 'claude-sonnet-4-6'
}

function supportsClaudeMaxEffort(model: string | null | undefined) {
  return model?.trim() === 'claude-opus-4-6'
}

function mapPermissionMode(input: string | undefined): PermissionMode | undefined {
  if (input === 'plan') {
    return 'plan'
  }
  if (input === 'yolo-write') {
    return 'bypassPermissions'
  }
  if (input === 'ask-write') {
    return 'default'
  }
  return undefined
}

function normalizeClaudeImageMime(mime: string | undefined) {
  const normalized = mime?.trim().toLowerCase() ?? ''
  return CLAUDE_SUPPORTED_IMAGE_MIME_TYPES.has(normalized)
    ? (normalized as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
    : null
}

function parseImageDataUrl(
  url: string
): { mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(url)
  if (!match) {
    return null
  }
  const mime = normalizeClaudeImageMime(match[1])
  if (!mime) {
    return null
  }
  return { mime, data: match[2]!.trim() }
}

async function attachmentToClaudeImageBlock(attachment: ClaudeChatAttachment) {
  const inlineData = parseImageDataUrl(attachment.url)
  if (inlineData) {
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: inlineData.mime,
        data: inlineData.data,
      },
    }
  }

  const mime = normalizeClaudeImageMime(attachment.mime)
  if (!mime) {
    throw new Error(`Unsupported Claude image attachment type: ${attachment.mime || 'unknown'}`)
  }

  const filePath =
    attachment.path?.trim() ||
    (attachment.url.startsWith('file:') ? fileURLToPath(attachment.url) : '')
  if (!filePath) {
    throw new Error(`Claude image attachment is missing file data for ${attachment.filename}`)
  }
  const data = (await readFile(filePath)).toString('base64')
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: mime,
      data,
    },
  }
}

async function* buildClaudePromptStream(
  sessionId: string,
  prompt: string,
  attachments: ClaudeChatAttachment[]
): AsyncIterable<SDKUserMessage> {
  const content: Array<
    | Awaited<ReturnType<typeof attachmentToClaudeImageBlock>>
    | {
        type: 'text'
        text: string
      }
  > = await Promise.all(attachments.map(attachment => attachmentToClaudeImageBlock(attachment)))
  if (prompt.trim().length > 0) {
    content.push({
      type: 'text',
      text: prompt,
    })
  }
  yield {
    type: 'user',
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content,
    },
  }
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map(entry => extractTextFromUnknown(entry))
      .filter(Boolean)
      .join('')
  }
  if (!value || typeof value !== 'object') {
    return ''
  }
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') {
    return record.text
  }
  if (typeof record.content === 'string') {
    return record.content
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map(entry => extractTextFromUnknown(entry))
      .filter(Boolean)
      .join('')
  }
  return Object.values(record)
    .map(entry => extractTextFromUnknown(entry))
    .filter(Boolean)
    .join('')
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap(entry => extractTextBlocks(entry))
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  const record = value as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : null
  if (type === 'tool_use' || type === 'tool_result') {
    return []
  }
  if (type === 'text' && typeof record.text === 'string') {
    return record.text.trim() ? [record.text] : []
  }
  if (Array.isArray(record.content)) {
    return record.content.flatMap(entry => extractTextBlocks(entry))
  }
  if (!type && typeof record.text === 'string' && record.text.trim()) {
    return [record.text]
  }
  return []
}

function extractAssistantText(message: SDKAssistantMessage) {
  const content = (message.message as Record<string, unknown> | undefined)?.content
  const textBlocks = extractTextBlocks(content)
  if (textBlocks.length > 0) {
    return textBlocks.join('').trim()
  }
  return extractTextBlocks(message.message).join('').trim()
}

function extractPartialAssistantText(message: SDKMessage) {
  if (message.type !== 'stream_event') {
    return ''
  }
  const event = message.event as Record<string, unknown> | undefined
  if (!event || event.type !== 'content_block_delta') {
    return ''
  }
  const delta = event.delta as Record<string, unknown> | undefined
  if (!delta) {
    return ''
  }
  if (typeof delta.text === 'string') {
    return delta.text
  }
  return ''
}

function buildHistoryMessages(messages: SessionMessage[]): ClaudeChatHistoryMessage[] {
  return messages.map((message, index) => ({
    id: message.uuid,
    role: message.type === 'assistant' ? 'assistant' : 'user',
    content: extractTextFromUnknown(message.message).trim(),
    timestamp: index,
    sessionId: message.session_id,
  }))
}

function extractQuestionOptionsFromSchema(schema: Record<string, unknown> | undefined) {
  const properties =
    schema && typeof schema === 'object' && !Array.isArray(schema)
      ? ((schema.properties as Record<string, unknown> | undefined) ?? {})
      : {}
  for (const value of Object.values(properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue
    }
    const record = value as Record<string, unknown>
    const enumValues = Array.isArray(record.enum)
      ? record.enum.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
        )
      : []
    if (enumValues.length > 0) {
      return enumValues.map(entry => ({ label: entry, value: entry }))
    }
    const oneOf = Array.isArray(record.oneOf) ? record.oneOf : []
    const options = oneOf
      .map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null
        }
        const option = entry as Record<string, unknown>
        const value =
          typeof option.const === 'string'
            ? option.const
            : typeof option.value === 'string'
              ? option.value
              : undefined
        const label = typeof option.title === 'string' ? option.title : value
        return label && value ? { label, value } : null
      })
      .filter((entry): entry is { label: string; value: string } => entry !== null)
    if (options.length > 0) {
      return options
    }
  }
  return undefined
}

function isClaudeInterruptedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('all fibers interrupted without error') ||
    normalized.includes('request was aborted') ||
    normalized.includes('interrupted by user') ||
    normalized.includes('interrupt') ||
    normalized.includes('aborted')
  )
}

async function runClaudeCommand(args: string[]) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const result = await execFileAsync('claude', args, {
    timeout: 15_000,
    env: { ...process.env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export class ClaudeChatService extends EventEmitter {
  private providerSessionDirectory: ProviderSessionDirectory | null

  private readonly sessions = new Map<string, ClaudeSessionRuntime>()

  private readonly pendingApprovals = new Map<string, PendingApproval>()

  private readonly pendingUserInputs = new Map<string, PendingUserInput>()

  private cachedHealth: CachedClaudeHealth | null = null

  private inflightHealth: Promise<ClaudeChatHealthStatus> | null = null

  constructor(providerSessionDirectory: ProviderSessionDirectory | null = null) {
    super()
    this.providerSessionDirectory = providerSessionDirectory
  }

  setProviderSessionDirectory(providerSessionDirectory: ProviderSessionDirectory | null) {
    this.providerSessionDirectory = providerSessionDirectory
  }

  getState(sessionKey: string): ClaudeChatState {
    return (
      this.sessions.get(sessionKey)?.state ?? {
        sessionKey,
        status: 'disconnected',
      }
    )
  }

  async health(): Promise<ClaudeChatHealthStatus> {
    const now = Date.now()
    if (this.cachedHealth && now - this.cachedHealth.cachedAt < CLAUDE_HEALTH_CACHE_TTL_MS) {
      return this.cachedHealth.value
    }
    if (this.inflightHealth) {
      return this.inflightHealth
    }
    this.inflightHealth = this.fetchHealth().finally(() => {
      this.inflightHealth = null
    })
    const value = await this.inflightHealth
    this.cachedHealth = { value, cachedAt: now }
    return value
  }

  async listModels(): Promise<ClaudeChatModelEntry[]> {
    return CLAUDE_MODELS
  }

  async startTurn(
    sessionKey: string,
    directory: string,
    prompt: string,
    options?: ClaudeChatTurnOptions
  ) {
    const runtime = this.getOrCreateSession(sessionKey, directory)
    this.hydrateClaudeBinding(runtime)
    if (runtime.activeQuery) {
      throw new Error('Claude chat session already has an active turn.')
    }
    runtime.toolNamesById.clear()

    const turnId = randomUUID()
    runtime.state = {
      ...runtime.state,
      status: 'connecting',
      activeTurnId: turnId,
      lastError: undefined,
    }
    this.emitState(runtime.state)
    this.emitNotification({
      sessionKey,
      method: 'turn/started',
      params: { turnId, prompt, model: options?.model, timestamp: Date.now() },
    })
    this.emitNotification({
      sessionKey,
      method: 'thinking/started',
      params: { turnId, timestamp: Date.now() },
    })

    const permissionMode = mapPermissionMode(options?.permissionMode)
    const effectiveEffort = this.resolveClaudeEffort(options?.model, options?.effort)
    const onElicitation = this.buildElicitationHandler(sessionKey, turnId)

    const resumeSessionId = runtime.state.providerThreadId?.trim() || undefined
    if (resumeSessionId && runtime.state.providerThreadId !== resumeSessionId) {
      runtime.state = {
        ...runtime.state,
        providerThreadId: resumeSessionId,
      }
      this.emitState(runtime.state)
    }
    const providerSessionId = resumeSessionId ?? randomUUID()
    this.upsertProviderBinding(runtime, {
      status: 'starting',
      ...(resumeSessionId ? { resumeCursor: { resume: resumeSessionId } } : {}),
      runtimePayload: {
        directory,
        ...(options?.model ? { model: options.model } : {}),
      },
    })

    const shouldInterceptToolPermissions = permissionMode === 'default'
    const canUseTool = shouldInterceptToolPermissions
      ? this.buildCanUseToolHandler(sessionKey, turnId)
      : undefined
    const queryOptions = this.buildStartTurnQueryOptions({
      directory,
      options,
      effectiveEffort,
      permissionMode,
      resumeSessionId,
      providerSessionId,
      onElicitation,
      canUseTool,
    })

    const activeQuery = query({
      prompt: options?.attachments?.length
        ? buildClaudePromptStream(providerSessionId, prompt, options.attachments)
        : prompt,
      options: queryOptions,
    })
    runtime.activeQuery = activeQuery

    try {
      for await (const message of activeQuery) {
        this.handleMessage(runtime, turnId, message)
      }
      runtime.activeQuery = null
      this.finalizeTurnSuccess(runtime, turnId)
    } catch (error) {
      runtime.activeQuery = null
      this.finalizeTurnError(runtime, turnId, error)
    }
  }

  async interruptTurn(sessionKey: string) {
    const runtime = this.sessions.get(sessionKey)
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionKey !== sessionKey) {
        continue
      }
      this.pendingApprovals.delete(requestId)
      pending.resolve({
        behavior: 'deny',
        toolUseID: pending.itemId,
        message: 'User cancelled tool execution.',
        interrupt: true,
      })
    }
    for (const [requestId, pending] of this.pendingUserInputs.entries()) {
      if (pending.sessionKey !== sessionKey) {
        continue
      }
      this.pendingUserInputs.delete(requestId)
      pending.resolve({ action: 'cancel' })
    }
    if (runtime?.activeQuery) {
      await runtime.activeQuery.interrupt()
    }
  }

  async approve(requestId: string, decision: ClaudeChatApprovalDecision) {
    const pending = this.pendingApprovals.get(requestId)
    if (!pending) {
      return
    }
    this.pendingApprovals.delete(requestId)
    if (decision === 'accept' || decision === 'acceptForSession') {
      pending.resolve({
        behavior: 'allow',
        toolUseID: pending.itemId,
      })
      return
    }
    pending.resolve({
      behavior: 'deny',
      toolUseID: pending.itemId,
      message:
        decision === 'cancel' ? 'User cancelled tool execution.' : 'User declined tool execution.',
      interrupt: decision === 'cancel',
    })
  }

  async respondToUserInput(requestId: string, response: string) {
    const pending = this.pendingUserInputs.get(requestId)
    if (!pending) {
      return
    }
    this.pendingUserInputs.delete(requestId)
    if (response.trim().length === 0) {
      pending.resolve({ action: 'cancel' })
      return
    }
    const schema = pending.request.requestedSchema
    const firstField =
      schema && typeof schema === 'object' && !Array.isArray(schema)
        ? Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {})[0]
        : undefined
    let content: Record<string, unknown> | undefined
    try {
      const parsed = JSON.parse(response) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        content = parsed as Record<string, unknown>
      }
    } catch {
      content = firstField ? { [firstField]: response } : { value: response }
    }
    pending.resolve({
      action: 'accept',
      ...(content ? { content } : {}),
    })
  }

  async getSessionMessages(
    sessionId: string,
    directory?: string
  ): Promise<ClaudeChatHistoryMessage[]> {
    const messages = await getSessionMessages(sessionId, directory ? { dir: directory } : undefined)
    return buildHistoryMessages(messages)
  }

  async renameProviderSession(sessionId: string, title: string, directory?: string) {
    await renameSession(sessionId, title, directory ? { dir: directory } : undefined)
  }

  async archiveSession(sessionKey: string) {
    const runtime = this.sessions.get(sessionKey)
    if (runtime?.activeQuery) {
      await runtime.activeQuery.interrupt()
    }
    this.sessions.delete(sessionKey)
    this.providerSessionDirectory?.remove(sessionKey, 'claude-chat')
    this.emitState({
      sessionKey,
      status: 'disconnected',
    })
  }

  async archiveProviderSession(sessionId: string, directory?: string) {
    await tagSession(sessionId, 'archived', directory ? { dir: directory } : undefined)
    for (const binding of this.providerSessionDirectory?.list('claude-chat') ?? []) {
      if (this.readClaudeResumeCursor(binding.resumeCursor) === sessionId) {
        this.providerSessionDirectory?.remove(binding.sessionKey, 'claude-chat')
      }
    }
  }

  private getOrCreateSession(sessionKey: string, directory: string): ClaudeSessionRuntime {
    const existing = this.sessions.get(sessionKey)
    if (existing) {
      existing.directory = directory
      return existing
    }
    const runtime: ClaudeSessionRuntime = {
      directory,
      activeQuery: null,
      runningTasks: [],
      toolNamesById: new Map(),
      state: {
        sessionKey,
        status: 'disconnected',
      },
    }
    this.sessions.set(sessionKey, runtime)
    return runtime
  }

  private emitState(payload: ClaudeChatState) {
    this.emit('state', payload)
  }

  private emitNotification(payload: ClaudeChatNotification) {
    this.emit('notification', payload)
  }

  private hydrateClaudeBinding(runtime: ClaudeSessionRuntime) {
    if (runtime.state.providerThreadId?.trim()) {
      return
    }
    const binding =
      this.providerSessionDirectory?.getBinding(runtime.state.sessionKey, 'claude-chat') ??
      this.importLegacyClaudeBinding(runtime.state.sessionKey, runtime.directory)
    const resumeSessionId = this.readClaudeResumeCursor(binding?.resumeCursor)
    if (!resumeSessionId) {
      return
    }
    runtime.state = {
      ...runtime.state,
      providerThreadId: resumeSessionId,
      lastError: undefined,
    }
  }

  private importLegacyClaudeBinding(sessionKey: string, directory: string) {
    const persistenceKey = `orxa:claudeChatSession:v1:${sessionKey}`
    const raw = this.providerSessionDirectory?.getLegacyRendererValue(persistenceKey)
    if (!raw) {
      return null
    }
    try {
      const parsed = JSON.parse(raw) as { providerThreadId?: unknown }
      const providerThreadId =
        typeof parsed.providerThreadId === 'string' ? parsed.providerThreadId.trim() : ''
      if (!providerThreadId) {
        return null
      }
      const binding =
        this.providerSessionDirectory?.upsert({
          provider: 'claude-chat',
          sessionKey,
          status: 'running',
          resumeCursor: { resume: providerThreadId },
          runtimePayload: { directory },
        }) ?? null
      this.providerSessionDirectory?.setLegacyRendererValue(
        persistenceKey,
        JSON.stringify({ ...parsed, providerThreadId: null })
      )
      return binding
    } catch {
      return null
    }
  }

  private readClaudeResumeCursor(resumeCursor: unknown) {
    if (!resumeCursor || typeof resumeCursor !== 'object' || Array.isArray(resumeCursor)) {
      return undefined
    }
    const normalized =
      typeof (resumeCursor as { resume?: unknown }).resume === 'string'
        ? (resumeCursor as { resume: string }).resume.trim()
        : ''
    return normalized || undefined
  }

  private upsertProviderBinding(
    runtime: ClaudeSessionRuntime,
    input: {
      status?: 'starting' | 'running' | 'stopped' | 'error'
      resumeCursor?: unknown | null
      runtimePayload?: Record<string, unknown> | null
    }
  ) {
    this.providerSessionDirectory?.upsert({
      provider: 'claude-chat',
      sessionKey: runtime.state.sessionKey,
      status: input.status,
      resumeCursor: input.resumeCursor,
      runtimePayload: input.runtimePayload ?? { directory: runtime.directory },
    })
  }

  private async fetchHealth(): Promise<ClaudeChatHealthStatus> {
    try {
      const version = await runClaudeCommand(['--version'])
      const versionLine = `${version.stdout}\n${version.stderr}`.trim().split(/\r?\n/)[0]?.trim()
      try {
        const auth = await runClaudeCommand(['auth', 'status'])
        const combined = `${auth.stdout}\n${auth.stderr}`.trim()
        const parsed =
          combined.startsWith('{') || combined.startsWith('[')
            ? (JSON.parse(combined) as Record<string, unknown>)
            : null
        const normalized = combined.toLowerCase()
        const authenticated =
          parsed && typeof parsed.loggedIn === 'boolean'
            ? parsed.loggedIn
            : normalized.includes('not authenticated') ||
                normalized.includes('not logged in') ||
                normalized.includes('login required')
              ? false
              : normalized.includes('authenticated') || normalized.includes('logged in')
                ? true
                : null
        return {
          available: true,
          authenticated,
          version: versionLine,
          message: authenticated === null ? combined || undefined : undefined,
        }
      } catch (error) {
        return {
          available: true,
          authenticated: null,
          version: versionLine,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    } catch (error) {
      return {
        available: false,
        authenticated: null,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private resolveClaudeEffort(
    model: string | undefined,
    requestedEffort: string | undefined
  ): 'low' | 'medium' | 'high' | 'max' | undefined {
    if (!requestedEffort || requestedEffort === 'ultrathink') {
      return undefined
    }
    const supportedEfforts = supportsClaudeMaxEffort(model)
      ? ['low', 'medium', 'high', 'max', 'ultrathink']
      : supportsClaudeAdaptiveReasoning(model)
        ? ['low', 'medium', 'high', 'ultrathink']
        : []
    return supportedEfforts.includes(requestedEffort)
      ? (requestedEffort as 'low' | 'medium' | 'high' | 'max')
      : undefined
  }

  private buildElicitationHandler(
    sessionKey: string,
    turnId: string
  ): (request: ElicitationRequest) => Promise<{
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
  }> {
    return async (request: ElicitationRequest) => {
      const requestId = randomUUID()
      return await new Promise<{
        action: 'accept' | 'decline' | 'cancel'
        content?: Record<string, unknown>
      }>(resolve => {
        this.pendingUserInputs.set(requestId, { sessionKey, turnId, request, resolve })
        const payload: ClaudeChatUserInputRequest = {
          id: requestId,
          sessionKey,
          threadId: sessionKey,
          turnId,
          message: request.message,
          mode: request.mode,
          server: request.serverName,
          elicitationId: request.elicitationId,
          options: extractQuestionOptionsFromSchema(request.requestedSchema),
        }
        this.emit('userInput', payload)
      })
    }
  }

  private buildCanUseToolHandler(
    sessionKey: string,
    turnId: string
  ): NonNullable<ClaudeQueryOptions['canUseTool']> {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      callbackOptions: Parameters<NonNullable<ClaudeQueryOptions['canUseTool']>>[2]
    ) => {
      const requestId = randomUUID()
      return await new Promise<PermissionResult>(resolve => {
        this.pendingApprovals.set(requestId, {
          sessionKey,
          turnId,
          itemId: callbackOptions.toolUseID,
          toolName,
          resolve,
        })
        const rawCommand = toolInput.command ?? toolInput.cmd
        const command =
          typeof rawCommand === 'string'
            ? rawCommand
            : Array.isArray(rawCommand)
              ? rawCommand.map(entry => String(entry)).join(' ')
              : undefined
        const payload: ClaudeChatApprovalRequest = {
          id: requestId,
          sessionKey,
          threadId: sessionKey,
          turnId,
          itemId: callbackOptions.toolUseID,
          toolName,
          reason: command ? `${toolName}: ${command}` : toolName,
          command,
          availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        }
        this.emit('approval', payload)
      })
    }
  }

  private buildStartTurnQueryOptions(params: {
    directory: string
    options: ClaudeChatTurnOptions | undefined
    effectiveEffort: 'low' | 'medium' | 'high' | 'max' | undefined
    permissionMode: PermissionMode | undefined
    resumeSessionId: string | undefined
    providerSessionId: string
    onElicitation: (request: ElicitationRequest) => Promise<{
      action: 'accept' | 'decline' | 'cancel'
      content?: Record<string, unknown>
    }>
    canUseTool: ClaudeQueryOptions['canUseTool']
  }): ClaudeQueryOptions {
    const {
      directory,
      options,
      effectiveEffort,
      permissionMode,
      resumeSessionId,
      providerSessionId,
      onElicitation,
      canUseTool,
    } = params
    return {
      cwd: directory,
      model: options?.model,
      pathToClaudeCodeExecutable: 'claude',
      includePartialMessages: true,
      env: process.env,
      additionalDirectories: [directory],
      settingSources: [...CLAUDE_SETTING_SOURCES],
      ...(effectiveEffort ? { effort: effectiveEffort } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(permissionMode === 'bypassPermissions'
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(typeof options?.maxThinkingTokens === 'number'
        ? { maxThinkingTokens: options.maxThinkingTokens }
        : {}),
      ...(typeof options?.thinking === 'boolean' || options?.fastMode
        ? {
            settings: {
              ...(typeof options?.thinking === 'boolean'
                ? { alwaysThinkingEnabled: options.thinking }
                : {}),
              ...(options?.fastMode && supportsClaudeFastMode(options?.model)
                ? { fastMode: true }
                : {}),
            },
          }
        : {}),
      ...(resumeSessionId
        ? { resume: resumeSessionId }
        : { sessionId: providerSessionId }),
      ...(canUseTool ? { canUseTool } : {}),
      onElicitation,
    }
  }

  private finalizeTurnSuccess(runtime: ClaudeSessionRuntime, turnId: string) {
    const sessionKey = runtime.state.sessionKey
    runtime.state = {
      ...runtime.state,
      status: 'connected',
      activeTurnId: null,
    }
    this.upsertProviderBinding(runtime, {
      status: 'running',
    })
    this.emitState(runtime.state)
    this.emitNotification({
      sessionKey,
      method: 'thinking/stopped',
      params: { turnId, timestamp: Date.now() },
    })
    this.emitNotification({
      sessionKey,
      method: 'turn/completed',
      params: { turnId, timestamp: Date.now() },
    })
  }

  private finalizeTurnError(runtime: ClaudeSessionRuntime, turnId: string, error: unknown) {
    const sessionKey = runtime.state.sessionKey
    const interrupted = isClaudeInterruptedError(error)
    if (interrupted) {
      runtime.state = {
        ...runtime.state,
        status: 'connected',
        activeTurnId: null,
        lastError: undefined,
      }
      this.upsertProviderBinding(runtime, {
        status: 'running',
      })
      this.emitState(runtime.state)
      this.emitNotification({
        sessionKey,
        method: 'thinking/stopped',
        params: { turnId, timestamp: Date.now() },
      })
      this.emitNotification({
        sessionKey,
        method: 'turn/completed',
        params: { turnId, interrupted: true, timestamp: Date.now() },
      })
      return
    }
    runtime.state = {
      ...runtime.state,
      status: 'error',
      activeTurnId: null,
      lastError: error instanceof Error ? error.message : String(error),
    }
    this.upsertProviderBinding(runtime, {
      status: 'error',
    })
    this.emitState(runtime.state)
    this.emitNotification({
      sessionKey,
      method: 'thinking/stopped',
      params: { turnId, timestamp: Date.now() },
    })
    this.emitNotification({
      sessionKey,
      method: 'turn/error',
      params: {
        turnId,
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      },
    })
    throw error
  }

  private updateTask(
    runtime: ClaudeSessionRuntime,
    taskId: string,
    updater: (task: ClaudeSubagentRuntime) => ClaudeSubagentRuntime
  ) {
    const index = runtime.runningTasks.findIndex(task => task.id === taskId)
    if (index < 0) {
      return
    }
    runtime.runningTasks[index] = updater(runtime.runningTasks[index]!)
  }

  private bindNextUnassignedTask(runtime: ClaudeSessionRuntime, providerThreadId: string) {
    const candidate = [...runtime.runningTasks]
      .reverse()
      .find(task => task.status === 'thinking' && !task.childSessionId)
    if (!candidate) {
      return null
    }
    candidate.childSessionId = providerThreadId
    return candidate.id
  }

  private handleMessage(runtime: ClaudeSessionRuntime, turnId: string, message: SDKMessage) {
    const sessionKey = runtime.state.sessionKey
    const sessionId = typeof message.session_id === 'string' ? message.session_id : undefined
    if (sessionId) {
      this.trackProviderSession(runtime, sessionKey, sessionId)
    }

    if (message.type === 'assistant') {
      this.handleAssistantContent(sessionKey, turnId, message)
      return
    }
    if (message.type === 'stream_event') {
      this.handleStreamContent(sessionKey, turnId, message)
      return
    }
    if (message.type === 'tool_progress') {
      this.handleToolProgressMsg(runtime, sessionKey, turnId, message)
      return
    }
    if (message.type === 'tool_use_summary') {
      this.handleToolUseSummaryMsg(runtime, sessionKey, turnId, message)
      return
    }
    if (message.type === 'system') {
      this.handleSystemMsg(runtime, sessionKey, turnId, message)
      return
    }
    if (message.type === 'result') {
      this.handleResultMsg(sessionKey, turnId, message)
    }
  }

  private trackProviderSession(
    runtime: ClaudeSessionRuntime,
    sessionKey: string,
    sessionId: string
  ) {
    if (!runtime.mainProviderThreadId) {
      runtime.mainProviderThreadId = sessionId
      runtime.state = {
        ...runtime.state,
        status: 'connected',
        providerThreadId: sessionId,
      }
      this.upsertProviderBinding(runtime, {
        status: 'running',
        resumeCursor: { resume: sessionId },
        runtimePayload: { directory: runtime.directory },
      })
      this.emitState(runtime.state)
      this.emitNotification({
        sessionKey,
        method: 'thread/started',
        params: {
          providerThreadId: sessionId,
          isSubagent: false,
          timestamp: Date.now(),
        },
      })
    } else if (sessionId !== runtime.mainProviderThreadId) {
      const taskId = this.bindNextUnassignedTask(runtime, sessionId)
      this.emitNotification({
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

  private handleAssistantContent(
    sessionKey: string,
    turnId: string,
    message: SDKAssistantMessage
  ) {
    const content = extractAssistantText(message)
    if (content) {
      this.emitNotification({
        sessionKey,
        method: 'assistant/message',
        params: {
          id: message.uuid,
          turnId,
          content,
          timestamp: Date.now(),
        },
      })
    }
  }

  private handleStreamContent(sessionKey: string, turnId: string, message: SDKMessage) {
    const content = extractPartialAssistantText(message)
    if (content) {
      this.emitNotification({
        sessionKey,
        method: 'assistant/partial',
        params: {
          id: message.uuid,
          turnId,
          content,
          timestamp: Date.now(),
        },
      })
    }
  }

  private handleToolProgressMsg(
    runtime: ClaudeSessionRuntime,
    sessionKey: string,
    turnId: string,
    message: SDKToolProgressMessage
  ) {
    runtime.toolNamesById.set(message.tool_use_id, message.tool_name)
    this.emitNotification({
      sessionKey,
      method: 'tool/progress',
      params: {
        id: message.tool_use_id,
        turnId,
        toolName: message.tool_name,
        parentToolUseId: message.parent_tool_use_id,
        taskId: message.task_id,
        elapsedTimeSeconds: message.elapsed_time_seconds,
        timestamp: Date.now(),
      },
    })
  }

  private handleToolUseSummaryMsg(
    runtime: ClaudeSessionRuntime,
    sessionKey: string,
    turnId: string,
    message: SDKToolUseSummaryMessage
  ) {
    const toolUseId = message.preceding_tool_use_ids[0]
    const toolName = toolUseId ? runtime.toolNamesById.get(toolUseId) : undefined
    this.emitNotification({
      sessionKey,
      method: 'tool/completed',
      params: {
        id: toolUseId ?? message.uuid,
        turnId,
        toolUseId,
        toolName,
        summary: message.summary,
        precedingToolUseIds: message.preceding_tool_use_ids,
        timestamp: Date.now(),
      },
    })
  }

  private handleSystemMsg(
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
      this.emitNotification({
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
      this.updateTask(runtime, message.task_id, task => ({
        ...task,
        status: 'thinking',
        statusText: message.summary?.trim() || message.description.trim() || 'is running',
        summary: message.summary,
      }))
      this.emitNotification({
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
      this.handleTaskNotification(runtime, sessionKey, turnId, message)
      return
    }
    if (message.subtype === 'api_retry') {
      this.emitNotification({
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

  private handleTaskNotification(
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
    const statusText =
      message.status === 'completed'
        ? 'completed'
        : message.status === 'stopped'
          ? 'stopped'
          : 'failed'
    this.updateTask(runtime, message.task_id, task => ({
      ...task,
      status,
      statusText,
      summary: message.summary,
    }))
    this.emitNotification({
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

  private handleResultMsg(sessionKey: string, turnId: string, message: SDKResultMessage) {
    this.emitNotification({
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
}
