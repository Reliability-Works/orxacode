/**
 * App store — Zustand store and pure state transition exports.
 *
 * Pure helper functions live in store.helpers.ts.
 * Per-event orchestration handlers live in store.orchestrationEvents.ts.
 */
import {
  type OrchestrationEvent,
  type OrchestrationReadModel,
  ThreadId,
} from '@orxa-code/contracts'
import { create } from 'zustand'
import {
  getOpencodeStartupTelemetryMessage,
  isOpencodeStartupTelemetryActivity,
} from './opencodeStartupTelemetry'
import { type Project, type Thread } from './types'
import { type AppState, initialState, mapProject, mapThread, updateThread } from './store.helpers'
import { applyOrchestrationEvent } from './store.orchestrationEvents'

// Re-export AppState and state transition functions for external consumers.
export type { AppState }
export { applyOrchestrationEvent }

export function logOpencodeStartupTelemetryForEvent(event: OrchestrationEvent): void {
  if (event.type !== 'thread.activity-appended') {
    return
  }
  if (!isOpencodeStartupTelemetryActivity(event.payload.activity)) {
    return
  }
  console.debug('[orxacode][opencode-startup]', {
    threadId: event.payload.threadId,
    activityId: event.payload.activity.id,
    createdAt: event.payload.activity.createdAt,
    message: getOpencodeStartupTelemetryMessage(event.payload.activity),
  })
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>
): AppState {
  if (events.length === 0) {
    return state
  }
  return events.reduce((nextState, event) => applyOrchestrationEvent(nextState, event), state)
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(
  state: AppState,
  readModel: OrchestrationReadModel,
  environmentId?: string
): AppState {
  const projects = readModel.projects
    .filter(project => project.deletedAt === null)
    .map(project => mapProject(project, environmentId))
  const threads = readModel.threads
    .filter(thread => thread.deletedAt === null)
    .map(thread => mapThread(thread, environmentId))
  if (typeof window !== 'undefined') {
    console.info('[mobile-sync] syncServerReadModel applied', {
      bootstrapComplete: true,
      mobile: new URLSearchParams(window.location.search).get('mobile') === '1',
      projects: projects.length,
      revision: 'mobile-reopen-probe-1',
      threads: threads.length,
      snapshotSequence: readModel.snapshotSequence,
    })
  }
  return {
    ...state,
    activeEnvironmentId: environmentId ?? state.activeEnvironmentId,
    projects,
    threads,
    bootstrapComplete: true,
  }
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, t => {
    if (t.error === error) return t
    return { ...t, error }
  })
  return threads === state.threads ? state : { ...state, threads }
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null
): AppState {
  const threads = updateThread(state.threads, threadId, t => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t
    const cwdChanged = t.worktreePath !== worktreePath
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    }
  })
  return threads === state.threads ? state : { ...state, threads }
}

export function setThreadGitRoot(
  state: AppState,
  threadId: ThreadId,
  gitRoot: string | null
): AppState {
  const threads = updateThread(state.threads, threadId, t => {
    if (t.gitRoot === gitRoot) return t
    return { ...t, gitRoot, branch: null, worktreePath: null, session: null }
  })
  return threads === state.threads ? state : { ...state, threads }
}

// ── Selectors ────────────────────────────────────────────────────────

export const selectProjectById =
  (projectId: Project['id'] | null | undefined) =>
  (state: AppState): Project | undefined =>
    projectId ? state.projects.find(project => project.id === projectId) : undefined

export const selectThreadById =
  (threadId: ThreadId | null | undefined) =>
  (state: AppState): Thread | undefined =>
    threadId ? state.threads.find(thread => thread.id === threadId) : undefined

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel, environmentId?: string) => void
  applyOrchestrationEvent: (event: OrchestrationEvent) => void
  applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>) => void
  setError: (threadId: ThreadId, error: string | null) => void
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void
  setThreadGitRoot: (threadId: ThreadId, gitRoot: string | null) => void
  setActiveEnvironmentId: (environmentId: string | null) => void
}

export const useStore = create<AppStore>(set => ({
  ...initialState,
  syncServerReadModel: (readModel, environmentId) =>
    set(state => {
      if (typeof window !== 'undefined') {
        console.info('[mobile-sync] store syncServerReadModel commit start', {
          revision: 'mobile-reopen-probe-1',
          previousBootstrapComplete: state.bootstrapComplete,
          previousProjects: state.projects.length,
          previousThreads: state.threads.length,
          previousActiveEnvironmentId: state.activeEnvironmentId,
          nextEnvironmentId: environmentId ?? state.activeEnvironmentId,
        })
      }
      const nextState = syncServerReadModel(state, readModel, environmentId)
      if (typeof window !== 'undefined') {
        console.info('[mobile-sync] store syncServerReadModel commit done', {
          revision: 'mobile-reopen-probe-1',
          nextBootstrapComplete: nextState.bootstrapComplete,
          nextProjects: nextState.projects.length,
          nextThreads: nextState.threads.length,
          nextActiveEnvironmentId: nextState.activeEnvironmentId,
        })
      }
      return nextState
    }),
  applyOrchestrationEvent: event =>
    set(state => {
      logOpencodeStartupTelemetryForEvent(event)
      return applyOrchestrationEvent(state, event)
    }),
  applyOrchestrationEvents: events =>
    set(state => {
      for (const event of events) {
        logOpencodeStartupTelemetryForEvent(event)
      }
      return applyOrchestrationEvents(state, events)
    }),
  setError: (threadId, error) => set(state => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set(state => setThreadBranch(state, threadId, branch, worktreePath)),
  setThreadGitRoot: (threadId, gitRoot) => set(state => setThreadGitRoot(state, threadId, gitRoot)),
  setActiveEnvironmentId: environmentId =>
    set(state => {
      if (typeof window !== 'undefined' && state.activeEnvironmentId !== environmentId) {
        console.info('[mobile-sync] store setActiveEnvironmentId', {
          revision: 'mobile-reopen-probe-1',
          previousActiveEnvironmentId: state.activeEnvironmentId,
          nextActiveEnvironmentId: environmentId,
        })
      }
      return { activeEnvironmentId: environmentId }
    }),
}))

function installMobileSyncStoreDebugSubscription() {
  if (typeof window === 'undefined') {
    return
  }

  const debugWindow = window as Window & {
    __orxaMobileSyncStoreDebugInstalled__?: boolean
  }
  if (debugWindow.__orxaMobileSyncStoreDebugInstalled__) {
    return
  }
  debugWindow.__orxaMobileSyncStoreDebugInstalled__ = true

  let previousState = useStore.getState()
  useStore.subscribe(nextState => {
    const changed =
      previousState.bootstrapComplete !== nextState.bootstrapComplete ||
      previousState.projects.length !== nextState.projects.length ||
      previousState.threads.length !== nextState.threads.length ||
      previousState.activeEnvironmentId !== nextState.activeEnvironmentId

    if (!changed) {
      previousState = nextState
      return
    }

    const transitionPayload = buildMobileSyncStoreTransitionPayload(previousState, nextState)

    console.info('[mobile-sync] store transition', transitionPayload)

    const looksLikeReset =
      (previousState.bootstrapComplete && !nextState.bootstrapComplete) ||
      ((previousState.projects.length > 0 || previousState.threads.length > 0) &&
        nextState.projects.length === 0 &&
        nextState.threads.length === 0)

    if (looksLikeReset) {
      console.warn('[mobile-sync] store potential bootstrap reset', transitionPayload)
    }

    previousState = nextState
  })
}

installMobileSyncStoreDebugSubscription()

function buildMobileSyncStoreTransitionPayload(previousState: AppState, nextState: AppState) {
  return {
    revision: 'mobile-reopen-probe-1',
    previousBootstrapComplete: previousState.bootstrapComplete,
    nextBootstrapComplete: nextState.bootstrapComplete,
    previousProjects: previousState.projects.length,
    nextProjects: nextState.projects.length,
    previousThreads: previousState.threads.length,
    nextThreads: nextState.threads.length,
    previousActiveEnvironmentId: previousState.activeEnvironmentId,
    nextActiveEnvironmentId: nextState.activeEnvironmentId,
  }
}
