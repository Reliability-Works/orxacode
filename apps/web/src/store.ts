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
import { type Project, type Thread } from './types'
import { type AppState, initialState, mapProject, mapThread, updateThread } from './store.helpers'
import { applyOrchestrationEvent } from './store.orchestrationEvents'

// Re-export AppState and state transition functions for external consumers.
export type { AppState }
export { applyOrchestrationEvent }

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

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = readModel.projects.filter(project => project.deletedAt === null).map(mapProject)
  const threads = readModel.threads.filter(thread => thread.deletedAt === null).map(mapThread)
  return {
    ...state,
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
  syncServerReadModel: (readModel: OrchestrationReadModel) => void
  applyOrchestrationEvent: (event: OrchestrationEvent) => void
  applyOrchestrationEvents: (events: ReadonlyArray<OrchestrationEvent>) => void
  setError: (threadId: ThreadId, error: string | null) => void
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void
}

export const useStore = create<AppStore>(set => ({
  ...initialState,
  syncServerReadModel: readModel => set(state => syncServerReadModel(state, readModel)),
  applyOrchestrationEvent: event => set(state => applyOrchestrationEvent(state, event)),
  applyOrchestrationEvents: events => set(state => applyOrchestrationEvents(state, events)),
  setError: (threadId, error) => set(state => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set(state => setThreadBranch(state, threadId, branch, worktreePath)),
}))
