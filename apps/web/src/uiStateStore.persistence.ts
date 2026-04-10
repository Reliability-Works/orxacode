import { type ProjectId, type ThreadId } from '@orxa-code/contracts'

import {
  type PersistedUiState,
  type SyncProjectInput,
  type ThreadEnvMode,
  type UiState,
  initialState,
} from './uiStateStore.types'

const PERSISTED_STATE_KEY = 'orxa:ui-state:v1'

const persistedExpandedProjectCwds = new Set<string>()
const persistedProjectOrderCwds: string[] = []
const persistedPinnedThreadIds: ThreadId[] = []
const persistedExpandedParentThreadIds: ThreadId[] = []
const persistedThreadEnvModeById: Record<string, ThreadEnvMode> = {}
const currentProjectCwdById = new Map<ProjectId, string>()

function resetPersistedCollections() {
  persistedExpandedProjectCwds.clear()
  persistedProjectOrderCwds.length = 0
  persistedPinnedThreadIds.length = 0
  persistedExpandedParentThreadIds.length = 0
  for (const threadId of Object.keys(persistedThreadEnvModeById)) {
    delete persistedThreadEnvModeById[threadId]
  }
}

function hydratePersistedStringArray<T extends string>(
  target: T[],
  values: readonly unknown[],
  isUnique = true
) {
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) continue
    if (isUnique && target.includes(value as T)) continue
    target.push(value as T)
  }
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  resetPersistedCollections()
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === 'string' && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd)
    }
  }
  hydratePersistedStringArray(persistedProjectOrderCwds, parsed.projectOrderCwds ?? [])
  hydratePersistedStringArray(persistedPinnedThreadIds, parsed.pinnedThreadIds ?? [])
  hydratePersistedStringArray(
    persistedExpandedParentThreadIds,
    parsed.expandedParentThreadIds ?? []
  )
  for (const [threadId, mode] of Object.entries(parsed.threadEnvModeById ?? {})) {
    if (
      typeof threadId === 'string' &&
      threadId.length > 0 &&
      (mode === 'local' || mode === 'worktree')
    ) {
      persistedThreadEnvModeById[threadId] = mode
    }
  }
}

export function readPersistedUiState(): UiState {
  if (typeof window === 'undefined') {
    return initialState
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY)
    if (!raw) {
      return initialState
    }
    hydratePersistedProjectState(JSON.parse(raw) as PersistedUiState)
    return initialState
  } catch {
    return initialState
  }
}

export function persistUiState(state: UiState): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const cwd = currentProjectCwdById.get(projectId as ProjectId)
        return cwd ? [cwd] : []
      })
    const projectOrderCwds = state.projectOrder.flatMap(projectId => {
      const cwd = currentProjectCwdById.get(projectId)
      return cwd ? [cwd] : []
    })
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds,
        projectOrderCwds,
        pinnedThreadIds: state.pinnedThreadIds,
        expandedParentThreadIds: state.expandedParentThreadIds,
        threadEnvModeById: state.threadEnvModeById,
      } satisfies PersistedUiState)
    )
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

export function refreshProjectCwdMappings(projects: readonly SyncProjectInput[]) {
  const previousProjectCwdById = new Map(currentProjectCwdById)
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const)
  )
  currentProjectCwdById.clear()
  for (const project of projects) {
    currentProjectCwdById.set(project.id, project.cwd)
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some(project => previousProjectCwdById.get(project.id) !== project.cwd)
  return { previousProjectCwdById, previousProjectIdByCwd, cwdMappingChanged }
}

export function getPersistedPinnedThreadIds(): ThreadId[] {
  return persistedPinnedThreadIds
}

export function getPersistedExpandedParentThreadIds(): ThreadId[] {
  return persistedExpandedParentThreadIds
}

export function getPersistedThreadEnvModeById(): Record<string, ThreadEnvMode> {
  return { ...persistedThreadEnvModeById }
}

export function getPersistedExpandedProjectCwds(): ReadonlySet<string> {
  return persistedExpandedProjectCwds
}

export function getPersistedProjectOrderCwds(): readonly string[] {
  return persistedProjectOrderCwds
}
