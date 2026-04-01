import { IPC } from '../../shared/ipc'
import type { ClaudeChatService } from '../services/claude-chat-service'
import type { PerformanceTelemetryService } from '../services/performance-telemetry-service'
import { registerMeasuredHandler } from './ipc-performance'
import { assertString } from './validators'

type ClaudeChatHandlersDeps = {
  claudeChatService: ClaudeChatService
  performanceTelemetryService: PerformanceTelemetryService
}

export function registerClaudeChatHandlers({
  claudeChatService,
  performanceTelemetryService,
}: ClaudeChatHandlersDeps) {
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatHealth,
    'claude_chat',
    async () => claudeChatService.health()
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatListModels,
    'claude_chat',
    async () => claudeChatService.listModels()
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatGetState,
    'claude_chat',
    async (_event, sessionKey: unknown) =>
      claudeChatService.getState(assertString(sessionKey, 'sessionKey'))
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatStartTurn,
    'claude_chat',
    async (_event, sessionKey: unknown, directory: unknown, prompt: unknown, options?: unknown) => {
      return claudeChatService.startTurn(
        assertString(sessionKey, 'sessionKey'),
        assertString(directory, 'directory'),
        assertString(prompt, 'prompt'),
        (options ?? {}) as Parameters<ClaudeChatService['startTurn']>[3]
      )
    }
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatInterruptTurn,
    'claude_chat',
    async (_event, sessionKey: unknown) =>
      claudeChatService.interruptTurn(assertString(sessionKey, 'sessionKey'))
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatApprove,
    'claude_chat',
    async (_event, requestId: unknown, decision: unknown) =>
      claudeChatService.approve(
        assertString(requestId, 'requestId'),
        assertString(decision, 'decision') as Parameters<ClaudeChatService['approve']>[1]
      )
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatRespondToUserInput,
    'claude_chat',
    async (_event, requestId: unknown, response: unknown) => {
      return claudeChatService.respondToUserInput(
        assertString(requestId, 'requestId'),
        assertString(response, 'response')
      )
    }
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatGetSessionMessages,
    'claude_chat',
    async (_event, sessionId: unknown, directory?: unknown) => {
      return claudeChatService.getSessionMessages(
        assertString(sessionId, 'sessionId'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatListSessions,
    'claude_chat',
    async () => claudeChatService.listSessions()
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatResumeProviderSession,
    'claude_chat',
    async (_event, providerThreadId: unknown, directory: unknown) => {
      return claudeChatService.resumeProviderSession(
        assertString(providerThreadId, 'providerThreadId'),
        assertString(directory, 'directory')
      )
    }
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatRenameProviderSession,
    'claude_chat',
    async (_event, sessionId: unknown, title: unknown, directory?: unknown) => {
      return claudeChatService.renameProviderSession(
        assertString(sessionId, 'sessionId'),
        assertString(title, 'title'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatArchiveSession,
    'claude_chat',
    async (_event, sessionKey: unknown) =>
      claudeChatService.archiveSession(assertString(sessionKey, 'sessionKey'))
  )
  registerMeasuredHandler(
    performanceTelemetryService,
    IPC.claudeChatArchiveProviderSession,
    'claude_chat',
    async (_event, sessionId: unknown, directory?: unknown) => {
      return claudeChatService.archiveProviderSession(
        assertString(sessionId, 'sessionId'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
}
