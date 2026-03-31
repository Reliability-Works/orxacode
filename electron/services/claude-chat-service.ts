import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import {
  getSessionMessages,
  query,
  renameSession,
  tagSession,
  type Options as ClaudeQueryOptions,
  type ElicitationRequest,
  type PermissionMode,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeChatApprovalDecision,
  ClaudeChatApprovalRequest,
  ClaudeBrowserSessionSummary,
  ClaudeChatHealthStatus,
  ClaudeChatHistoryMessage,
  ClaudeChatModelEntry,
  ClaudeChatNotification,
  ClaudeResumeProviderSessionResult,
  ClaudeChatState,
  ClaudeChatTurnOptions,
  ClaudeChatUserInputRequest,
} from '@shared/ipc'
import { ProviderSessionDirectory } from './provider-session-directory'
import type {
  CachedClaudeHealth,
  ClaudeSessionRuntime,
  PendingApproval,
  PendingUserInput,
} from './claude-chat-service-types'
import {
  buildHistoryMessages,
  buildCanUseToolHandler,
  buildElicitationHandler,
  finalizeTurnError,
  finalizeTurnSuccess,
} from './claude-chat-service-message-handlers'
import { handleClaudeMessage } from './claude-chat-service-event-routing'
import {
  buildClaudePromptStream,
  buildStartTurnQueryOptions,
  CLAUDE_HEALTH_CACHE_TTL_MS,
  CLAUDE_MODELS,
  fetchClaudeHealth,
  mapPermissionMode,
  readClaudeResumeCursor,
  resolveClaudeEffort,
} from './claude-chat-service-runtime'
import { getClaudeInventoryRootForTests } from './claude-chat-session-inventory'
import { listClaudeSessionsWithCache, readClaudeDisconnectedState, resumeClaudeProviderSession, type ClaudeBrowserSessionCache } from './claude-chat-service-browser'
import { resolveClaudeUserInputResponse } from './claude-chat-service-input'

export class ClaudeChatService extends EventEmitter {
  private providerSessionDirectory: ProviderSessionDirectory | null
  private readonly sessions = new Map<string, ClaudeSessionRuntime>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly pendingUserInputs = new Map<string, PendingUserInput>()
  private readonly allowedProviderThreads = new Set<string>()
  private cachedHealth: CachedClaudeHealth | null = null
  private inflightHealth: Promise<ClaudeChatHealthStatus> | null = null
  private readonly claudeInventoryRoot: string
  private cachedBrowserSessions: ClaudeBrowserSessionCache | null = null

  constructor(providerSessionDirectory: ProviderSessionDirectory | null = null, claudeInventoryRoot = getClaudeInventoryRootForTests()) {
    super()
    this.providerSessionDirectory = providerSessionDirectory
    this.claudeInventoryRoot = claudeInventoryRoot
  }

  setProviderSessionDirectory(providerSessionDirectory: ProviderSessionDirectory | null) {
    this.providerSessionDirectory = providerSessionDirectory
  }

  getState(sessionKey: string): ClaudeChatState {
    const runtime = this.sessions.get(sessionKey)
    if (runtime) {
      return runtime.state
    }
    return readClaudeDisconnectedState(
      sessionKey,
      this.providerSessionDirectory,
      this.readClaudeResumeCursor.bind(this)
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
    runtime.toolInputsById.clear()

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
    runtime.approvalThreadId = providerSessionId
    this.upsertProviderBinding(runtime, {
      status: 'starting',
      ...(resumeSessionId ? { resumeCursor: { resume: resumeSessionId } } : {}),
      runtimePayload: {
        directory,
        ...(options?.model ? { model: options.model } : {}),
      },
    })

    const canUseTool = this.buildCanUseToolHandler(
      runtime,
      sessionKey,
      turnId,
      providerSessionId,
      permissionMode
    )
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
      if (decision === 'acceptForSession') {
        this.allowProviderThread(pending.providerThreadId)
      }
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
    pending.resolve(resolveClaudeUserInputResponse(response, pending.request.requestedSchema))
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
    this.cachedBrowserSessions = null
  }

  async listSessions(): Promise<ClaudeBrowserSessionSummary[]> {
    this.cachedBrowserSessions = await listClaudeSessionsWithCache({
      cachedBrowserSessions: this.cachedBrowserSessions,
      providerSessionDirectory: this.providerSessionDirectory,
      claudeInventoryRoot: this.claudeInventoryRoot,
    })
    return this.cachedBrowserSessions.value
  }

  async resumeProviderSession(
    providerThreadId: string,
    directory: string
  ): Promise<ClaudeResumeProviderSessionResult> {
    const resumed = await resumeClaudeProviderSession({
      providerThreadId,
      directory,
      sessions: await this.listSessions(),
      providerSessionDirectory: this.providerSessionDirectory,
    })
    this.cachedBrowserSessions = null
    return resumed
  }

  async archiveSession(sessionKey: string) {
    const runtime = this.sessions.get(sessionKey)
    if (runtime?.activeQuery) {
      await runtime.activeQuery.interrupt()
    }
    this.clearProviderThreadAllowances(runtime)
    this.sessions.delete(sessionKey)
    this.providerSessionDirectory?.remove(sessionKey, 'claude-chat')
    this.cachedBrowserSessions = null
    this.emitState({
      sessionKey,
      status: 'disconnected',
    })
  }

  async archiveProviderSession(sessionId: string, directory?: string) {
    this.allowedProviderThreads.delete(sessionId)
    await tagSession(sessionId, 'archived', directory ? { dir: directory } : undefined)
    for (const binding of this.providerSessionDirectory?.list('claude-chat') ?? []) {
      if (this.readClaudeResumeCursor(binding.resumeCursor) === sessionId) {
        this.providerSessionDirectory?.remove(binding.sessionKey, 'claude-chat')
      }
    }
    this.cachedBrowserSessions = null
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
      toolInputsById: new Map(),
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

  private emitApprovalRequest(payload: ClaudeChatApprovalRequest) {
    this.emit('approval', payload)
  }

  private emitUserInputRequest(payload: ClaudeChatUserInputRequest) {
    this.emit('userInput', payload)
  }

  private getHandlerContext() {
    return {
      emitState: this.emitState.bind(this),
      emitNotification: this.emitNotification.bind(this),
      emitApprovalRequest: this.emitApprovalRequest.bind(this),
      emitUserInputRequest: this.emitUserInputRequest.bind(this),
      pendingApprovals: this.pendingApprovals,
      pendingUserInputs: this.pendingUserInputs,
      isProviderThreadAllowed: this.isProviderThreadAllowed.bind(this),
      remapProviderThreadApproval: this.remapProviderThreadApproval.bind(this),
      readClaudeResumeCursor: this.readClaudeResumeCursor.bind(this),
      upsertProviderBinding: this.upsertProviderBinding.bind(this),
    }
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
    return fetchClaudeHealth()
  }

  private resolveClaudeEffort(
    model: string | undefined,
    requestedEffort: string | undefined
  ): 'low' | 'medium' | 'high' | 'max' | undefined {
    return resolveClaudeEffort(model, requestedEffort)
  }

  private readClaudeResumeCursor(resumeCursor: unknown): string | undefined {
    return readClaudeResumeCursor(resumeCursor)
  }

  private buildStartTurnQueryOptions(input: Parameters<typeof buildStartTurnQueryOptions>[0]) {
    return buildStartTurnQueryOptions(input)
  }

  private buildElicitationHandler(
    sessionKey: string,
    turnId: string
  ): (request: ElicitationRequest) => Promise<{
    action: 'accept' | 'decline' | 'cancel'
    content?: Record<string, unknown>
  }> {
    return buildElicitationHandler(this.getHandlerContext(), sessionKey, turnId)
  }

  private buildCanUseToolHandler(
    runtime: ClaudeSessionRuntime,
    sessionKey: string,
    turnId: string,
    providerThreadId: string,
    permissionMode: PermissionMode | undefined
  ): NonNullable<ClaudeQueryOptions['canUseTool']> {
    return buildCanUseToolHandler(
      this.getHandlerContext(),
      runtime,
      sessionKey,
      turnId,
      providerThreadId,
      permissionMode
    )
  }

  private finalizeTurnSuccess(runtime: ClaudeSessionRuntime, turnId: string) {
    finalizeTurnSuccess(this.getHandlerContext(), runtime, turnId)
  }

  private finalizeTurnError(runtime: ClaudeSessionRuntime, turnId: string, error: unknown) {
    finalizeTurnError(this.getHandlerContext(), runtime, turnId, error)
  }

  private allowProviderThread(providerThreadId: string | undefined) {
    const normalized = providerThreadId?.trim()
    if (!normalized) {
      return
    }
    this.allowedProviderThreads.add(normalized)
  }

  private isProviderThreadAllowed(providerThreadId: string) {
    return this.allowedProviderThreads.has(providerThreadId.trim())
  }

  private remapProviderThreadApproval(fromProviderThreadId: string, toProviderThreadId: string) {
    const from = fromProviderThreadId.trim()
    const to = toProviderThreadId.trim()
    if (!from || !to || from === to) {
      return
    }
    if (this.allowedProviderThreads.delete(from)) {
      this.allowedProviderThreads.add(to)
    }
  }

  private clearProviderThreadAllowances(runtime: ClaudeSessionRuntime | undefined) {
    if (!runtime) {
      return
    }
    const providerThreadIds = [
      runtime.approvalThreadId,
      runtime.mainProviderThreadId,
      runtime.state.providerThreadId,
    ]
    for (const providerThreadId of providerThreadIds) {
      const normalized = providerThreadId?.trim()
      if (normalized) {
        this.allowedProviderThreads.delete(normalized)
      }
    }
  }

  private handleMessage(runtime: ClaudeSessionRuntime, turnId: string, message: SDKMessage) {
    handleClaudeMessage(this.getHandlerContext(), runtime, turnId, message)
  }
}
