import type { SessionType } from '../types/canvas'

type ProviderSessionArchiveType = SessionType | undefined

type ClearLocalProviderArchiveArgs = {
  archivedSessionType: ProviderSessionArchiveType
  sessionKey: string
  clearPersistedCodexState: (sessionKey: string) => void
  removeCodexSession: (sessionKey: string) => void
  clearPersistedClaudeChatState: (sessionKey: string) => void
  removeClaudeChatSession: (sessionKey: string) => void
  removeClaudeSession: (sessionKey: string) => void
}

type BuildProviderArchiveRequestArgs = {
  archivedSessionType: ProviderSessionArchiveType
  sessionKey: string
  directory: string
  codexThreadId?: string
  providerThreadId?: string | null
}

export function clearLocalProviderArchiveState(args: ClearLocalProviderArchiveArgs) {
  const {
    archivedSessionType,
    sessionKey,
    clearPersistedCodexState,
    removeCodexSession,
    clearPersistedClaudeChatState,
    removeClaudeChatSession,
    removeClaudeSession,
  } = args

  if (archivedSessionType === 'codex') {
    clearPersistedCodexState(sessionKey)
    removeCodexSession(sessionKey)
    return
  }

  if (archivedSessionType === 'claude-chat') {
    clearPersistedClaudeChatState(sessionKey)
    removeClaudeChatSession(sessionKey)
    return
  }

  if (archivedSessionType === 'claude') {
    removeClaudeSession(sessionKey)
  }
}

export function buildProviderArchiveRequest(args: BuildProviderArchiveRequestArgs) {
  const { archivedSessionType, sessionKey, directory, codexThreadId, providerThreadId } = args

  if (archivedSessionType === 'codex' && codexThreadId) {
    return () => window.orxa.codex.archiveThreadTree(codexThreadId)
  }

  if (archivedSessionType === 'claude-chat') {
    return async () => {
      if (providerThreadId) {
        await window.orxa.claudeChat.archiveProviderSession(providerThreadId, directory)
      }
      await window.orxa.claudeChat.archiveSession(sessionKey)
    }
  }

  return null
}
