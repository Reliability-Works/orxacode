import { useCallback, useEffect, useRef } from 'react'
import type { Event as OpencodeEvent, Session } from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap, SessionRuntimeSnapshot } from '@shared/ipc'
import type { TerminalTab } from '../components/TerminalPanel'
import { makeUnifiedSessionKey } from '../state/unified-runtime'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  applyOpencodeProjectEvent,
  applyOpencodeSessionEvent,
  normalizeMessageBundles,
} from '../lib/opencode-event-reducer'
import { getPersistedOpencodeState, mergeOpencodeMessages } from './opencode-session-storage'
import {
  extractEventSessionID,
  loadOpencodeRuntimeSnapshot,
  resolveRecoveredOpencodeSessionStatus,
} from './useWorkspaceState-shared'
import { useWorkspaceQueuedRefresh } from './useWorkspaceQueuedRefresh'
import type { SetMessages, SetProjectData, UnifiedRuntimeState } from './useWorkspaceState-store'

type UseWorkspaceStateProjectSyncArgs = {
  activeProjectDir?: string
  activeSessionID?: string
  terminalTabIds: string[]
  setStatusLine: (status: string) => void
  setTerminalTabs: (tabs: TerminalTab[]) => void
  setActiveTerminalId: (id: string | undefined) => void
  mergeProjectData?: (project: ProjectBootstrap) => ProjectBootstrap
  getRuntimeState: () => UnifiedRuntimeState
  setProjectData: SetProjectData
  setProjectDataForDirectory: (directory: string, data: ProjectBootstrap) => void
  setWorkspaceMeta: (directory: string, meta: { lastUpdatedAt?: number; lastOpenedAt?: number }) => void
  setOpencodeRuntimeSnapshot: (
    directory: string,
    sessionID: string,
    snapshot: SessionRuntimeSnapshot
  ) => void
  setOpencodeTodoItems: (
    directory: string,
    sessionID: string,
    items: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }>
  ) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setMessages: SetMessages
}

type RuntimeSnapshot = Awaited<ReturnType<typeof loadOpencodeRuntimeSnapshot>>

function computeLastUpdated(sessions: Array<{ time: { updated: number } }>) {
  return sessions.reduce((max, session) => Math.max(max, session.time.updated), 0)
}

function getStaleBusySessionIDs(
  sessions: Array<{ id: string; time: { updated: number } }>,
  sessionStatus: Record<string, { type?: string }>
) {
  return [...sessions]
    .sort((a, b) => b.time.updated - a.time.updated)
    .map(session => session.id)
    .filter(sessionID => {
      const statusType = sessionStatus[sessionID]?.type
      return statusType === 'busy' || statusType === 'retry'
    })
}

function resolveNextSessionID(
  currentActiveSessionID: string | undefined,
  sortedSessions: Array<{ id: string }>,
  sessionStatus: Record<string, { type?: string }>,
  setActiveSessionID: (sessionID: string | undefined) => void,
  setMessages: SetMessages
) {
  let nextSessionID = currentActiveSessionID
  if (nextSessionID && !sortedSessions.some(item => item.id === nextSessionID)) {
    const previousStatus = sessionStatus[nextSessionID]?.type
    const isPossiblyInFlight = previousStatus === 'busy' || previousStatus === 'retry'
    if (!isPossiblyInFlight) {
      nextSessionID = undefined
      setActiveSessionID(undefined)
      setMessages([])
    }
  }
  return nextSessionID
}

function useWorkspaceRuntimeProjection({ terminalTabIds, setTerminalTabs, setActiveTerminalId, mergeProjectData, getRuntimeState, setProjectData, setProjectDataForDirectory, setWorkspaceMeta, setOpencodeRuntimeSnapshot }: Pick<UseWorkspaceStateProjectSyncArgs, 'terminalTabIds' | 'setTerminalTabs' | 'setActiveTerminalId' | 'mergeProjectData' | 'getRuntimeState' | 'setProjectData' | 'setProjectDataForDirectory' | 'setWorkspaceMeta' | 'setOpencodeRuntimeSnapshot'>) {
  const buildRuntimeProjectSlice = useCallback(
    (
      directory: string,
      runtime: {
        sessionID: string
        sessionStatus?: ProjectBootstrap['sessionStatus'][string]
        permissions?: ProjectBootstrap['permissions']
        questions?: ProjectBootstrap['questions']
        commands?: ProjectBootstrap['commands']
      }
    ) => {
      const cachedProject = getRuntimeState().projectDataByDirectory[directory]
      const cachedStatus = cachedProject?.sessionStatus?.[runtime.sessionID]
      return {
        directory,
        sessionStatus: {
          ...(cachedProject?.sessionStatus ?? {}),
          [runtime.sessionID]: resolveRecoveredOpencodeSessionStatus(runtime.sessionStatus, cachedStatus),
        },
        permissions: runtime.permissions ?? [],
        questions: runtime.questions ?? [],
        commands: runtime.commands ?? [],
      }
    },
    [getRuntimeState]
  )

  const commitProjectData = useCallback(
    (directory: string, project: ProjectBootstrap) => {
      const merged = mergeProjectData ? mergeProjectData(project) : project
      setProjectDataForDirectory(directory, merged)
      const runtimeState = getRuntimeState()
      if (runtimeState.activeWorkspaceDirectory === directory) {
        setProjectData(merged)
      }
      setWorkspaceMeta(directory, { lastUpdatedAt: computeLastUpdated(merged.sessions) })
      return merged
    },
    [getRuntimeState, mergeProjectData, setProjectData, setProjectDataForDirectory, setWorkspaceMeta]
  )

  const syncTerminalTabs = useCallback(
    (ptys: Array<{ id: string }>) => {
      const serverPtyIds = ptys.map(p => p.id)
      const hasValidTab = terminalTabIds.some(id => serverPtyIds.includes(id))
      if (!hasValidTab && serverPtyIds.length > 0) {
        setTerminalTabs(ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })))
        setActiveTerminalId(ptys[0]?.id)
      }
    },
    [setActiveTerminalId, setTerminalTabs, terminalTabIds]
  )

  const applyRuntimeSnapshot = useCallback(
    (directory: string, sessionID: string, runtime: RuntimeSnapshot, mergePersisted = false) => {
      const normalized = normalizeMessageBundles(runtime.messages)
      const messages = mergePersisted
        ? mergeOpencodeMessages(
            normalized,
            getPersistedOpencodeState(makeUnifiedSessionKey('opencode', directory, sessionID)).messages
          )
        : normalized
      const runtimeProject = buildRuntimeProjectSlice(directory, runtime)
      setOpencodeRuntimeSnapshot(directory, sessionID, {
        ...runtime,
        sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[sessionID],
        permissions: runtimeProject.permissions,
        questions: runtimeProject.questions,
        commands: runtimeProject.commands,
        messages,
      })
      return messages
    },
    [buildRuntimeProjectSlice, setOpencodeRuntimeSnapshot]
  )

  return { buildRuntimeProjectSlice, commitProjectData, syncTerminalTabs, applyRuntimeSnapshot }
}

function useWorkspaceRefreshActions({
  activeProjectDir,
  activeSessionID,
  setStatusLine,
  getRuntimeState,
  setProjectData,
  setActiveSessionID,
  setMessages,
  projection,
}: {
  activeProjectDir?: string
  activeSessionID?: string
  setStatusLine: (status: string) => void
  getRuntimeState: () => UnifiedRuntimeState
  setProjectData: SetProjectData
  setActiveSessionID: (sessionID: string | undefined) => void
  setMessages: SetMessages
  projection: ReturnType<typeof useWorkspaceRuntimeProjection>
}) {
  const refreshProject = useCallback(
    async (directory: string, skipMessageLoad = false) => {
      try {
        const data = await window.orxa.opencode.refreshProject(directory)
        const merged = projection.commitProjectData(directory, data)
        const currentState = getRuntimeState()
        if (currentState.activeWorkspaceDirectory === directory) {
          setProjectData(merged)
        }
        const sortedSessions = [...merged.sessions].sort((a, b) => b.time.updated - a.time.updated)
        const staleBusySessionIDs = getStaleBusySessionIDs(merged.sessions, merged.sessionStatus)
        const currentActiveSessionID =
          currentState.activeWorkspaceDirectory === directory ? currentState.activeSessionID : undefined
        const sessionStatusSlice = currentState.projectDataByDirectory[directory]?.sessionStatus
        const nextSessionID = resolveNextSessionID(
          currentActiveSessionID,
          sortedSessions,
          sessionStatusSlice ?? {},
          setActiveSessionID,
          setMessages
        )

        projection.syncTerminalTabs(merged.ptys)

        if (nextSessionID && !skipMessageLoad) {
          const latest = await loadOpencodeRuntimeSnapshot(directory, nextSessionID).catch(
            () => undefined
          )
          if (latest && getRuntimeState().activeSessionID === nextSessionID) {
            projection.applyRuntimeSnapshot(directory, nextSessionID, latest)
          }
        }

        for (const busySessionID of staleBusySessionIDs) {
          if (busySessionID === nextSessionID && !skipMessageLoad) {
            continue
          }
          void loadOpencodeRuntimeSnapshot(directory, busySessionID)
            .then(runtime => {
              projection.applyRuntimeSnapshot(directory, busySessionID, runtime)
            })
            .catch(() => undefined)
        }

        return merged
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    [
      getRuntimeState,
      projection,
      setActiveSessionID,
      setMessages,
      setProjectData,
      setStatusLine,
    ]
  )

  const refreshMessages = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return undefined
    }

    try {
      const sessionAtStart = activeSessionID
      if (getRuntimeState().activeSessionID !== sessionAtStart) {
        return undefined
      }
      const runtime = await loadOpencodeRuntimeSnapshot(activeProjectDir, sessionAtStart)
      if (getRuntimeState().activeSessionID === sessionAtStart) {
        projection.applyRuntimeSnapshot(activeProjectDir, sessionAtStart, runtime, true)
      }
      return runtime
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }, [activeProjectDir, activeSessionID, getRuntimeState, projection, setStatusLine])

  return {
    refreshProject,
    refreshMessages,
  }
}

function useWorkspaceResponsePolling({
  getRuntimeState,
  projection,
}: {
  getRuntimeState: () => UnifiedRuntimeState
  projection: ReturnType<typeof useWorkspaceRuntimeProjection>
}) {
  const responsePollTimer = useRef<number | undefined>(undefined)

  const stopResponsePolling = useCallback(() => {
    if (responsePollTimer.current) {
      window.clearTimeout(responsePollTimer.current)
      responsePollTimer.current = undefined
    }
  }, [])

  const startResponsePolling = useCallback(
    (directory: string, sessionID: string) => {
      stopResponsePolling()
      const poll = () => {
        responsePollTimer.current = window.setTimeout(() => {
          const state = getRuntimeState()
          if (state.activeWorkspaceDirectory !== directory || state.activeSessionID !== sessionID) {
            stopResponsePolling()
            return
          }
          void loadOpencodeRuntimeSnapshot(directory, sessionID)
            .then(runtime => {
              const merged = projection.applyRuntimeSnapshot(directory, sessionID, runtime, true)
              const sessionStatusType = (
                (runtime.sessionStatus as { type?: string } | undefined)?.type ?? ''
              ).toLowerCase()
              const shouldContinue =
                merged.length === 0 ||
                sessionStatusType.includes('busy') ||
                sessionStatusType.includes('running') ||
                sessionStatusType.includes('retry')
              if (shouldContinue) {
                poll()
                return
              }
              stopResponsePolling()
            })
            .catch(() => {
              stopResponsePolling()
            })
        }, 700)
      }
      poll()
    },
    [getRuntimeState, projection, stopResponsePolling]
  )

  useEffect(() => {
    return () => {
      stopResponsePolling()
    }
  }, [stopResponsePolling])

  return {
    startResponsePolling,
    stopResponsePolling,
  }
}

function useWorkspaceStreamEvents({
  getRuntimeState,
  projection,
  setOpencodeTodoItems,
  setOpencodeRuntimeSnapshot,
}: Pick<
  UseWorkspaceStateProjectSyncArgs,
  'getRuntimeState' | 'setOpencodeTodoItems' | 'setOpencodeRuntimeSnapshot'
> & { projection: ReturnType<typeof useWorkspaceRuntimeProjection> }) {
  return useCallback(
    (directory: string, event: OpencodeEvent) => {
      const state = getRuntimeState()
      const existingProject = state.projectDataByDirectory[directory]
      const nextProject = applyOpencodeProjectEvent(existingProject ?? null, event)
      if (nextProject) {
        const normalizedSessions = [...nextProject.sessions].sort(
          (left: Session, right: Session) => right.time.updated - left.time.updated
        )
        projection.commitProjectData(directory, { ...nextProject, sessions: normalizedSessions })
      }

      const eventSessionID = extractEventSessionID(event)
      if (!eventSessionID) {
        return
      }

      const opencodeSessionKey = makeUnifiedSessionKey('opencode', directory, eventSessionID)
      const currentRuntime = useUnifiedRuntimeStore.getState().opencodeSessions[opencodeSessionKey]
      const applied = applyOpencodeSessionEvent({
        directory,
        sessionID: eventSessionID,
        snapshot: currentRuntime?.runtimeSnapshot ?? null,
        messages: currentRuntime?.messages ?? [],
        event,
      })

      if (applied.todoItems) {
        setOpencodeTodoItems(
          directory,
          eventSessionID,
          applied.todoItems.map((item, index) => ({
            id: `todo-${index}`,
            content: item.content ?? '',
            status:
              item.status === 'completed'
                ? 'completed'
                : item.status === 'in_progress'
                  ? 'in_progress'
                  : item.status === 'cancelled'
                    ? 'cancelled'
                    : 'pending',
          }))
        )
      }

      if (!applied.changed || !applied.snapshot) {
        return
      }
      setOpencodeRuntimeSnapshot(directory, eventSessionID, {
        ...applied.snapshot,
        messages: normalizeMessageBundles(applied.messages),
      })
    },
    [getRuntimeState, projection, setOpencodeRuntimeSnapshot, setOpencodeTodoItems]
  )
}

export function useWorkspaceStateProjectSync(args: UseWorkspaceStateProjectSyncArgs) {
  const projection = useWorkspaceRuntimeProjection(args)
  const refresh = useWorkspaceRefreshActions({
    activeProjectDir: args.activeProjectDir,
    activeSessionID: args.activeSessionID,
    setStatusLine: args.setStatusLine,
    getRuntimeState: args.getRuntimeState,
    setProjectData: args.setProjectData,
    setActiveSessionID: args.setActiveSessionID,
    setMessages: args.setMessages,
    projection,
  })
  const polling = useWorkspaceResponsePolling({
    getRuntimeState: args.getRuntimeState,
    projection,
  })
  const queued = useWorkspaceQueuedRefresh({
    activeProjectDir: args.activeProjectDir,
    refreshProject: refresh.refreshProject,
    refreshMessages: refresh.refreshMessages,
    setStatusLine: args.setStatusLine,
  })
  const applyOpencodeStreamEvent = useWorkspaceStreamEvents({
    getRuntimeState: args.getRuntimeState,
    projection,
    setOpencodeTodoItems: args.setOpencodeTodoItems,
    setOpencodeRuntimeSnapshot: args.setOpencodeRuntimeSnapshot,
  })

  return {
    applyRuntimeSnapshot: projection.applyRuntimeSnapshot,
    buildRuntimeProjectSlice: projection.buildRuntimeProjectSlice,
    refreshProject: refresh.refreshProject,
    refreshMessages: refresh.refreshMessages,
    applyOpencodeStreamEvent,
    queueRefresh: queued.queueRefresh,
    startResponsePolling: polling.startResponsePolling,
    stopResponsePolling: polling.stopResponsePolling,
  }
}
