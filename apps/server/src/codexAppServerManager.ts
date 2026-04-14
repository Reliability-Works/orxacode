import { EventEmitter } from 'node:events'
import { Effect, ServiceMap } from 'effect'
import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderInteractionMode,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { readCodexAccountSnapshot } from './provider/codexAccount'
import { buildCodexInitializeParams } from './provider/codexAppServer'
import {
  assertSupportedCodexCliVersion,
  killChildTree,
  readResumeThreadId,
  readRouteFields,
  toCodexUserInputAnswers,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from './codexAppServerManager.protocol'
import { applySessionNotificationStateExternal } from './codexAppServerManager.notifications'
import { finalizeStartedSession, openThreadForSession } from './codexAppServerManager.lifecycle'
import {
  handleResponse,
  handleServerRequest,
  sendRequest,
  writeMessage,
} from './codexAppServerManager.transport'
import {
  buildApprovalDecisionEvent,
  buildErrorEvent,
  buildLifecycleEvent,
  buildNotificationEvent,
  buildProviderNotificationEvent,
  buildStartFailedErrorEvent,
  buildUserInputAnsweredEvent,
  createSessionContext,
  readChildParentTurnId,
  rememberCollabReceiverTurns,
  type CodexSessionContextLike,
} from './codexAppServerManager.events'
import { attachProcessListeners } from './codexAppServerManager.process'
import {
  buildTurnStartParams,
  buildTurnSteerParams,
  isSteerMethodNotFoundError,
  parseThreadSnapshot,
  readStartedTurnId,
  type CodexThreadSnapshot,
} from './codexAppServerManager.turn'

export type { CodexThreadSnapshot, CodexThreadTurnSnapshot } from './codexAppServerManager.turn'
export {
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from './codexAppServerManager.developerInstructions'
export {
  classifyCodexStderrLine,
  isRecoverableThreadResumeError,
  normalizeCodexModelSlug,
} from './codexAppServerManager.protocol'
export { buildCodexInitializeParams } from './provider/codexAppServer'
export { readCodexAccountSnapshot, resolveCodexModelForAccount } from './provider/codexAccount'

type CodexSessionContext = CodexSessionContextLike

export interface CodexAppServerSendTurnInput {
  readonly threadId: ThreadId
  readonly input?: string
  readonly attachments?: ReadonlyArray<{ type: 'image'; url: string }>
  readonly model?: string
  readonly serviceTier?: string | null
  readonly effort?: string
  readonly interactionMode?: ProviderInteractionMode
}

export interface CodexAppServerStartSessionInput {
  readonly threadId: ThreadId
  readonly provider?: 'codex'
  readonly cwd?: string
  readonly model?: string
  readonly serviceTier?: string
  readonly resumeCursor?: unknown
  readonly binaryPath: string
  readonly homePath?: string
  readonly runtimeMode: RuntimeMode
}

export interface CodexAppServerManagerEvents {
  event: [event: ProviderEvent]
}

export class CodexAppServerManager extends EventEmitter<CodexAppServerManagerEvents> {
  private readonly sessions = new Map<ThreadId, CodexSessionContext>()

  private runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>
  constructor(services?: ServiceMap.ServiceMap<never>) {
    super()
    this.runPromise = services ? Effect.runPromiseWith(services) : Effect.runPromise
  }

  async startSession(input: CodexAppServerStartSessionInput): Promise<ProviderSession> {
    const threadId = input.threadId
    const now = new Date().toISOString()
    let context: CodexSessionContext | undefined

    try {
      const resolvedCwd = input.cwd ?? process.cwd()
      this.assertSupportedCodexCliVersion({
        binaryPath: input.binaryPath,
        cwd: resolvedCwd,
        ...(input.homePath ? { homePath: input.homePath } : {}),
      })
      context = this.createSessionContext(input, now, resolvedCwd)
      this.sessions.set(threadId, context)
      this.attachProcessListeners(context)
      this.emitLifecycleEvent(context, 'session/connecting', 'Starting codex app-server')

      await this.initializeSessionContext(context)

      const threadOpen = await this.openThreadForSession(context, input, resolvedCwd)
      this.finalizeStartedSession(context, input, threadOpen.providerThreadId, threadOpen.method)
      return { ...context.session }
    } catch (error) {
      throw this.handleSessionStartError(threadId, context, error)
    }
  }

  async sendTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    const context = this.requireSession(input.threadId)
    const activeTurnId = context.session.activeTurnId
    if (activeTurnId && context.session.status === 'running') {
      const steered = await this.trySteerActiveTurn(context, activeTurnId, input)
      if (steered) {
        return steered
      }
    }
    context.collabReceiverTurns.clear()
    const turnStartParams = buildTurnStartParams(context.session, context.account, input)
    const response = await this.sendRequest(context, 'turn/start', turnStartParams)
    const turnId = readStartedTurnId(response)
    this.markTurnRunning(context, turnId)
    return this.buildTurnStartResult(context, turnId)
  }

  private async trySteerActiveTurn(
    context: CodexSessionContext,
    activeTurnId: TurnId,
    input: CodexAppServerSendTurnInput
  ): Promise<ProviderTurnStartResult | null> {
    try {
      const steerParams = buildTurnSteerParams(context.session, activeTurnId, input)
      await this.sendRequest(context, 'turn/steer', steerParams)
      return this.buildTurnStartResult(context, activeTurnId)
    } catch (error) {
      if (isSteerMethodNotFoundError(error)) {
        return null
      }
      throw error
    }
  }

  async interruptTurn(
    threadId: ThreadId,
    turnId?: TurnId,
    providerThreadIdOverride?: string
  ): Promise<void> {
    const context = this.requireSession(threadId)
    const effectiveTurnId = turnId ?? context.session.activeTurnId
    const providerThreadId = providerThreadIdOverride ?? readResumeCursor(context.session)
    if (!effectiveTurnId || !providerThreadId) {
      return
    }
    await this.sendRequest(context, 'turn/interrupt', {
      threadId: providerThreadId,
      turnId: effectiveTurnId,
    })
  }

  async readThread(threadId: ThreadId): Promise<CodexThreadSnapshot> {
    const context = this.requireSession(threadId)
    const providerThreadId = requireProviderThreadIdOrThrow(context.session)
    const response = await this.sendRequest(context, 'thread/read', {
      threadId: providerThreadId,
      includeTurns: true,
    })
    return parseThreadSnapshot('thread/read', response)
  }

  async rollbackThread(threadId: ThreadId, numTurns: number): Promise<CodexThreadSnapshot> {
    const context = this.requireSession(threadId)
    const providerThreadId = requireProviderThreadIdOrThrow(context.session)
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      throw new Error('numTurns must be an integer >= 1.')
    }
    const response = await this.sendRequest(context, 'thread/rollback', {
      threadId: providerThreadId,
      numTurns,
    })
    this.updateSession(context, { status: 'ready', activeTurnId: undefined })
    return parseThreadSnapshot('thread/rollback', response)
  }

  async respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision
  ): Promise<void> {
    const context = this.requireSession(threadId)
    const pendingRequest = context.pendingApprovals.get(requestId)
    if (!pendingRequest) {
      throw new Error(`Unknown pending approval request: ${requestId}`)
    }

    context.pendingApprovals.delete(requestId)
    this.writeMessage(context, { id: pendingRequest.jsonRpcId, result: { decision } })
    this.emitEvent(buildApprovalDecisionEvent(context, pendingRequest, decision))
  }

  async respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers
  ): Promise<void> {
    const context = this.requireSession(threadId)
    const pendingRequest = context.pendingUserInputs.get(requestId)
    if (!pendingRequest) {
      throw new Error(`Unknown pending user input request: ${requestId}`)
    }

    context.pendingUserInputs.delete(requestId)
    const codexAnswers = toCodexUserInputAnswers(answers)
    this.writeMessage(context, {
      id: pendingRequest.jsonRpcId,
      result: { answers: codexAnswers },
    })
    this.emitEvent(buildUserInputAnsweredEvent(context, pendingRequest, codexAnswers))
  }

  stopSession(threadId: ThreadId): void {
    const context = this.sessions.get(threadId)
    if (!context) {
      return
    }

    context.stopping = true

    for (const pending of context.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Session stopped before request completed.'))
    }
    context.pending.clear()
    context.pendingApprovals.clear()
    context.pendingUserInputs.clear()

    context.output.close()

    if (!context.child.killed) {
      killChildTree(context.child)
    }

    this.updateSession(context, {
      status: 'closed',
      activeTurnId: undefined,
    })
    this.emitLifecycleEvent(context, 'session/closed', 'Session stopped')
    this.sessions.delete(threadId)
  }

  listSessions(): ProviderSession[] {
    return Array.from(this.sessions.values(), ({ session }) => ({
      ...session,
    }))
  }

  hasSession(threadId: ThreadId): boolean {
    return this.sessions.has(threadId)
  }

  stopAll(): void {
    for (const threadId of this.sessions.keys()) {
      this.stopSession(threadId)
    }
  }

  private requireSession(threadId: ThreadId): CodexSessionContext {
    const context = this.sessions.get(threadId)
    if (!context) {
      throw new Error(`Unknown session for thread: ${threadId}`)
    }

    if (context.session.status === 'closed') {
      throw new Error(`Session is closed for thread: ${threadId}`)
    }

    return context
  }

  private attachProcessListeners(context: CodexSessionContext): void {
    attachProcessListeners(context, {
      emitErrorEvent: (m, msg) => this.emitErrorEvent(context, m, msg),
      emitNotificationEvent: (m, msg) => this.emitNotificationEvent(context, m, msg),
      emitLifecycleEvent: (m, msg) => this.emitLifecycleEvent(context, m, msg),
      updateSession: updates => this.updateSession(context, updates),
      removeSession: () => void this.sessions.delete(context.session.threadId),
      handleServerRequest: request => this.handleServerRequest(context, request),
      handleServerNotification: notification =>
        this.handleServerNotification(context, notification),
      handleResponse: response => handleResponse(context, response),
    })
  }

  private handleServerNotification(
    context: CodexSessionContext,
    notification: JsonRpcNotification
  ): void {
    const rawRoute = readRouteFields(notification.params)
    rememberCollabReceiverTurns(context, notification.params, rawRoute.turnId)
    const childRoute = readChildParentTurnId(context, notification.params)
    const isChildConversation = childRoute !== undefined
    this.emitEvent(buildProviderNotificationEvent(context, notification, rawRoute, childRoute))
    applySessionNotificationStateExternal(
      context,
      notification,
      rawRoute.turnId,
      isChildConversation,
      updates => this.updateSession(context, updates)
    )
  }

  private createSessionContext(
    input: CodexAppServerStartSessionInput,
    now: string,
    resolvedCwd: string
  ): CodexSessionContext {
    return createSessionContext(input, now, resolvedCwd) as CodexSessionContext
  }

  private assertSupportedCodexCliVersion(input: {
    readonly binaryPath: string
    readonly cwd: string
    readonly homePath?: string
  }): void {
    assertSupportedCodexCliVersion(input)
  }

  private async initializeSessionContext(context: CodexSessionContext): Promise<void> {
    await this.sendRequest(context, 'initialize', buildCodexInitializeParams())
    this.writeMessage(context, { method: 'initialized' })
    try {
      console.log('codex model/list response', await this.sendRequest(context, 'model/list', {}))
    } catch (error) {
      console.log('codex model/list failed', error)
    }
    try {
      const response = await this.sendRequest(context, 'account/read', {})
      console.log('codex account/read response', response)
      context.account = readCodexAccountSnapshot(response)
      console.log('codex subscription status', {
        type: context.account.type,
        planType: context.account.planType,
        sparkEnabled: context.account.sparkEnabled,
      })
    } catch (error) {
      console.log('codex account/read failed', error)
    }
  }

  private openThreadForSession(
    context: CodexSessionContext,
    input: CodexAppServerStartSessionInput,
    resolvedCwd: string
  ): Promise<{ providerThreadId: string; method: 'thread/start' | 'thread/resume' }> {
    return openThreadForSession(
      {
        account: context.account,
        emitLifecycleEvent: (m, msg) => this.emitLifecycleEvent(context, m, msg),
        emitErrorEvent: (m, msg) => this.emitErrorEvent(context, m, msg),
        sendRequest: (method, params) => this.sendRequest(context, method, params),
        runPromise: this.runPromise,
      },
      input,
      resolvedCwd
    )
  }

  private finalizeStartedSession(
    context: CodexSessionContext,
    input: CodexAppServerStartSessionInput,
    providerThreadId: string,
    threadOpenMethod: 'thread/start' | 'thread/resume'
  ): void {
    finalizeStartedSession(
      {
        updateSession: updates => this.updateSession(context, updates),
        emitLifecycleEvent: (m, msg) => this.emitLifecycleEvent(context, m, msg),
        runPromise: this.runPromise,
      },
      input,
      providerThreadId,
      threadOpenMethod
    )
  }

  private handleSessionStartError(
    threadId: ThreadId,
    context: CodexSessionContext | undefined,
    error: unknown
  ): Error {
    const message = error instanceof Error ? error.message : 'Failed to start Codex session.'
    if (context) {
      this.updateSession(context, { status: 'error', lastError: message })
      this.emitErrorEvent(context, 'session/startFailed', message)
      this.stopSession(threadId)
    } else {
      this.emitEvent(buildStartFailedErrorEvent(threadId, message))
    }
    return new Error(message, { cause: error })
  }

  private markTurnRunning(context: CodexSessionContext, turnId: TurnId): void {
    const cursor = context.session.resumeCursor
    this.updateSession(context, {
      status: 'running',
      activeTurnId: turnId,
      ...(cursor !== undefined ? { resumeCursor: cursor } : {}),
    })
  }

  private buildTurnStartResult(
    context: CodexSessionContext,
    turnId: TurnId
  ): ProviderTurnStartResult {
    const cursor = context.session.resumeCursor
    return {
      threadId: context.session.threadId,
      turnId,
      ...(cursor !== undefined ? { resumeCursor: cursor } : {}),
    }
  }

  private handleServerRequest(context: CodexSessionContext, request: JsonRpcRequest): void {
    const childRoute = readChildParentTurnId(context, request.params)
    handleServerRequest(context, request, childRoute, event => this.emitEvent(event))
  }

  private sendRequest<T>(
    context: CodexSessionContext,
    method: string,
    params: unknown,
    timeoutMs = 20_000
  ): Promise<T> {
    return sendRequest<T>(context, method, params, timeoutMs)
  }

  private emitLifecycleEvent(context: CodexSessionContext, method: string, message: string): void {
    this.emitEvent(buildLifecycleEvent(context, method, message))
  }

  private emitErrorEvent(context: CodexSessionContext, method: string, message: string): void {
    this.emitEvent(buildErrorEvent(context, method, message))
  }

  private emitNotificationEvent(
    context: CodexSessionContext,
    method: string,
    message: string
  ): void {
    this.emitEvent(buildNotificationEvent(context, method, message))
  }

  private writeMessage(context: CodexSessionContext, message: unknown): void {
    writeMessage(context, message)
  }

  private emitEvent(event: ProviderEvent): void {
    this.emit('event', event)
  }

  private updateSession(context: CodexSessionContext, updates: Partial<ProviderSession>): void {
    context.session = { ...context.session, ...updates, updatedAt: new Date().toISOString() }
  }
}

function readResumeCursor(session: ProviderSession): string | undefined {
  return readResumeThreadId({
    threadId: session.threadId,
    runtimeMode: session.runtimeMode,
    resumeCursor: session.resumeCursor,
  })
}

function requireProviderThreadIdOrThrow(session: ProviderSession): string {
  const providerThreadId = readResumeCursor(session)
  if (!providerThreadId) {
    throw new Error('Session is missing a provider resume thread id.')
  }
  return providerThreadId
}
