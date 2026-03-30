import { renderHook } from '@testing-library/react'
import type {
  OrxaTerminalSession,
  ProjectBootstrap,
  SessionMessageBundle,
  SessionRuntimeSnapshot,
} from '@shared/ipc'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { useWorkspaceState } from './useWorkspaceState'

export function resetWorkspaceStateForTests() {
  window.localStorage.clear()
  useUnifiedRuntimeStore.setState({
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    activeProvider: undefined,
    pendingSessionId: undefined,
    projectDataByDirectory: {},
    workspaceMetaByDirectory: {},
    opencodeSessions: {},
    codexSessions: {},
    claudeSessions: {},
    sessionReadTimestamps: {},
    collapsedProjects: {},
  })
}

export function createProjectBootstrap(
  directory: string,
  sessions: Array<{ id: string; time: { updated: number } }>,
  ptys: OrxaTerminalSession[] = []
): ProjectBootstrap {
  const sessionStatus = Object.fromEntries(sessions.map(session => [session.id, { type: 'idle' }]))
  return {
    directory,
    path: {},
    sessions,
    sessionStatus,
    providers: { all: [], connected: [], default: {} },
    agents: [],
    config: {},
    permissions: [],
    questions: [],
    commands: [],
    mcp: {},
    lsp: [],
    formatter: [],
    ptys,
  } as unknown as ProjectBootstrap
}

export function createRuntimeSnapshot(
  directory: string,
  sessionID: string,
  messages: SessionMessageBundle[] = []
): SessionRuntimeSnapshot {
  return {
    directory,
    sessionID,
    session: null,
    sessionStatus: undefined,
    permissions: [],
    questions: [],
    commands: [],
    messages,
    sessionDiff: [],
    executionLedger: { cursor: 0, records: [] },
    changeProvenance: { cursor: 0, records: [] },
  }
}

export function renderWorkspaceStateHook(overrides?: {
  setStatusLine?: (value: string) => void
  terminalTabIds?: string[]
  setTerminalTabs?: (tabs: Array<{ id: string; label: string }>) => void
  setActiveTerminalId?: (id: string | undefined) => void
  setTerminalOpen?: (open: boolean) => void
  onCleanupEmptySession?: (directory: string, sessionID: string) => Promise<void> | void
}) {
  return renderHook(() =>
    useWorkspaceState({
      setStatusLine: overrides?.setStatusLine ?? (() => undefined),
      terminalTabIds: overrides?.terminalTabIds ?? [],
      setTerminalTabs: overrides?.setTerminalTabs ?? (() => undefined),
      setActiveTerminalId: overrides?.setActiveTerminalId ?? (() => undefined),
      setTerminalOpen: overrides?.setTerminalOpen ?? (() => undefined),
      onCleanupEmptySession: overrides?.onCleanupEmptySession,
    })
  )
}
