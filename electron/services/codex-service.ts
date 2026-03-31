import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'
import type {
  CodexApprovalRequest,
  CodexAttachment,
  CodexCollaborationMode,
  CodexModelEntry,
  CodexNotification,
  CodexRunMetadata,
  CodexState,
  CodexThread,
  CodexThreadRuntime,
} from '@shared/ipc'
import { ProviderSessionDirectory } from './provider-session-directory'
import type { PendingRequest } from './codex-service-types'
import {
  asRecord,
  asString,
  isIgnorableCodexStderr,
  parseModeListResponse,
  parseModelListResponse,
  resolveCodexBinary,
  resolveDirectThreadId,
  REQUEST_TIMEOUT_MS,
} from './codex-service-parsers'
import {
  archiveCodexThread,
  archiveCodexThreadTree,
  captureCodexAssistantReply,
  generateCodexRunMetadata,
  getCodexThreadRuntime,
  listCodexThreads,
  listCodexThreadRecords,
  listWorkspaceCodexThreads,
  resumeCodexThread,
  setCodexThreadName,
  startCodexThread,
  type CodexServiceThreadOpsContext,
} from './codex-service-thread-ops'
import {
  interruptCodexThreadTree,
  interruptCodexTurn,
  listCodexCollaborationModes,
  listCodexModels,
  respondToCodexApproval,
  respondToCodexUserInput,
  startCodexTurn,
  steerCodexTurn,
} from './codex-service-turn-ops'
export { buildRunMetadataPrompt, parseRunMetadataValue } from './codex-service-parsers'

export class CodexService extends EventEmitter {
  private providerSessionDirectory: ProviderSessionDirectory | null
  private process: ChildProcess | null = null
  private readline: Interface | null = null
  private startPromise: Promise<CodexState> | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private _state: CodexState = { status: 'disconnected' }
  private _models: CodexModelEntry[] = []
  private _collaborationModes: CodexCollaborationMode[] = []
  private readonly hiddenThreadIds = new Set<string>()
  private readonly hiddenThreadListeners = new Map<
    string,
    Set<(notification: CodexNotification) => void>
  >()
  private readonly itemThreadIds = new Map<string, string>()
  private readonly turnThreadIds = new Map<string, string>()
  private readonly threadSettings = new Map<
    string,
    { model?: string; reasoningEffort?: string | null }
  >()
  private readonly hydratedThreadIds = new Set<string>()

  constructor(providerSessionDirectory: ProviderSessionDirectory | null = null) {
    super()
    this.providerSessionDirectory = providerSessionDirectory
  }

  setProviderSessionDirectory(providerSessionDirectory: ProviderSessionDirectory | null) {
    this.providerSessionDirectory = providerSessionDirectory
  }
  get state(): CodexState { return { ...this._state } }
  get models(): CodexModelEntry[] { return [...this._models] }
  get collaborationModes(): CodexCollaborationMode[] { return [...this._collaborationModes] }

  async start(
    cwd?: string,
    options?: { codexPath?: string; codexArgs?: string }
  ): Promise<CodexState> {
    if (this.process && this._state.status !== 'connecting') {
      return this.state
    }
    if (this.startPromise) {
      return this.startPromise
    }

    const startPromise = this.startInternal(cwd, options)
    this.startPromise = startPromise
    try {
      return await startPromise
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null
      }
    }
  }

  private async startInternal(
    cwd?: string,
    options?: { codexPath?: string; codexArgs?: string }
  ): Promise<CodexState> {
    this._state = { status: 'connecting' }
    this.emit('state', this._state)

    try {
      const codexBin = options?.codexPath?.trim() || resolveCodexBinary()
      if (!codexBin) {
        const message =
          'codex binary not found in PATH. Install it with: npm install -g @openai/codex'
        console.error('[CodexService]', message)
        this._state = { status: 'error', lastError: message }
        this.emit('state', this._state)
        return this.state
      }

      const extraArgs = options?.codexArgs?.trim().split(/\s+/).filter(Boolean) ?? []
      const args = ['app-server', ...extraArgs]
      console.info(`[CodexService] Spawning: ${codexBin} ${args.join(' ')}`)
      const child = spawn(codexBin, args, {
        cwd: cwd ?? process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      this.process = child

      child.on('error', err => {
        console.error('[CodexService] Process error:', err.message)
        this._state = { status: 'error', lastError: err.message }
        this.emit('state', this._state)
        this.cleanup()
      })

      child.on('exit', (code, signal) => {
        console.info('[CodexService] Process exited, code:', code, 'signal:', signal)
        this._state = { status: 'disconnected' }
        this.emit('state', this._state)
        this.cleanup()
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        if (isIgnorableCodexStderr(text)) {
          console.info('[CodexService] ignored stderr:', text.trim())
          return
        }
        console.error('[CodexService] stderr:', text)
        this.emit('stderr', text)
      })

      const rl = createInterface({ input: child.stdout!, terminal: false })
      this.readline = rl
      rl.on('line', line => this.handleLine(line))

      const result = (await this.request('initialize', {
        clientInfo: { name: 'orxa_code', title: 'Orxa Code', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      })) as {
        server_info?: { name: string; version: string }
        serverInfo?: { name: string; version: string }
        userAgent?: { name: string; version: string }
      }

      this.sendNotification('initialized', {})
      try {
        const modelResult = await this.request('model/list', {})
        this._models = parseModelListResponse(modelResult)
      } catch (err) {
        console.warn('[CodexService] model/list failed (non-fatal):', err)
      }
      try {
        const modeResult = await this.request('collaborationMode/list', {})
        this._collaborationModes = parseModeListResponse(modeResult)
      } catch {
        // Non-fatal — server may not support collaboration modes
      }

      const serverInfo = result.serverInfo ?? result.server_info ?? result.userAgent
      this._state = { status: 'connected', serverInfo: serverInfo ?? undefined }
      this.emit('state', this._state)
      return this.state
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[CodexService] Failed to start:', message)
      this._state = { status: 'error', lastError: message }
      this.emit('state', this._state)
      this.cleanup()
      return this.state
    }
  }

  async stop(): Promise<CodexState> {
    this.cleanup()
    this._state = { status: 'disconnected' }
    this.emit('state', this._state)
    return this.state
  }

  private getThreadOpsContext(): CodexServiceThreadOpsContext {
    return {
      process: this.process,
      providerSessionDirectory: this.providerSessionDirectory,
      models: this._models,
      setModels: models => { this._models = models },
      collaborationModes: this._collaborationModes,
      setCollaborationModes: modes => { this._collaborationModes = modes },
      threadSettings: this.threadSettings,
      hydratedThreadIds: this.hydratedThreadIds,
      request: this.request.bind(this),
      ensureConnected: this.ensureConnected.bind(this),
      sendNotification: this.sendNotification.bind(this),
      sendResponse: this.sendResponse.bind(this),
      listThreadRecords: params => listCodexThreadRecords(this.getThreadOpsContext(), params),
      resumeThread: threadId => resumeCodexThread(this.getThreadOpsContext(), threadId),
      subscribeHiddenThread: this.subscribeHiddenThread.bind(this),
      archiveHiddenThread: this.archiveHiddenThread.bind(this),
      cleanupThreadMappings: this.cleanupThreadMappings.bind(this),
    }
  }

  async startThread(params: { model?: string; cwd?: string; approvalPolicy?: string; sandbox?: string; title?: string }): Promise<CodexThread> { return startCodexThread(this.getThreadOpsContext(), params) }
  async listWorkspaceThreads(workspaceRoot: string) { return listWorkspaceCodexThreads(this.getThreadOpsContext(), workspaceRoot) }
  async listThreads(params?: { cursor?: string | null; limit?: number; archived?: boolean }): Promise<{ threads: CodexThread[]; nextCursor?: string }> { return listCodexThreads(this.getThreadOpsContext(), params) }
  async getThreadRuntime(threadId: string): Promise<CodexThreadRuntime> { return getCodexThreadRuntime(this.getThreadOpsContext(), threadId) }
  async resumeThread(threadId: string): Promise<Record<string, unknown>> { return resumeCodexThread(this.getThreadOpsContext(), threadId) }
  async archiveThread(threadId: string): Promise<void> { return archiveCodexThread(this.getThreadOpsContext(), threadId) }
  async archiveThreadTree(rootThreadId: string): Promise<void> { return archiveCodexThreadTree(this.getThreadOpsContext(), rootThreadId) }
  async setThreadName(threadId: string, name: string): Promise<void> { return setCodexThreadName(this.getThreadOpsContext(), threadId, name) }
  async generateRunMetadata(cwd: string, prompt: string): Promise<CodexRunMetadata> { return generateCodexRunMetadata(this.getThreadOpsContext(), cwd, prompt) }
  async captureAssistantReply(threadId: string, prompt: string, cwd?: string): Promise<string> { return captureCodexAssistantReply(this.getThreadOpsContext(), threadId, prompt, cwd) }
  async startTurn(params: { threadId: string; prompt: string; cwd?: string; model?: string; effort?: string; collaborationMode?: string; attachments?: CodexAttachment[] }): Promise<void> { return startCodexTurn(this.getThreadOpsContext(), params) }
  async steerTurn(threadId: string, turnId: string, prompt: string): Promise<void> { return steerCodexTurn(this.getThreadOpsContext(), threadId, turnId, prompt) }
  async interruptTurn(threadId: string, turnId: string): Promise<void> { return interruptCodexTurn(this.getThreadOpsContext(), threadId, turnId) }
  async interruptThreadTree(rootThreadId: string, rootTurnId?: string): Promise<void> { return interruptCodexThreadTree(this.getThreadOpsContext(), rootThreadId, rootTurnId) }
  async listModels(): Promise<CodexModelEntry[]> { return listCodexModels(this.getThreadOpsContext()) }
  async listCollaborationModes(): Promise<CodexCollaborationMode[]> { return listCodexCollaborationModes(this.getThreadOpsContext()) }
  async respondToApproval(requestId: number, decision: string): Promise<void> { return respondToCodexApproval(this.getThreadOpsContext(), requestId, decision) }
  async respondToUserInput(requestId: number, answers: Record<string, { answers: string[] }>): Promise<void> { return respondToCodexUserInput(this.getThreadOpsContext(), requestId, answers) }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        return reject(new Error('Codex process is not running'))
      }

      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })

      const msg = { method, id, params }
      this.process.stdin.write(JSON.stringify(msg) + '\n')
    })
  }

  private async ensureConnected(cwd?: string): Promise<void> {
    if (this.process && this._state.status === 'connected') {
      return
    }
    const state = await this.start(cwd)
    if (state.status !== 'connected') {
      throw new Error(state.lastError ?? 'Codex process is not connected')
    }
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin?.writable) return
    const msg = { method, params }
    this.process.stdin.write(JSON.stringify(msg) + '\n')
  }

  private sendResponse(id: number, result: unknown): void {
    if (!this.process?.stdin?.writable) return
    const msg = { id, result }
    this.process.stdin.write(JSON.stringify(msg) + '\n')
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(msg.id)
        if (msg.error) {
          const err = msg.error as { code?: number; message?: string }
          pending.reject(new Error(err.message ?? `JSON-RPC error ${err.code}`))
        } else {
          pending.resolve(msg.result)
        }
        return
      }
    }
    if (typeof msg.id === 'number' && typeof msg.method === 'string') {
      const params = (msg.params ?? {}) as Record<string, unknown>
      this.trackThreadMappings(msg.method, params)
      const threadId = this.extractThreadId(msg.method, params)
      if (threadId && this.hiddenThreadIds.has(threadId)) {
        const notification = { method: msg.method, params } satisfies CodexNotification
        this.notifyHiddenThread(threadId, notification)
        this.sendResponse(msg.id, {})
        return
      }
      this.handleServerRequest(msg.id, msg.method, params)
      return
    }
    if (typeof msg.method === 'string' && msg.id === undefined) {
      const params = (msg.params ?? {}) as Record<string, unknown>
      this.trackThreadMappings(msg.method, params)
      const notification = {
        method: msg.method,
        params,
      } satisfies CodexNotification
      const threadId = this.extractThreadId(msg.method, params)
      if (threadId && this.hiddenThreadIds.has(threadId)) {
        this.notifyHiddenThread(threadId, notification)
        return
      }
      this.emit('notification', notification)
      return
    }
  }

  private subscribeHiddenThread(
    threadId: string,
    listener: (notification: CodexNotification) => void
  ) {
    this.hiddenThreadIds.add(threadId)
    const listeners =
      this.hiddenThreadListeners.get(threadId) ??
      new Set<(notification: CodexNotification) => void>()
    listeners.add(listener)
    this.hiddenThreadListeners.set(threadId, listeners)
    return () => {
      const current = this.hiddenThreadListeners.get(threadId)
      if (!current) {
        return
      }
      current.delete(listener)
      if (current.size === 0) {
        this.hiddenThreadListeners.delete(threadId)
        this.hiddenThreadIds.delete(threadId)
      }
    }
  }

  private notifyHiddenThread(threadId: string, notification: CodexNotification) {
    const listeners = this.hiddenThreadListeners.get(threadId)
    if (!listeners) {
      return
    }
    for (const listener of listeners) {
      listener(notification)
    }
  }

  private trackThreadMappings(method: string, params: Record<string, unknown>) {
    const threadId = this.extractThreadId(method, params)
    if (method === 'item/started' || method === 'item/completed') {
      const itemId = asString(params.itemId ?? asRecord(params.item)?.id).trim()
      if (itemId && threadId) {
        this.itemThreadIds.set(itemId, threadId)
      }
      if (method === 'item/completed' && itemId) {
        this.itemThreadIds.delete(itemId)
      }
    }
    if (method === 'turn/started' || method === 'turn/completed') {
      const turnId = asString(params.turnId ?? asRecord(params.turn)?.id).trim()
      if (turnId && threadId) {
        this.turnThreadIds.set(turnId, threadId)
      }
      if (method === 'turn/completed' && turnId) {
        this.turnThreadIds.delete(turnId)
      }
    }
    if ((method === 'thread/archived' || method === 'thread/closed') && threadId) {
      this.cleanupThreadMappings(threadId)
    }
  }

  private extractThreadId(method: string, params: Record<string, unknown>): string | null {
    const itemRecord = asRecord(params.item)
    const turnRecord = asRecord(params.turn)
    const threadRecord = asRecord(params.thread)
    const itemId = asString(params.itemId ?? itemRecord?.id).trim()
    const turnId = asString(params.turnId ?? turnRecord?.id).trim()
    const directThreadId = resolveDirectThreadId(params, threadRecord, turnRecord, itemRecord)

    if (directThreadId) {
      return directThreadId
    }
    if (itemId && this.itemThreadIds.has(itemId)) {
      return this.itemThreadIds.get(itemId) ?? null
    }
    if (turnId && this.turnThreadIds.has(turnId)) {
      return this.turnThreadIds.get(turnId) ?? null
    }
    if (method === 'thread/name/updated') {
      return asString(params.threadId ?? params.thread_id ?? threadRecord?.id).trim() || null
    }
    return null
  }

  private async archiveHiddenThread(threadId: string) {
    try {
      await this.request('thread/archive', { threadId })
    } catch {
      // Non-fatal cleanup.
    }
    this.hiddenThreadListeners.delete(threadId)
    this.hiddenThreadIds.delete(threadId)
  }

  private cleanupThreadMappings(threadId: string) {
    this.threadSettings.delete(threadId)
    this.hydratedThreadIds.delete(threadId)
    for (const [itemId, ownerThreadId] of this.itemThreadIds.entries()) {
      if (ownerThreadId === threadId) {
        this.itemThreadIds.delete(itemId)
      }
    }
    for (const [turnId, ownerThreadId] of this.turnThreadIds.entries()) {
      if (ownerThreadId === threadId) {
        this.turnThreadIds.delete(turnId)
      }
    }
  }

  private handleServerRequest(id: number, method: string, params: Record<string, unknown>): void {
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval' ||
      method === 'item/fileRead/requestApproval'
    ) {
      const approval: CodexApprovalRequest = {
        id,
        method,
        itemId: (params.itemId as string) ?? '',
        threadId: (params.threadId as string) ?? '',
        turnId: (params.turnId as string) ?? '',
        reason: (params.reason as string) ?? '',
        command: params.command as string[] | undefined,
        commandActions: params.commandActions as string[] | undefined,
        availableDecisions: (params.availableDecisions as string[]) ?? [],
        changes: params.changes as CodexApprovalRequest['changes'],
      }
      this.emit('approval', approval)
    } else if (method === 'item/tool/requestUserInput') {
      const rawQuestions = Array.isArray(params.questions) ? params.questions : []
      const questions = rawQuestions.map((q: Record<string, unknown>) => ({
        id: String(q.id ?? ''),
        header: String(q.header ?? ''),
        question: String(q.question ?? ''),
        isOther: Boolean(q.isOther ?? q.is_other),
        options: Array.isArray(q.options)
          ? q.options.map((o: Record<string, unknown>) => ({
              id: String(o.id ?? ''),
              label: String(o.label ?? ''),
              value: String(o.value ?? o.label ?? ''),
            }))
          : undefined,
      }))
      this.emit('userInput', {
        id,
        method,
        threadId: params.threadId ?? (params.thread_id as string) ?? '',
        turnId: params.turnId ?? (params.turn_id as string) ?? '',
        itemId: params.itemId ?? (params.item_id as string) ?? '',
        message: (params.message as string) ?? '',
        questions: questions.length > 0 ? questions : undefined,
      })
    } else {
      this.sendResponse(id, {})
    }
  }

  private cleanup(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Codex process terminated'))
    }
    this.pending.clear()

    if (this.readline) {
      this.readline.close()
      this.readline = null
    }

    if (this.process) {
      try {
        this.process.kill()
      } catch {
        // Process already exited.
      }
      this.process = null
    }
    this.hiddenThreadIds.clear()
    this.hiddenThreadListeners.clear()
    this.itemThreadIds.clear()
    this.turnThreadIds.clear()
    this.hydratedThreadIds.clear()
  }
}
