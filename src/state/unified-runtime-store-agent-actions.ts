import type { UnifiedRuntimeStoreState, UnifiedRuntimeStoreSet } from './unified-runtime-store-types'
import {
  ensureClaudeChatSession,
  ensureClaudeSession,
  ensureCodexSession,
  upsertTurnTokenSample,
} from './unified-runtime-store-helpers'

type UnifiedRuntimeAgentActions = Pick<
  UnifiedRuntimeStoreState,
  | 'initClaudeChatSession'
  | 'setClaudeChatConnectionState'
  | 'setClaudeChatProviderThreadId'
  | 'replaceClaudeChatMessages'
  | 'updateClaudeChatMessages'
  | 'setClaudeChatHistoryMessages'
  | 'setClaudeChatPendingApproval'
  | 'setClaudeChatPendingUserInput'
  | 'setClaudeChatStreaming'
  | 'setClaudeChatTurnUsage'
  | 'setClaudeChatSubagents'
  | 'removeClaudeChatSession'
  | 'initClaudeSession'
  | 'setClaudeBusy'
  | 'setClaudeAwaiting'
  | 'setClaudeActivityAt'
  | 'removeClaudeSession'
  | 'initCodexSession'
  | 'setCodexConnectionState'
  | 'setCodexThread'
  | 'setCodexRuntimeSnapshot'
  | 'replaceCodexMessages'
  | 'updateCodexMessages'
  | 'setCodexPendingApproval'
  | 'setCodexPendingUserInput'
  | 'setCodexStreaming'
  | 'setCodexTurnUsage'
  | 'setCodexThreadName'
  | 'setCodexPlanItems'
  | 'setCodexDismissedPlanIds'
  | 'setCodexSubagents'
  | 'setCodexActiveSubagentThreadId'
  | 'resetCodexSession'
  | 'removeCodexSession'
>

function updateClaudeChatSessionState(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  update: Partial<UnifiedRuntimeStoreState['claudeChatSessions'][string]>
) {
  const session = ensureClaudeChatSession(state, sessionKey)
  return {
    ...state.claudeChatSessions,
    [sessionKey]: { ...session, ...update },
  }
}

function updateClaudeSessionState(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  update: Partial<UnifiedRuntimeStoreState['claudeSessions'][string]>
) {
  const session = ensureClaudeSession(state, sessionKey)
  return {
    ...state.claudeSessions,
    [sessionKey]: { ...session, ...update },
  }
}

function updateCodexSessionState(
  state: UnifiedRuntimeStoreState,
  sessionKey: string,
  update: Partial<UnifiedRuntimeStoreState['codexSessions'][string]>
) {
  const session = ensureCodexSession(state, sessionKey)
  return {
    ...state.codexSessions,
    [sessionKey]: { ...session, ...update },
  }
}

export function createUnifiedRuntimeAgentActions(
  set: UnifiedRuntimeStoreSet
): UnifiedRuntimeAgentActions {
  return {
    ...createClaudeChatActions(set),
    ...createClaudeActions(set),
    ...createCodexActions(set),
  }
}

function createClaudeChatActions(
  set: UnifiedRuntimeStoreSet
): Pick<
  UnifiedRuntimeAgentActions,
  | 'initClaudeChatSession'
  | 'setClaudeChatConnectionState'
  | 'setClaudeChatProviderThreadId'
  | 'replaceClaudeChatMessages'
  | 'updateClaudeChatMessages'
  | 'setClaudeChatHistoryMessages'
  | 'setClaudeChatPendingApproval'
  | 'setClaudeChatPendingUserInput'
  | 'setClaudeChatStreaming'
  | 'setClaudeChatTurnUsage'
  | 'setClaudeChatSubagents'
  | 'removeClaudeChatSession'
> {
  return {
    ...createClaudeChatLifecycleActions(set),
    ...createClaudeChatRuntimeActions(set),
  }
}

function createClaudeChatLifecycleActions(
  set: UnifiedRuntimeStoreSet
): Pick<UnifiedRuntimeAgentActions, 'initClaudeChatSession' | 'removeClaudeChatSession'> {
  return {
    initClaudeChatSession: (sessionKey, directory) =>
      set(state => ({
        claudeChatSessions: {
          ...state.claudeChatSessions,
          [sessionKey]: ensureClaudeChatSession(state, sessionKey, directory),
        },
      })),
    removeClaudeChatSession: sessionKey =>
      set(state => {
        if (!(sessionKey in state.claudeChatSessions)) {
          return state
        }
        const next = { ...state.claudeChatSessions }
        delete next[sessionKey]
        return { claudeChatSessions: next }
      }),
  }
}

function createClaudeChatRuntimeActions(
  set: UnifiedRuntimeStoreSet
): Pick<
  UnifiedRuntimeAgentActions,
  | 'setClaudeChatConnectionState'
  | 'setClaudeChatProviderThreadId'
  | 'replaceClaudeChatMessages'
  | 'updateClaudeChatMessages'
  | 'setClaudeChatHistoryMessages'
  | 'setClaudeChatPendingApproval'
  | 'setClaudeChatPendingUserInput'
  | 'setClaudeChatStreaming'
  | 'setClaudeChatTurnUsage'
  | 'setClaudeChatSubagents'
> {
  return {
    setClaudeChatConnectionState: (sessionKey, status, providerThreadId, activeTurnId, lastError) =>
      set(state => {
        const session = ensureClaudeChatSession(state, sessionKey)
        return {
          claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
            connectionStatus: status,
            providerThreadId:
              providerThreadId !== undefined ? providerThreadId : session.providerThreadId,
            activeTurnId: activeTurnId !== undefined ? activeTurnId : session.activeTurnId,
            lastError: lastError !== undefined ? lastError : session.lastError,
          }),
        }
      }),
    setClaudeChatProviderThreadId: (sessionKey, providerThreadId) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, { providerThreadId }),
      })),
    replaceClaudeChatMessages: (sessionKey, messages) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, { messages }),
      })),
    updateClaudeChatMessages: (sessionKey, updater) =>
      set(state => {
        const session = ensureClaudeChatSession(state, sessionKey)
        return {
          claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
            messages: updater(session.messages),
          }),
        }
      }),
    setClaudeChatHistoryMessages: (sessionKey, messages) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
          historyMessages: messages,
        }),
      })),
    setClaudeChatPendingApproval: (sessionKey, request) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
          pendingApproval: request,
        }),
      })),
    setClaudeChatPendingUserInput: (sessionKey, request) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
          pendingUserInput: request,
        }),
      })),
    setClaudeChatStreaming: (sessionKey, isStreaming) =>
      set(state => ({
        claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, { isStreaming }),
      })),
    setClaudeChatTurnUsage: (sessionKey, turnId, total, timestamp) =>
      set(state => {
        const session = ensureClaudeChatSession(state, sessionKey)
        const nextUsage = upsertTurnTokenSample(
          session.turnTokenTotals ?? [],
          turnId,
          total,
          timestamp
        )
        return {
          claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
            observedTokenTotal: nextUsage.observedTokenTotal,
            turnTokenTotals: nextUsage.samples,
          }),
        }
      }),
    setClaudeChatSubagents: (sessionKey, subagents) =>
      set(state => {
        const session = ensureClaudeChatSession(state, sessionKey)
        const nextSubagents =
          typeof subagents === 'function' ? subagents(session.subagents) : subagents
        return {
          claudeChatSessions: updateClaudeChatSessionState(state, sessionKey, {
            subagents: nextSubagents,
          }),
        }
      }),
  }
}

function createClaudeActions(
  set: UnifiedRuntimeStoreSet
): Pick<
  UnifiedRuntimeAgentActions,
  'initClaudeSession' | 'setClaudeBusy' | 'setClaudeAwaiting' | 'setClaudeActivityAt' | 'removeClaudeSession'
> {
  return {
    initClaudeSession: (sessionKey, directory) =>
      set(state => ({
        claudeSessions: {
          ...state.claudeSessions,
          [sessionKey]: ensureClaudeSession(state, sessionKey, directory),
        },
      })),
    setClaudeBusy: (sessionKey, busy) =>
      set(state => ({
        claudeSessions: updateClaudeSessionState(state, sessionKey, { busy }),
      })),
    setClaudeAwaiting: (sessionKey, awaiting) =>
      set(state => ({
        claudeSessions: updateClaudeSessionState(state, sessionKey, { awaiting }),
      })),
    setClaudeActivityAt: (sessionKey, activityAt) =>
      set(state => ({
        claudeSessions: updateClaudeSessionState(state, sessionKey, { activityAt }),
      })),
    removeClaudeSession: sessionKey =>
      set(state => {
        if (!(sessionKey in state.claudeSessions)) {
          return state
        }
        const next = { ...state.claudeSessions }
        delete next[sessionKey]
        return { claudeSessions: next }
      }),
  }
}

function createCodexActions(
  set: UnifiedRuntimeStoreSet
): Pick<
  UnifiedRuntimeAgentActions,
  | 'initCodexSession'
  | 'setCodexConnectionState'
  | 'setCodexThread'
  | 'setCodexRuntimeSnapshot'
  | 'replaceCodexMessages'
  | 'updateCodexMessages'
  | 'setCodexPendingApproval'
  | 'setCodexPendingUserInput'
  | 'setCodexStreaming'
  | 'setCodexTurnUsage'
  | 'setCodexThreadName'
  | 'setCodexPlanItems'
  | 'setCodexDismissedPlanIds'
  | 'setCodexSubagents'
  | 'setCodexActiveSubagentThreadId'
  | 'resetCodexSession'
  | 'removeCodexSession'
> {
  return {
    ...createCodexMetadataActions(set),
    ...createCodexRuntimeActions(set),
    ...createCodexLifecycleActions(set),
  }
}

function createCodexRuntimeActions(
  set: UnifiedRuntimeStoreSet
): Pick<
  UnifiedRuntimeAgentActions,
  | 'setCodexConnectionState'
  | 'setCodexThread'
  | 'setCodexRuntimeSnapshot'
  | 'replaceCodexMessages'
  | 'updateCodexMessages'
  | 'setCodexPendingApproval'
  | 'setCodexPendingUserInput'
  | 'setCodexStreaming'
  | 'setCodexPlanItems'
  | 'setCodexDismissedPlanIds'
  | 'setCodexSubagents'
  | 'setCodexActiveSubagentThreadId'
> {
  return {
    setCodexConnectionState: (sessionKey, status, serverInfo, lastError) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, {
          connectionStatus: status,
          serverInfo,
          lastError,
        }),
      })),
    setCodexThread: (sessionKey, thread) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { thread }),
      })),
    setCodexRuntimeSnapshot: (sessionKey, snapshot) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { runtimeSnapshot: snapshot }),
      })),
    replaceCodexMessages: (sessionKey, messages) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { messages }),
      })),
    updateCodexMessages: (sessionKey, updater) =>
      set(state => {
        const session = ensureCodexSession(state, sessionKey)
        return {
          codexSessions: updateCodexSessionState(state, sessionKey, {
            messages: updater(session.messages),
          }),
        }
      }),
    setCodexPendingApproval: (sessionKey, request) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { pendingApproval: request }),
      })),
    setCodexPendingUserInput: (sessionKey, request) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { pendingUserInput: request }),
      })),
    setCodexStreaming: (sessionKey, isStreaming) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { isStreaming }),
      })),
    setCodexPlanItems: (sessionKey, items) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { planItems: items }),
      })),
    setCodexDismissedPlanIds: (sessionKey, ids) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { dismissedPlanIds: ids }),
      })),
    setCodexSubagents: (sessionKey, subagents) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { subagents }),
      })),
    setCodexActiveSubagentThreadId: (sessionKey, threadId) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, {
          activeSubagentThreadId: threadId,
        }),
      })),
  }
}

function createCodexMetadataActions(
  set: UnifiedRuntimeStoreSet
): Pick<UnifiedRuntimeAgentActions, 'setCodexTurnUsage' | 'setCodexThreadName'> {
  return {
    setCodexTurnUsage: (sessionKey, turnId, total, timestamp) =>
      set(state => {
        const session = ensureCodexSession(state, sessionKey)
        const nextUsage = upsertTurnTokenSample(
          session.turnTokenTotals ?? [],
          turnId,
          total,
          timestamp
        )
        return {
          codexSessions: updateCodexSessionState(state, sessionKey, {
            observedTokenTotal: nextUsage.observedTokenTotal,
            turnTokenTotals: nextUsage.samples,
          }),
        }
      }),
    setCodexThreadName: (sessionKey, name) =>
      set(state => ({
        codexSessions: updateCodexSessionState(state, sessionKey, { threadName: name }),
      })),
  }
}

function createCodexLifecycleActions(
  set: UnifiedRuntimeStoreSet
): Pick<UnifiedRuntimeAgentActions, 'initCodexSession' | 'resetCodexSession' | 'removeCodexSession'> {
  return {
    initCodexSession: (sessionKey, directory) =>
      set(state => ({
        codexSessions: {
          ...state.codexSessions,
          [sessionKey]: ensureCodexSession(state, sessionKey, directory),
        },
      })),
    resetCodexSession: sessionKey =>
      set(state => {
        const session = ensureCodexSession(state, sessionKey)
        return {
          codexSessions: updateCodexSessionState(state, sessionKey, {
            ...session,
            thread: null,
            runtimeSnapshot: null,
            messages: [],
            pendingApproval: null,
            pendingUserInput: null,
            isStreaming: false,
            lastError: undefined,
            threadName: undefined,
            planItems: [],
            dismissedPlanIds: [],
            subagents: [],
            activeSubagentThreadId: null,
          }),
        }
      }),
    removeCodexSession: sessionKey =>
      set(state => {
        const next = { ...state.codexSessions }
        delete next[sessionKey]
        return { codexSessions: next }
      }),
  }
}
