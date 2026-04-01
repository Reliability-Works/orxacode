import type {
  ClaudeBrowserSessionSummary,
  ClaudeChatState,
  ClaudeResumeProviderSessionResult,
} from '@shared/ipc'
import type { ProviderSessionDirectory } from './provider-session-directory'
import {
  buildImportedClaudeSessionMap,
  listClaudeBrowserSessions,
} from './claude-chat-session-inventory'

export type ClaudeBrowserSessionCache = {
  cachedAt: number
  value: ClaudeBrowserSessionSummary[]
}

export function readClaudeDisconnectedState(
  sessionKey: string,
  providerSessionDirectory: ProviderSessionDirectory | null,
  readClaudeResumeCursor: (resumeCursor: unknown) => string | undefined
): ClaudeChatState {
  const binding = providerSessionDirectory?.getBinding(sessionKey, 'claude-chat')
  const providerThreadId = readClaudeResumeCursor(binding?.resumeCursor)
  return {
    sessionKey,
    status: 'disconnected',
    ...(providerThreadId ? { providerThreadId } : {}),
  }
}

export async function listClaudeSessionsWithCache(args: {
  cachedBrowserSessions: ClaudeBrowserSessionCache | null
  providerSessionDirectory: ProviderSessionDirectory | null
  claudeInventoryRoot: string
}) {
  const now = Date.now()
  if (args.cachedBrowserSessions && now - args.cachedBrowserSessions.cachedAt < 5_000) {
    return args.cachedBrowserSessions
  }
  const importedSessionsByProviderThreadId = buildImportedClaudeSessionMap(
    args.providerSessionDirectory?.list('claude-chat') ?? []
  )
  return {
    cachedAt: now,
    value: await listClaudeBrowserSessions({
      inventoryRoot: args.claudeInventoryRoot,
      importedSessionsByProviderThreadId,
    }),
  } satisfies ClaudeBrowserSessionCache
}

export async function resumeClaudeProviderSession(args: {
  providerThreadId: string
  directory: string
  sessions: ClaudeBrowserSessionSummary[]
  providerSessionDirectory: ProviderSessionDirectory | null
}) {
  const normalizedProviderThreadId = args.providerThreadId.trim()
  const normalizedDirectory = args.directory.trim()
  if (!normalizedProviderThreadId) {
    throw new Error('providerThreadId is required')
  }
  if (!normalizedDirectory) {
    throw new Error('directory is required')
  }

  const matchingSession = args.sessions.find(
    session => session.providerThreadId === normalizedProviderThreadId
  )
  if (!matchingSession) {
    throw new Error('Claude session not found')
  }

  if (matchingSession.importedSession) {
    return {
      providerThreadId: normalizedProviderThreadId,
      sessionKey: matchingSession.importedSession.sessionKey,
      sessionID: matchingSession.importedSession.sessionID,
      directory: matchingSession.importedSession.directory,
      title: matchingSession.title,
    } satisfies ClaudeResumeProviderSessionResult
  }

  const sessionKey = `${normalizedDirectory}::${normalizedProviderThreadId}`
  args.providerSessionDirectory?.upsert({
    provider: 'claude-chat',
    sessionKey,
    status: 'running',
    resumeCursor: { resume: normalizedProviderThreadId },
    runtimePayload: { directory: normalizedDirectory },
  })
  return {
    providerThreadId: normalizedProviderThreadId,
    sessionKey,
    sessionID: normalizedProviderThreadId,
    directory: normalizedDirectory,
    title: matchingSession.title,
  } satisfies ClaudeResumeProviderSessionResult
}
