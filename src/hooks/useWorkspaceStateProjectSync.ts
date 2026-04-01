import { useCallback, useEffect, useRef } from 'react'
import type { Event as OpencodeEvent, Session } from '@opencode-ai/sdk/v2/client'
import type { ProjectBootstrap, ProjectRefreshDelta, SessionRuntimeSnapshot } from '@shared/ipc'
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
import { measurePerf, reportPerf } from '../lib/performance'

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
  setWorkspaceMeta: (
    directory: string,
    meta: { lastUpdatedAt?: number; lastOpenedAt?: number }
  ) => void
  setOpencodeRuntimeSnapshot: (
    directory: string,
    sessionID: string,
    snapshot: SessionRuntimeSnapshot
  ) => void
  setOpencodeTodoItems: (
    directory: string,
    sessionID: string,
    items: Array<{
      id: string
      content: string
      status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    }>
  ) => void
  setActiveSessionID: (sessionID: string | undefined) => void
  setMessages: SetMessages
}

type RuntimeSnapshot = Awaited<ReturnType<typeof loadOpencodeRuntimeSnapshot>>
const BACKGROUND_REFRESH_COOLDOWN_MS = 1_500

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

function useWorkspaceRuntimeProjection({
  terminalTabIds,
  setTerminalTabs,
  setActiveTerminalId,
  mergeProjectData,
  getRuntimeState,
  setProjectData,
  setProjectDataForDirectory,
  setWorkspaceMeta,
  setOpencodeRuntimeSnapshot,
}: Pick<
  UseWorkspaceStateProjectSyncArgs,
  | 'terminalTabIds'
  | 'setTerminalTabs'
  | 'setActiveTerminalId'
  | 'mergeProjectData'
  | 'getRuntimeState'
  | 'setProjectData'
  | 'setProjectDataForDirectory'
  | 'setWorkspaceMeta'
  | 'setOpencodeRuntimeSnapshot'
>) {
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
          [runtime.sessionID]: resolveRecoveredOpencodeSessionStatus(
            runtime.sessionStatus,
            cachedStatus
          ),
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
    [
      getRuntimeState,
      mergeProjectData,
      setProjectData,
      setProjectDataForDirectory,
      setWorkspaceMeta,
    ]
  )

  const commitProjectDelta = useCallback(
    (directory: string, delta: ProjectRefreshDelta) => {
      const runtimeState = getRuntimeState()
      const cachedProject = runtimeState.projectDataByDirectory[directory]
      if (!cachedProject) {
        throw new Error(`Cannot apply project delta before bootstrap for ${directory}`)
      }
      const mergedProject: ProjectBootstrap = {
        ...cachedProject,
        sessions: delta.sessions,
        sessionStatus: delta.sessionStatus,
        permissions: delta.permissions,
        questions: delta.questions,
        commands: delta.commands,
        ptys: delta.ptys,
      }
      return commitProjectData(directory, mergedProject)
    },
    [commitProjectData, getRuntimeState]
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
            getPersistedOpencodeState(makeUnifiedSessionKey('opencode', directory, sessionID))
              .messages
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

  return {
    buildRuntimeProjectSlice,
    commitProjectData,
    commitProjectDelta,
    syncTerminalTabs,
    applyRuntimeSnapshot,
  }
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
  const runtimeLoadInFlightRef = useRef(new Map<string, Promise<RuntimeSnapshot | undefined>>())
  const projectRefreshInFlightRef = useRef(new Map<string, Promise<ProjectBootstrap>>())
  const projectRefreshLastAtRef = useRef(new Map<string, number>())

  const loadRuntimeForSession = useCallback(
    (
      directory: string,
      sessionID: string,
      options?: { bypassCache?: boolean; reuseWindowMs?: number }
    ) => {
      const key = `${directory}::${sessionID}`
      const inFlight = runtimeLoadInFlightRef.current.get(key)
      if (inFlight) {
        return inFlight
      }
      const request = loadOpencodeRuntimeSnapshot(directory, sessionID, {
        bypassCache: options?.bypassCache,
        reuseWindowMs: options?.reuseWindowMs,
      })
        .then(runtime => runtime)
        .catch(error => {
          setStatusLine(error instanceof Error ? error.message : String(error))
          return undefined
        })
        .finally(() => {
          runtimeLoadInFlightRef.current.delete(key)
        })
      runtimeLoadInFlightRef.current.set(key, request)
      return request
    },
    [setStatusLine]
  )

  const refreshProject = useCallback(
    async (directory: string, skipMessageLoad = false) => {
      const inFlightRefresh = projectRefreshInFlightRef.current.get(directory)
      if (inFlightRefresh) {
        return inFlightRefresh
      }

      if (skipMessageLoad) {
        const lastRefreshedAt = projectRefreshLastAtRef.current.get(directory) ?? 0
        if (Date.now() - lastRefreshedAt < BACKGROUND_REFRESH_COOLDOWN_MS) {
          const cachedProject = getRuntimeState().projectDataByDirectory[directory]
          if (cachedProject) {
            return cachedProject
          }
        }
      }

      const refreshPromise = (async () => {
        try {
          const useDeltaRefresh = skipMessageLoad
            ? Boolean(getRuntimeState().projectDataByDirectory[directory])
            : false
          const data = await measurePerf(
            {
              surface: 'workspace',
              metric: 'workspace.refresh_ms',
              kind: 'span',
              unit: 'ms',
              process: 'renderer',
              component: 'workspace-state-project-sync',
              workspaceHash: directory,
            },
            () =>
              useDeltaRefresh
                ? window.orxa.opencode.refreshProjectDelta(directory)
                : window.orxa.opencode.refreshProject(directory)
          )
          const merged = useDeltaRefresh
            ? projection.commitProjectDelta(directory, data as ProjectRefreshDelta)
            : projection.commitProjectData(directory, data as ProjectBootstrap)
          const currentState = getRuntimeState()
          if (currentState.activeWorkspaceDirectory === directory) {
            setProjectData(merged)
          }
          const sortedSessions = [...merged.sessions].sort(
            (a, b) => b.time.updated - a.time.updated
          )
          const staleBusySessionIDs = getStaleBusySessionIDs(merged.sessions, merged.sessionStatus)
          const currentActiveSessionID =
            currentState.activeWorkspaceDirectory === directory
              ? currentState.activeSessionID
              : undefined
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
            const latest = await loadRuntimeForSession(directory, nextSessionID, {
              reuseWindowMs: 900,
            })
            if (latest && getRuntimeState().activeSessionID === nextSessionID) {
              projection.applyRuntimeSnapshot(directory, nextSessionID, latest)
            }
          }

          for (const busySessionID of staleBusySessionIDs) {
            if (busySessionID === nextSessionID && !skipMessageLoad) {
              continue
            }
            void loadRuntimeForSession(directory, busySessionID, { reuseWindowMs: 900 }).then(
              runtime => {
                if (!runtime) {
                  return
                }
                projection.applyRuntimeSnapshot(directory, busySessionID, runtime)
              }
            )
          }

          projectRefreshLastAtRef.current.set(directory, Date.now())
          return merged
        } catch (error) {
          setStatusLine(error instanceof Error ? error.message : String(error))
          throw error
        }
      })().finally(() => {
        projectRefreshInFlightRef.current.delete(directory)
      })

      projectRefreshInFlightRef.current.set(directory, refreshPromise)
      return refreshPromise
    },
    [
      getRuntimeState,
      loadRuntimeForSession,
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
      const startedAt = performance.now()
      const runtime = await measurePerf(
        {
          surface: 'session',
          metric: 'session.runtime.load_ms',
          kind: 'span',
          unit: 'ms',
          process: 'renderer',
          component: 'workspace-state-project-sync',
          workspaceHash: activeProjectDir,
          sessionHash: sessionAtStart,
        },
        () =>
          loadRuntimeForSession(activeProjectDir, sessionAtStart, {
            reuseWindowMs: 900,
          }).then(snapshot => {
            if (!snapshot) {
              throw new Error('runtime snapshot unavailable')
            }
            return snapshot
          })
      )
      reportPerf({
        surface: 'session',
        metric: 'session.messages.load_ms',
        kind: 'span',
        value: performance.now() - startedAt,
        unit: 'ms',
        process: 'renderer',
        component: 'workspace-state-project-sync',
        workspaceHash: activeProjectDir,
        sessionHash: sessionAtStart,
      })
      if (getRuntimeState().activeSessionID === sessionAtStart) {
        projection.applyRuntimeSnapshot(activeProjectDir, sessionAtStart, runtime, true)
      }
      return runtime
    } catch {
      return undefined
    }
  }, [activeProjectDir, activeSessionID, getRuntimeState, loadRuntimeForSession, projection])

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
  const promptLifecycleRef = useRef<
    Record<
      string,
      { startedAt: number; firstEventRecorded: boolean; firstAssistantRecorded: boolean }
    >
  >({})

  const stopResponsePolling = useCallback(() => {
    if (responsePollTimer.current) {
      window.clearTimeout(responsePollTimer.current)
      responsePollTimer.current = undefined
    }
  }, [])

  const startResponsePolling = useCallback(
    (directory: string, sessionID: string) => {
      stopResponsePolling()
      const lifecycleKey = `${directory}::${sessionID}`
      promptLifecycleRef.current[lifecycleKey] = {
        startedAt: performance.now(),
        firstEventRecorded: false,
        firstAssistantRecorded: false,
      }
      const poll = () => {
        responsePollTimer.current = window.setTimeout(() => {
          const state = getRuntimeState()
          if (state.activeWorkspaceDirectory !== directory || state.activeSessionID !== sessionID) {
            stopResponsePolling()
            return
          }
          void measurePerf(
            {
              surface: 'background',
              metric: 'background.poll_ms',
              kind: 'span',
              unit: 'ms',
              process: 'renderer',
              trigger: 'poll',
              component: 'workspace-response-polling',
              workspaceHash: directory,
              sessionHash: sessionID,
            },
            () => loadOpencodeRuntimeSnapshot(directory, sessionID, { reuseWindowMs: 900 })
          )
            .then(runtime => {
              reportPerf({
                surface: 'background',
                metric: 'background.poll_count',
                kind: 'counter',
                value: 1,
                unit: 'count',
                process: 'renderer',
                trigger: 'poll',
                component: 'workspace-response-polling',
                workspaceHash: directory,
                sessionHash: sessionID,
              })
              const merged = projection.applyRuntimeSnapshot(directory, sessionID, runtime, true)
              const lifecycle = promptLifecycleRef.current[lifecycleKey]
              if (lifecycle && !lifecycle.firstEventRecorded) {
                lifecycle.firstEventRecorded = true
                reportPerf({
                  surface: 'session',
                  metric: 'prompt.first_event_ms',
                  kind: 'span',
                  value: performance.now() - lifecycle.startedAt,
                  unit: 'ms',
                  process: 'renderer',
                  component: 'workspace-response-polling',
                  workspaceHash: directory,
                  sessionHash: sessionID,
                })
              }
              if (
                lifecycle &&
                !lifecycle.firstAssistantRecorded &&
                merged.some(message => message.info.role === 'assistant')
              ) {
                lifecycle.firstAssistantRecorded = true
                reportPerf({
                  surface: 'session',
                  metric: 'prompt.first_assistant_output_ms',
                  kind: 'span',
                  value: performance.now() - lifecycle.startedAt,
                  unit: 'ms',
                  process: 'renderer',
                  component: 'workspace-response-polling',
                  workspaceHash: directory,
                  sessionHash: sessionID,
                })
              }
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
              if (lifecycle) {
                reportPerf({
                  surface: 'session',
                  metric: 'prompt.complete_ms',
                  kind: 'span',
                  value: performance.now() - lifecycle.startedAt,
                  unit: 'ms',
                  process: 'renderer',
                  component: 'workspace-response-polling',
                  workspaceHash: directory,
                  sessionHash: sessionID,
                })
                delete promptLifecycleRef.current[lifecycleKey]
              }
              stopResponsePolling()
            })
            .catch(() => {
              delete promptLifecycleRef.current[lifecycleKey]
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
