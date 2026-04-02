import { useCallback, useEffect, useRef } from 'react'
import type { Event as OpencodeEvent, Session } from '@opencode-ai/sdk/v2/client'
import type {
  ProjectBootstrap,
  ProjectRefreshCold,
  ProjectRefreshDelta,
  SessionRuntimeSnapshot,
} from '@shared/ipc'
import type { TerminalTab } from '../components/TerminalPanel'
import { makeUnifiedSessionKey } from '../state/unified-runtime'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'
import {
  applyOpencodeProjectEvent,
  applyOpencodeSessionEvent,
  normalizeMessageBundles,
} from '../lib/opencode-event-reducer'
import { getPersistedOpencodeState, mergeOpencodeMessages } from './opencode-session-storage'
import { setPersistedOpencodeState } from './opencode-session-storage'
import {
  extractEventSessionID,
  loadOpencodeRuntimeSnapshot,
  resolveRecoveredOpencodeSessionStatus,
} from './useWorkspaceState-shared'
import { useWorkspaceQueuedRefresh } from './useWorkspaceQueuedRefresh'
import type { SetMessages, SetProjectData, UnifiedRuntimeState } from './useWorkspaceState-store'
import { measurePerf, reportPerf } from '../lib/performance'
import { persistProjectSessions } from '../state/unified-runtime-store-helpers'

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
const RUNTIME_EXTRAS_REUSE_WINDOW_MS = 12_000
const PROJECT_COLD_REFRESH_REUSE_WINDOW_MS = 45_000
const MAX_STREAM_EVENT_BATCH_SIZE = 100

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
  const runtimeExtrasInFlightRef = useRef(new Map<string, Promise<void>>())
  const runtimeExtrasLastAtRef = useRef(new Map<string, number>())

  const queueRuntimeExtrasHydration = useCallback(
    (directory: string, sessionID: string) => {
      const key = `${directory}::${sessionID}`
      const lastHydratedAt = runtimeExtrasLastAtRef.current.get(key) ?? 0
      if (Date.now() - lastHydratedAt < RUNTIME_EXTRAS_REUSE_WINDOW_MS) {
        return
      }
      const inFlight = runtimeExtrasInFlightRef.current.get(key)
      if (inFlight) {
        return
      }

      const runtimeKey = makeUnifiedSessionKey('opencode', directory, sessionID)
      const opencodeBridge = window.orxa?.opencode
      if (!opencodeBridge) {
        return
      }
      const existingRuntime = getRuntimeState().opencodeSessions[runtimeKey]?.runtimeSnapshot
      const request = Promise.all([
        opencodeBridge.loadSessionDiff
          ? opencodeBridge.loadSessionDiff(directory, sessionID).catch(() => [])
          : Promise.resolve(existingRuntime?.sessionDiff ?? []),
        opencodeBridge.loadExecutionLedger
          ? opencodeBridge
              .loadExecutionLedger(directory, sessionID, 0)
              .catch(() => ({ cursor: 0, records: [] }))
          : Promise.resolve(existingRuntime?.executionLedger ?? { cursor: 0, records: [] }),
        opencodeBridge.loadChangeProvenance
          ? opencodeBridge
              .loadChangeProvenance(directory, sessionID, 0)
              .catch(() => ({ cursor: 0, records: [] }))
          : Promise.resolve(existingRuntime?.changeProvenance ?? { cursor: 0, records: [] }),
      ])
        .then(([sessionDiff, executionLedger, changeProvenance]) => {
          const currentRuntime = getRuntimeState().opencodeSessions[runtimeKey]?.runtimeSnapshot
          if (!currentRuntime) {
            return
          }
          setOpencodeRuntimeSnapshot(directory, sessionID, {
            ...currentRuntime,
            messages: normalizeMessageBundles(currentRuntime.messages),
            sessionDiff,
            executionLedger,
            changeProvenance,
          })
          runtimeExtrasLastAtRef.current.set(key, Date.now())
        })
        .catch(() => undefined)
        .finally(() => {
          runtimeExtrasInFlightRef.current.delete(key)
        })

      runtimeExtrasInFlightRef.current.set(key, request)
    },
    [getRuntimeState, setOpencodeRuntimeSnapshot]
  )

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
      const existingRuntime =
        getRuntimeState().opencodeSessions[makeUnifiedSessionKey('opencode', directory, sessionID)]
          ?.runtimeSnapshot
      const mergedSessionDiff =
        runtime.sessionDiff.length > 0
          ? runtime.sessionDiff
          : (existingRuntime?.sessionDiff ?? runtime.sessionDiff)
      const mergedExecutionLedger =
        runtime.executionLedger.cursor > 0 || runtime.executionLedger.records.length > 0
          ? runtime.executionLedger
          : (existingRuntime?.executionLedger ?? runtime.executionLedger)
      const mergedChangeProvenance =
        runtime.changeProvenance.cursor > 0 || runtime.changeProvenance.records.length > 0
          ? runtime.changeProvenance
          : (existingRuntime?.changeProvenance ?? runtime.changeProvenance)
      setOpencodeRuntimeSnapshot(directory, sessionID, {
        ...runtime,
        sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[sessionID],
        permissions: runtimeProject.permissions,
        questions: runtimeProject.questions,
        commands: runtimeProject.commands,
        messages,
        sessionDiff: mergedSessionDiff,
        executionLedger: mergedExecutionLedger,
        changeProvenance: mergedChangeProvenance,
      })
      if (
        mergedSessionDiff.length === 0 &&
        mergedExecutionLedger.records.length === 0 &&
        mergedChangeProvenance.records.length === 0
      ) {
        queueRuntimeExtrasHydration(directory, sessionID)
      }
      return messages
    },
    [
      buildRuntimeProjectSlice,
      getRuntimeState,
      queueRuntimeExtrasHydration,
      setOpencodeRuntimeSnapshot,
    ]
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
  const projectColdRefreshLastAtRef = useRef(new Map<string, number>())

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
          const cachedProject = getRuntimeState().projectDataByDirectory[directory]
          const canUseDeltaRefresh = Boolean(cachedProject)
          if (canUseDeltaRefresh && !projectColdRefreshLastAtRef.current.has(directory)) {
            projectColdRefreshLastAtRef.current.set(directory, Date.now())
          }

          let merged = canUseDeltaRefresh
            ? projection.commitProjectDelta(
                directory,
                (await measurePerf(
                  {
                    surface: 'workspace',
                    metric: 'workspace.refresh_ms',
                    kind: 'span',
                    unit: 'ms',
                    process: 'renderer',
                    component: 'workspace-state-project-sync',
                    workspaceHash: directory,
                  },
                  () => window.orxa.opencode.refreshProjectDelta(directory)
                )) as ProjectRefreshDelta
              )
            : projection.commitProjectData(
                directory,
                (await measurePerf(
                  {
                    surface: 'workspace',
                    metric: 'workspace.refresh_ms',
                    kind: 'span',
                    unit: 'ms',
                    process: 'renderer',
                    component: 'workspace-state-project-sync',
                    workspaceHash: directory,
                  },
                  () => window.orxa.opencode.refreshProject(directory)
                )) as ProjectBootstrap
              )

          if (!canUseDeltaRefresh) {
            projectColdRefreshLastAtRef.current.set(directory, Date.now())
          }

          const lastColdRefreshedAt = projectColdRefreshLastAtRef.current.get(directory) ?? 0
          const shouldRefreshCold =
            canUseDeltaRefresh &&
            Boolean(window.orxa.opencode.refreshProjectCold) &&
            (!skipMessageLoad ||
              Date.now() - lastColdRefreshedAt > PROJECT_COLD_REFRESH_REUSE_WINDOW_MS)
          if (shouldRefreshCold) {
            const coldData = (await window.orxa.opencode
              .refreshProjectCold(directory)
              .catch(() => undefined)) as ProjectRefreshCold | undefined
            if (coldData) {
              merged = projection.commitProjectData(directory, {
                ...merged,
                ...coldData,
              })
              projectColdRefreshLastAtRef.current.set(directory, Date.now())
            }
          }

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

function useWorkspaceStreamEvents() {
  const queuedEventsRef = useRef<Array<{ directory: string; event: OpencodeEvent }>>([])
  const flushScheduledRef = useRef(false)
  const flushQueuedEventsRef = useRef<() => void>(() => undefined)

  const scheduleFlush = useCallback((flushQueuedEvents: () => void, yieldToMacrotask = false) => {
    if (flushScheduledRef.current) {
      return
    }
    flushScheduledRef.current = true
    const runFlush = () => {
      flushScheduledRef.current = false
      flushQueuedEvents()
    }
    if (yieldToMacrotask) {
      window.setTimeout(runFlush, 0)
      return
    }
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(runFlush)
      return
    }
    Promise.resolve().then(runFlush)
  }, [])

  const flushQueuedEvents = useCallback(() => {
    const queuedEvents = queuedEventsRef.current.splice(0, MAX_STREAM_EVENT_BATCH_SIZE)
    if (queuedEvents.length === 0) {
      return
    }

    const startedAt = performance.now()
    reportPerf({
      surface: 'event_bus',
      metric: 'event.batch.size',
      kind: 'gauge',
      value: queuedEvents.length,
      unit: 'count',
      process: 'renderer',
      component: 'workspace-stream-events',
    })

    const persistedMessages = new Map<string, ReturnType<typeof normalizeMessageBundles>>()

    useUnifiedRuntimeStore.setState(state => {
      let nextProjectDataByDirectory = state.projectDataByDirectory
      let nextWorkspaceMetaByDirectory = state.workspaceMetaByDirectory
      let nextOpencodeSessions = state.opencodeSessions

      const getProjectSnapshot = (directory: string) =>
        nextProjectDataByDirectory[directory] ?? null
      const getSessionRuntime = (sessionKey: string) => nextOpencodeSessions[sessionKey]

      for (const queued of queuedEvents) {
        const { directory, event } = queued
        const nextProject = applyOpencodeProjectEvent(getProjectSnapshot(directory), event)
        if (nextProject) {
          const normalizedSessions = [...nextProject.sessions].sort(
            (left: Session, right: Session) => right.time.updated - left.time.updated
          )
          if (nextProjectDataByDirectory === state.projectDataByDirectory) {
            nextProjectDataByDirectory = { ...nextProjectDataByDirectory }
          }
          nextProjectDataByDirectory[directory] = {
            ...nextProject,
            sessions: normalizedSessions,
          }
          persistProjectSessions(directory, normalizedSessions)

          const previousMeta = nextWorkspaceMetaByDirectory[directory]
          const nextLastUpdatedAt = computeLastUpdated(normalizedSessions)
          if (!previousMeta || previousMeta.lastUpdatedAt !== nextLastUpdatedAt) {
            if (nextWorkspaceMetaByDirectory === state.workspaceMetaByDirectory) {
              nextWorkspaceMetaByDirectory = { ...nextWorkspaceMetaByDirectory }
            }
            nextWorkspaceMetaByDirectory[directory] = {
              lastOpenedAt: previousMeta?.lastOpenedAt ?? Date.now(),
              lastUpdatedAt: nextLastUpdatedAt,
            }
          }
        }

        const eventSessionID = extractEventSessionID(event)
        if (!eventSessionID) {
          continue
        }

        const opencodeSessionKey = makeUnifiedSessionKey('opencode', directory, eventSessionID)
        const currentRuntime = getSessionRuntime(opencodeSessionKey)
        const applied = applyOpencodeSessionEvent({
          directory,
          sessionID: eventSessionID,
          snapshot: currentRuntime?.runtimeSnapshot ?? null,
          messages: currentRuntime?.messages ?? [],
          event,
        })

        if (!applied.changed && !applied.todoItems) {
          continue
        }

        if (nextOpencodeSessions === state.opencodeSessions) {
          nextOpencodeSessions = { ...nextOpencodeSessions }
        }

        const existingSession = currentRuntime ?? {
          key: opencodeSessionKey,
          directory,
          sessionID: eventSessionID,
          runtimeSnapshot: null,
          messages: [],
          todoItems: [],
        }

        const nextSession = {
          ...existingSession,
        }

        if (applied.todoItems) {
          nextSession.todoItems = applied.todoItems.map((item, index) => ({
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
        }

        if (applied.changed && applied.snapshot) {
          const normalizedMessages = normalizeMessageBundles(applied.messages)
          nextSession.runtimeSnapshot = {
            ...applied.snapshot,
            messages: normalizedMessages,
          }
          nextSession.messages = normalizedMessages
          persistedMessages.set(opencodeSessionKey, normalizedMessages)
        }

        nextOpencodeSessions[opencodeSessionKey] = nextSession
      }

      if (
        nextProjectDataByDirectory === state.projectDataByDirectory &&
        nextWorkspaceMetaByDirectory === state.workspaceMetaByDirectory &&
        nextOpencodeSessions === state.opencodeSessions
      ) {
        return state
      }

      return {
        projectDataByDirectory: nextProjectDataByDirectory,
        workspaceMetaByDirectory: nextWorkspaceMetaByDirectory,
        opencodeSessions: nextOpencodeSessions,
      }
    })

    for (const [sessionKey, messages] of persistedMessages.entries()) {
      setPersistedOpencodeState(sessionKey, { messages })
    }

    reportPerf({
      surface: 'event_bus',
      metric: 'event.batch.flush_ms',
      kind: 'span',
      value: performance.now() - startedAt,
      unit: 'ms',
      process: 'renderer',
      component: 'workspace-stream-events',
    })
    if (queuedEventsRef.current.length > 0) {
      scheduleFlush(flushQueuedEventsRef.current, true)
    }
  }, [scheduleFlush])

  useEffect(() => {
    flushQueuedEventsRef.current = flushQueuedEvents
  }, [flushQueuedEvents])

  return useCallback(
    (directory: string, event: OpencodeEvent) => {
      queuedEventsRef.current.push({ directory, event })
      scheduleFlush(flushQueuedEventsRef.current)
    },
    [scheduleFlush]
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
  const applyOpencodeStreamEvent = useWorkspaceStreamEvents()

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
