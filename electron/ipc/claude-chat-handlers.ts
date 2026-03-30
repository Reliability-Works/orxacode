import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ClaudeChatService } from '../services/claude-chat-service'
import { assertString } from './validators'

type ClaudeChatHandlersDeps = {
  claudeChatService: ClaudeChatService
}

export function registerClaudeChatHandlers({ claudeChatService }: ClaudeChatHandlersDeps) {
  ipcMain.handle(IPC.claudeChatHealth, async () => claudeChatService.health())
  ipcMain.handle(IPC.claudeChatListModels, async () => claudeChatService.listModels())
  ipcMain.handle(IPC.claudeChatGetState, async (_event, sessionKey: unknown) => {
    return claudeChatService.getState(assertString(sessionKey, 'sessionKey'))
  })
  ipcMain.handle(
    IPC.claudeChatStartTurn,
    async (_event, sessionKey: unknown, directory: unknown, prompt: unknown, options?: unknown) => {
      return claudeChatService.startTurn(
        assertString(sessionKey, 'sessionKey'),
        assertString(directory, 'directory'),
        assertString(prompt, 'prompt'),
        (options ?? {}) as Parameters<ClaudeChatService['startTurn']>[3]
      )
    }
  )
  ipcMain.handle(IPC.claudeChatInterruptTurn, async (_event, sessionKey: unknown) => {
    return claudeChatService.interruptTurn(assertString(sessionKey, 'sessionKey'))
  })
  ipcMain.handle(IPC.claudeChatApprove, async (_event, requestId: unknown, decision: unknown) => {
    return claudeChatService.approve(
      assertString(requestId, 'requestId'),
      assertString(decision, 'decision') as Parameters<ClaudeChatService['approve']>[1]
    )
  })
  ipcMain.handle(
    IPC.claudeChatRespondToUserInput,
    async (_event, requestId: unknown, response: unknown) => {
      return claudeChatService.respondToUserInput(
        assertString(requestId, 'requestId'),
        assertString(response, 'response')
      )
    }
  )
  ipcMain.handle(
    IPC.claudeChatGetSessionMessages,
    async (_event, sessionId: unknown, directory?: unknown) => {
      return claudeChatService.getSessionMessages(
        assertString(sessionId, 'sessionId'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
  ipcMain.handle(
    IPC.claudeChatRenameProviderSession,
    async (_event, sessionId: unknown, title: unknown, directory?: unknown) => {
      return claudeChatService.renameProviderSession(
        assertString(sessionId, 'sessionId'),
        assertString(title, 'title'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
  ipcMain.handle(IPC.claudeChatArchiveSession, async (_event, sessionKey: unknown) => {
    return claudeChatService.archiveSession(assertString(sessionKey, 'sessionKey'))
  })
  ipcMain.handle(
    IPC.claudeChatArchiveProviderSession,
    async (_event, sessionId: unknown, directory?: unknown) => {
      return claudeChatService.archiveProviderSession(
        assertString(sessionId, 'sessionId'),
        typeof directory === 'string' ? directory : undefined
      )
    }
  )
}
