import { useCallback } from 'react'
import type { ProjectBootstrap, SessionMessageBundle } from '@shared/ipc'
import type { TerminalTab } from '../components/TerminalPanel'
import { makeUnifiedSessionKey } from '../state/unified-runtime'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import { getPersistedOpencodeState } from './opencode-session-storage'
import {
  loadOpencodeRuntimeSnapshot,
  type SelectProjectOptions,
  type SidebarMode,
} from './useWorkspaceState-shared'
import type { SetProjectData, UnifiedRuntimeState } from './useWorkspaceState-store'
import { measurePerf } from '../lib/performance'

type ApplyRuntimeSnapshot = (
  directory: string,
  sessionID: string,
  runtime: Awaited<ReturnType<typeof loadOpencodeRuntimeSnapshot>>,
  mergePersisted?: boolean
) => SessionMessageBundle[]

type WorkspaceProjectSelectionArgs = {
  setStatusLine: (status: string) => void
  setTerminalTabs: (tabs: TerminalTab[]) => void
  setActiveTerminalId: (id: string | undefined) => void
  setTerminalOpen: (open: boolean) => void
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  getRuntimeState: () => UnifiedRuntimeState
  setSidebarMode: (mode: SidebarMode) => void
  setCollapsedProjects: (
    updater:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setPendingSessionId: (sessionID: string | undefined) => void
  setProjectData: SetProjectData
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  setWorkspaceMeta: (
    directory: string,
    meta: { lastUpdatedAt?: number; lastOpenedAt?: number }
  ) => void
  cleanupEmptySession: (sessionID: string | undefined) => Promise<void>
}

function useWorkspaceSessionSelection({
  shouldSkipRuntimeSessionLoad,
  getRuntimeState,
  setActiveProjectDir,
  setActiveSessionID,
  setOpencodeMessages,
  cleanupEmptySession,
  applyRuntimeSnapshot,
}: {
  shouldSkipRuntimeSessionLoad?: (directory: string, sessionID: string) => boolean
  getRuntimeState: () => UnifiedRuntimeState
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    messages: SessionMessageBundle[]
  ) => void
  cleanupEmptySession: (sessionID: string | undefined) => Promise<void>
  applyRuntimeSnapshot: ApplyRuntimeSnapshot
}) {
  return useCallback(
    async (sessionID: string, directoryOverride?: string) => {
      const targetDirectory = directoryOverride ?? getRuntimeState().activeWorkspaceDirectory
      if (!targetDirectory) return
      const currentSessionID = getRuntimeState().activeSessionID
      if (currentSessionID && currentSessionID !== sessionID) {
        await cleanupEmptySession(currentSessionID)
      }
      setActiveProjectDir(targetDirectory)
      setActiveSessionID(sessionID)
      if (shouldSkipRuntimeSessionLoad?.(targetDirectory, sessionID)) return
      const storeKey = makeUnifiedSessionKey('opencode', targetDirectory, sessionID)
      const existing = useUnifiedRuntimeStore.getState().opencodeSessions[storeKey]
      if (!existing?.messages?.length) {
        const persisted = getPersistedOpencodeState(storeKey)
        if (persisted.messages.length > 0) {
          setOpencodeMessages(targetDirectory, sessionID, persisted.messages)
        }
      }
      void loadOpencodeRuntimeSnapshot(targetDirectory, sessionID)
        .then(runtime => {
          if (getRuntimeState().activeSessionID === sessionID) {
            applyRuntimeSnapshot(targetDirectory, sessionID, runtime)
          }
        })
        .catch(() => undefined)
    },
    [
      applyRuntimeSnapshot,
      cleanupEmptySession,
      getRuntimeState,
      setActiveProjectDir,
      setActiveSessionID,
      setOpencodeMessages,
      shouldSkipRuntimeSessionLoad,
    ]
  )
}

function useWorkspaceProjectSelection({
  setStatusLine,
  setTerminalTabs,
  setActiveTerminalId,
  setTerminalOpen,
  mergeProjectData,
  getRuntimeState,
  setSidebarMode,
  setCollapsedProjects,
  setActiveProjectDir,
  setActiveSessionID,
  setPendingSessionId,
  setProjectData,
  setProjectDataForDirectory,
  setWorkspaceMeta,
  cleanupEmptySession,
}: WorkspaceProjectSelectionArgs) {
  const selectProject = useCallback(
    async (directory: string, options?: SelectProjectOptions) => {
      const showLanding = options?.showLanding ?? true
      const nextSessionID = showLanding ? undefined : options?.sessionID
      try {
        await cleanupEmptySession(getRuntimeState().activeSessionID)
        setStatusLine(`Loading workspace ${directory}`)
        const cached = getRuntimeState().projectDataByDirectory[directory]
        setProjectData(cached ?? null)
        setActiveSessionID(nextSessionID)
        setTerminalOpen(false)
        setTerminalTabs([])
        setActiveTerminalId(undefined)
        setActiveProjectDir(directory)
        setSidebarMode('projects')
        setCollapsedProjects(current => ({ ...current, [directory]: false }))
        const data = await measurePerf(
          {
            surface: 'workspace',
            metric: 'workspace.select_ms',
            kind: 'span',
            unit: 'ms',
            process: 'renderer',
            component: 'workspace-selection-actions',
            workspaceHash: directory,
          },
          () => window.orxa.opencode.selectProject(directory)
        )
        const merged = mergeProjectData ? mergeProjectData(data) : data
        setProjectDataForDirectory(directory, merged)
        setProjectData(merged)
        const lastUpdated = merged.sessions.reduce(
          (max, session) => Math.max(max, session.time.updated),
          0
        )
        setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated, lastOpenedAt: Date.now() })
        setTerminalTabs(merged.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })))
        setActiveTerminalId(merged.ptys[0]?.id)
        setActiveSessionID(nextSessionID)
        setStatusLine(`Loaded ${directory}`)
      } catch (error) {
        setPendingSessionId(undefined)
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [
      cleanupEmptySession,
      getRuntimeState,
      mergeProjectData,
      setActiveProjectDir,
      setActiveSessionID,
      setActiveTerminalId,
      setCollapsedProjects,
      setPendingSessionId,
      setProjectData,
      setProjectDataForDirectory,
      setSidebarMode,
      setStatusLine,
      setTerminalOpen,
      setTerminalTabs,
      setWorkspaceMeta,
    ]
  )

  const openWorkspaceDashboard = useCallback(async () => {
    await cleanupEmptySession(getRuntimeState().activeSessionID)
    setSidebarMode('projects')
    setActiveProjectDir(undefined)
    setProjectData(null)
    setActiveSessionID(undefined)
    setTerminalOpen(false)
    setTerminalTabs([])
    setActiveTerminalId(undefined)
    setStatusLine('Workspace dashboard')
  }, [
    cleanupEmptySession,
    getRuntimeState,
    setActiveProjectDir,
    setActiveSessionID,
    setActiveTerminalId,
    setProjectData,
    setSidebarMode,
    setStatusLine,
    setTerminalOpen,
    setTerminalTabs,
  ])

  return { selectProject, openWorkspaceDashboard }
}

export function useWorkspaceSelectionActions(args: {
  setStatusLine: (status: string) => void
  setTerminalTabs: (tabs: TerminalTab[]) => void
  setActiveTerminalId: (id: string | undefined) => void
  setTerminalOpen: (open: boolean) => void
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  shouldSkipRuntimeSessionLoad?: (directory: string, sessionID: string) => boolean
  getRuntimeState: () => UnifiedRuntimeState
  setSidebarMode: (mode: SidebarMode) => void
  setCollapsedProjects: (
    updater:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  setActiveProjectDir: (directory: string | undefined) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setPendingSessionId: (sessionID: string | undefined) => void
  setProjectData: SetProjectData
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  setWorkspaceMeta: (
    directory: string,
    meta: { lastUpdatedAt?: number; lastOpenedAt?: number }
  ) => void
  setOpencodeMessages: (
    directory: string,
    sessionID: string,
    messages: SessionMessageBundle[]
  ) => void
  cleanupEmptySession: (sessionID: string | undefined) => Promise<void>
  applyRuntimeSnapshot: ApplyRuntimeSnapshot
}) {
  const selection = useWorkspaceProjectSelection(args)
  const selectSession = useWorkspaceSessionSelection({
    shouldSkipRuntimeSessionLoad: args.shouldSkipRuntimeSessionLoad,
    getRuntimeState: args.getRuntimeState,
    setActiveProjectDir: args.setActiveProjectDir,
    setActiveSessionID: args.setActiveSessionID,
    setOpencodeMessages: args.setOpencodeMessages,
    cleanupEmptySession: args.cleanupEmptySession,
    applyRuntimeSnapshot: args.applyRuntimeSnapshot,
  })

  return {
    selectProject: selection.selectProject,
    openWorkspaceDashboard: selection.openWorkspaceDashboard,
    selectSession,
  }
}
