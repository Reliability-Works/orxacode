import { useMemo } from 'react'
import type { CodexThread, ProjectBootstrap } from '@shared/ipc'
import { getPersistedCodexState } from './codex-session-storage'
import type { SubagentInfo } from './useCodexSession'
import {
  buildCodexSessionStatus,
  buildClaudeChatSessionStatus,
  buildClaudeSessionStatus,
  buildOpencodeSessionStatus,
  selectActiveBackgroundAgentsPresentation,
  selectClaudeChatSessionRuntime,
  useUnifiedRuntimeStore,
} from '../state/unified-runtime-store'
import { buildWorkspaceSessionMetadataKey } from '../lib/workspace-session-metadata'
import type { BackgroundSessionDescriptor } from '../lib/background-session-descriptors'
import {
  buildCodexBackgroundAgents,
  buildCodexBackgroundAgentsFromChildThreads,
  type UnifiedBackgroundAgentSummary,
} from '../lib/session-presentation'

type UseBackgroundSessionDescriptorsInput = {
  activeProjectDir?: string
  activeSessionID?: string
  activeSessionKey?: string
  activeSessionType?: string
  cachedProjects: Record<string, ProjectBootstrap>
  archivedBackgroundAgentIds: Record<string, string[]>
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}

function hasActiveCodexBackgroundWork(
  sessionStorageKey: string,
  codexSessionStateMap: Record<string, unknown>
) {
  const runtime = codexSessionStateMap[sessionStorageKey] as
    | {
        subagents?: SubagentInfo[]
        runtimeSnapshot?: { childThreads?: CodexThread[] }
      }
    | undefined
  const persisted = getPersistedCodexState(sessionStorageKey)
  if (persisted.isStreaming) {
    return true
  }
  const status = buildCodexSessionStatus(sessionStorageKey, false)
  if (status.type === 'busy' || status.type === 'awaiting') {
    return true
  }
  const activeSubagents = [
    ...buildCodexBackgroundAgents(runtime?.subagents ?? []),
    ...buildCodexBackgroundAgentsFromChildThreads(runtime?.runtimeSnapshot?.childThreads ?? []),
  ]
  return activeSubagents.some(
    agent => agent.status === 'thinking' || agent.status === 'awaiting_instruction'
  )
}

function hasActiveClaudeBackgroundWork(
  sessionStorageKey: string,
  claudeSessionStateMap: Record<string, unknown>
) {
  const runtime = claudeSessionStateMap[sessionStorageKey]
  const status = buildClaudeSessionStatus(sessionStorageKey, false)
  return status.type === 'busy' || status.type === 'awaiting' || Boolean(runtime)
}

function hasActiveClaudeChatBackgroundWork(
  sessionStorageKey: string,
  claudeChatSessionStateMap: Record<string, unknown>
) {
  const runtime =
    (claudeChatSessionStateMap[sessionStorageKey] as
      | {
          providerThreadId?: string
          isStreaming?: boolean
          pendingApproval?: unknown
          pendingUserInput?: unknown
          messages?: unknown[]
          subagents?: unknown[]
        }
      | undefined) ?? selectClaudeChatSessionRuntime(sessionStorageKey)
  const hasBackgroundRuntime =
    Boolean(runtime?.providerThreadId) ||
    Boolean(runtime?.isStreaming) ||
    Boolean(runtime?.pendingApproval) ||
    Boolean(runtime?.pendingUserInput) ||
    (runtime?.messages?.length ?? 0) > 0 ||
    (runtime?.subagents?.length ?? 0) > 0
  if (!hasBackgroundRuntime) {
    return false
  }
  const status = buildClaudeChatSessionStatus(sessionStorageKey, false)
  return status.type === 'busy' || status.type === 'awaiting'
}

function shouldIncludeOpencodeBackgroundSession(
  directory: string,
  sessionID: string,
  getSessionType: (sessionID: string, directory?: string) => string | undefined,
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined,
  activeSessionKey: string | undefined
) {
  const sessionType = getSessionType(sessionID, directory)
  if (normalizePresentationProvider(sessionType) !== 'opencode') {
    return false
  }
  const sessionStorageKey = buildWorkspaceSessionMetadataKey(directory, sessionID)
  if (sessionStorageKey === activeSessionKey) {
    return false
  }
  const status = buildOpencodeSessionStatus(directory, sessionID, false, sessionStorageKey)
  return status.type === 'busy' || status.type === 'awaiting'
}

function useBackgroundSessionDescriptorsList({
  cachedProjects,
  codexSessionStateMap,
  claudeChatSessionStateMap,
  claudeSessionStateMap,
  opencodeSessionStateMap,
  getSessionType,
  activeSessionKey,
  normalizePresentationProvider,
}: {
  activeSessionKey?: string
  cachedProjects: Record<string, ProjectBootstrap>
  codexSessionStateMap: Record<string, unknown>
  claudeChatSessionStateMap: Record<string, unknown>
  claudeSessionStateMap: Record<string, unknown>
  opencodeSessionStateMap: Record<string, unknown>
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}) {
  return useMemo<BackgroundSessionDescriptor[]>(() => {
    void opencodeSessionStateMap
    const next: BackgroundSessionDescriptor[] = []
    const seenCodexKeys = new Set<string>()

    for (const [directory, data] of Object.entries(cachedProjects)) {
      for (const session of data.sessions) {
        const sessionType = getSessionType(session.id, directory)
        const sessionStorageKey = buildWorkspaceSessionMetadataKey(directory, session.id)
        if (sessionStorageKey === activeSessionKey) {
          continue
        }

        if (
          sessionType === 'codex' &&
          !seenCodexKeys.has(sessionStorageKey) &&
          (hasActiveCodexBackgroundWork(sessionStorageKey, codexSessionStateMap) ||
            buildCodexSessionStatus(sessionStorageKey, false).type === 'plan_ready')
        ) {
          seenCodexKeys.add(sessionStorageKey)
          next.push({
            key: `codex:${sessionStorageKey}`,
            provider: 'codex',
            directory,
            sessionStorageKey,
          })
          continue
        }

        if (
          shouldIncludeOpencodeBackgroundSession(
            directory,
            session.id,
            getSessionType,
            normalizePresentationProvider,
            activeSessionKey
          )
        ) {
          next.push({
            key: `opencode:${directory}:${session.id}`,
            provider: 'opencode',
            directory,
            sessionID: session.id,
          })
          continue
        }

        if (sessionType === 'claude' && hasActiveClaudeBackgroundWork(sessionStorageKey, claudeSessionStateMap)) {
          next.push({
            key: `claude:${sessionStorageKey}`,
            provider: 'claude',
            directory,
            sessionStorageKey,
          })
          continue
        }

        if (
          sessionType === 'claude-chat' &&
          hasActiveClaudeChatBackgroundWork(sessionStorageKey, claudeChatSessionStateMap)
        ) {
          next.push({
            key: `claude-chat:${sessionStorageKey}`,
            provider: 'claude-chat',
            directory,
            sessionStorageKey,
          })
        }
      }
    }

    return next
  }, [
    activeSessionKey,
    cachedProjects,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    codexSessionStateMap,
    getSessionType,
    normalizePresentationProvider,
    opencodeSessionStateMap,
  ])
}

function useActiveBackgroundAgents({
  activeProjectDir,
  activeSessionID,
  activeSessionKey,
  activeSessionType,
  claudeChatSessionStateMap,
  claudeSessionStateMap,
  codexSessionStateMap,
  opencodeSessionStateMap,
  normalizePresentationProvider,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  activeSessionKey?: string
  activeSessionType?: string
  claudeChatSessionStateMap: Record<string, unknown>
  claudeSessionStateMap: Record<string, unknown>
  codexSessionStateMap: Record<string, unknown>
  opencodeSessionStateMap: Record<string, unknown>
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}) {
  return useMemo<UnifiedBackgroundAgentSummary[]>(() => {
    void codexSessionStateMap
    void claudeSessionStateMap
    void claudeChatSessionStateMap
    void opencodeSessionStateMap
    return selectActiveBackgroundAgentsPresentation({
      provider: normalizePresentationProvider(activeSessionType),
      directory: activeProjectDir,
      sessionID: activeSessionID,
      sessionKey: activeSessionKey,
    })
  }, [
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    activeSessionType,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    codexSessionStateMap,
    normalizePresentationProvider,
    opencodeSessionStateMap,
  ])
}

function useVisibleBackgroundAgents({
  activeBackgroundAgents,
  activeProjectDir,
  archivedBackgroundAgentIds,
}: {
  activeBackgroundAgents: UnifiedBackgroundAgentSummary[]
  activeProjectDir?: string
  archivedBackgroundAgentIds: Record<string, string[]>
}) {
  return useMemo(() => {
    if (!activeProjectDir) {
      return activeBackgroundAgents
    }
    const hiddenIds = new Set(archivedBackgroundAgentIds[activeProjectDir] ?? [])
    return activeBackgroundAgents.filter(agent => {
      if (hiddenIds.has(agent.id)) {
        return false
      }
      if (agent.sessionID && hiddenIds.has(agent.sessionID)) {
        return false
      }
      return true
    })
  }, [activeBackgroundAgents, activeProjectDir, archivedBackgroundAgentIds])
}

function useBackgroundSessionPresentation({
  activeProjectDir,
  activeSessionID,
  activeSessionKey,
  activeSessionType,
  archivedBackgroundAgentIds,
  cachedProjects,
  codexSessionStateMap,
  claudeChatSessionStateMap,
  claudeSessionStateMap,
  opencodeSessionStateMap,
  getSessionType,
  normalizePresentationProvider,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  activeSessionKey?: string
  activeSessionType?: string
  archivedBackgroundAgentIds: Record<string, string[]>
  cachedProjects: Record<string, ProjectBootstrap>
  codexSessionStateMap: Record<string, unknown>
  claudeChatSessionStateMap: Record<string, unknown>
  claudeSessionStateMap: Record<string, unknown>
  opencodeSessionStateMap: Record<string, unknown>
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  normalizePresentationProvider: (
    sessionType: string | undefined
  ) => 'opencode' | 'codex' | 'claude' | 'claude-chat' | undefined
}) {
  const backgroundSessionDescriptors = useBackgroundSessionDescriptorsList({
    activeSessionKey,
    cachedProjects,
    codexSessionStateMap,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    opencodeSessionStateMap,
    getSessionType,
    normalizePresentationProvider,
  })
  const activeBackgroundAgents = useActiveBackgroundAgents({
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    activeSessionType,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    codexSessionStateMap,
    opencodeSessionStateMap,
    normalizePresentationProvider,
  })
  const visibleBackgroundAgents = useVisibleBackgroundAgents({
    activeBackgroundAgents,
    activeProjectDir,
    archivedBackgroundAgentIds,
  })

  return {
    backgroundSessionDescriptors,
    activeBackgroundAgents,
    visibleBackgroundAgents,
  }
}

export function useBackgroundSessionDescriptors({
  activeProjectDir,
  activeSessionID,
  activeSessionKey,
  activeSessionType,
  cachedProjects,
  archivedBackgroundAgentIds,
  getSessionType,
  normalizePresentationProvider,
}: UseBackgroundSessionDescriptorsInput) {
  const codexSessionStateMap = useUnifiedRuntimeStore(state => state.codexSessions)
  const opencodeSessionStateMap = useUnifiedRuntimeStore(state => state.opencodeSessions)
  const claudeChatSessionStateMap = useUnifiedRuntimeStore(state => state.claudeChatSessions)
  const claudeSessionStateMap = useUnifiedRuntimeStore(state => state.claudeSessions)

  return useBackgroundSessionPresentation({
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    activeSessionType,
    archivedBackgroundAgentIds,
    cachedProjects,
    codexSessionStateMap,
    claudeChatSessionStateMap,
    claudeSessionStateMap,
    opencodeSessionStateMap,
    getSessionType,
    normalizePresentationProvider,
  })
}
