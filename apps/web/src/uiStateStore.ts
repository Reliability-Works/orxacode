import { Debouncer } from '@tanstack/react-pacer'
import { type ProjectId, type ThreadId } from '@orxa-code/contracts'
import { create } from 'zustand'
import {
  type PendingNewSessionModalRequest,
  type SyncProjectInput,
  type SyncThreadInput,
  type ThreadEnvMode,
  type UiState,
} from './uiStateStore.types'
import {
  getPersistedExpandedParentThreadIds,
  getPersistedExpandedProjectCwds,
  getPersistedPinnedThreadIds,
  getPersistedProjectOrderCwds,
  getPersistedThreadEnvModeById,
  persistUiState,
  readPersistedUiState,
  refreshProjectCwdMappings,
} from './uiStateStore.persistence'
export type {
  PendingNewSessionModalRequest,
  PersistedUiState,
  SyncProjectInput,
  SyncThreadInput,
  UiState,
} from './uiStateStore.types'

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) {
    return false
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false
    }
  }
  return true
}

const debouncedPersistState = new Debouncer(persistUiState, { wait: 500 })

function projectOrdersEqual(left: readonly ProjectId[], right: readonly ProjectId[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  )
}

function buildMappedProjects(params: {
  projects: readonly SyncProjectInput[]
  previousExpandedById: Record<string, boolean>
  previousProjectIdByCwd: ReadonlyMap<string, ProjectId>
  nextExpandedById: Record<string, boolean>
}) {
  return params.projects.map((project, index) => {
    const previousProjectIdForCwd = params.previousProjectIdByCwd.get(project.cwd)
    const expanded =
      params.previousExpandedById[project.id] ??
      (previousProjectIdForCwd
        ? params.previousExpandedById[previousProjectIdForCwd]
        : undefined) ??
      (getPersistedExpandedProjectCwds().size > 0
        ? getPersistedExpandedProjectCwds().has(project.cwd)
        : true)
    params.nextExpandedById[project.id] = expanded
    return {
      id: project.id,
      cwd: project.cwd,
      incomingIndex: index,
    }
  })
}

function deriveOrderedProjectIdsFromState(params: {
  stateProjectOrder: readonly ProjectId[]
  nextExpandedById: Record<string, boolean>
  previousProjectCwdById: ReadonlyMap<ProjectId, string>
  mappedProjects: ReadonlyArray<{ id: ProjectId; cwd: string; incomingIndex: number }>
}) {
  const nextProjectIdByCwd = new Map(
    params.mappedProjects.map(project => [project.cwd, project.id] as const)
  )
  const usedProjectIds = new Set<ProjectId>()
  const orderedProjectIds: ProjectId[] = []

  for (const projectId of params.stateProjectOrder) {
    const matchedProjectId =
      (projectId in params.nextExpandedById ? projectId : undefined) ??
      (() => {
        const previousCwd = params.previousProjectCwdById.get(projectId)
        return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined
      })()
    if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
      continue
    }
    usedProjectIds.add(matchedProjectId)
    orderedProjectIds.push(matchedProjectId)
  }

  for (const project of params.mappedProjects) {
    if (usedProjectIds.has(project.id)) {
      continue
    }
    orderedProjectIds.push(project.id)
  }

  return orderedProjectIds
}

function deriveInitialProjectOrder(
  mappedProjects: ReadonlyArray<{ id: ProjectId; cwd: string; incomingIndex: number }>
) {
  const persistedProjectOrderCwds = getPersistedProjectOrderCwds()
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const)
  )
  return mappedProjects
    .map(project => ({
      id: project.id,
      incomingIndex: project.incomingIndex,
      orderIndex:
        persistedOrderByCwd.get(project.cwd) ??
        persistedProjectOrderCwds.length + project.incomingIndex,
    }))
    .toSorted((left, right) => {
      const byOrder = left.orderIndex - right.orderIndex
      if (byOrder !== 0) {
        return byOrder
      }
      return left.incomingIndex - right.incomingIndex
    })
    .map(project => project.id)
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const { previousProjectCwdById, previousProjectIdByCwd, cwdMappingChanged } =
    refreshProjectCwdMappings(projects)
  const nextExpandedById: Record<string, boolean> = {}
  const previousExpandedById = state.projectExpandedById
  const mappedProjects = buildMappedProjects({
    projects,
    previousExpandedById,
    previousProjectIdByCwd,
    nextExpandedById,
  })

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? deriveOrderedProjectIdsFromState({
          stateProjectOrder: state.projectOrder,
          nextExpandedById,
          previousProjectCwdById,
          mappedProjects,
        })
      : deriveInitialProjectOrder(mappedProjects)

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  }
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map(thread => thread.id))
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId)
    )
  )
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.id] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.id] = thread.seedVisitedAt
    }
  }
  const nextPinnedThreadIds = state.pinnedThreadIds.filter(threadId =>
    retainedThreadIds.has(threadId)
  )
  const nextExpandedParentThreadIds = state.expandedParentThreadIds.filter(threadId =>
    retainedThreadIds.has(threadId)
  )
  const nextThreadEnvModeById = Object.fromEntries(
    Object.entries(state.threadEnvModeById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId)
    )
  ) as Record<string, ThreadEnvMode>
  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    state.pinnedThreadIds.length === nextPinnedThreadIds.length &&
    state.pinnedThreadIds.every((threadId, index) => threadId === nextPinnedThreadIds[index]) &&
    state.expandedParentThreadIds.length === nextExpandedParentThreadIds.length &&
    state.expandedParentThreadIds.every(
      (threadId, index) => threadId === nextExpandedParentThreadIds[index]
    ) &&
    recordsEqual(state.threadEnvModeById, nextThreadEnvModeById)
  ) {
    return state
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    pinnedThreadIds: nextPinnedThreadIds,
    expandedParentThreadIds: nextExpandedParentThreadIds,
    threadEnvModeById: nextThreadEnvModeById,
  }
}

export function markThreadVisited(state: UiState, threadId: ThreadId, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString()
  const visitedAtMs = Date.parse(at)
  const previousVisitedAt = state.threadLastVisitedAtById[threadId]
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  }
}

export function markThreadUnread(
  state: UiState,
  threadId: ThreadId,
  latestTurnCompletedAt: string | null | undefined
): UiState {
  if (!latestTurnCompletedAt) {
    return state
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt)
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString()
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  }
}

export function clearThreadUi(state: UiState, threadId: ThreadId): UiState {
  const hadVisitedAt = threadId in state.threadLastVisitedAtById
  const nextPinnedThreadIds = state.pinnedThreadIds.filter(
    pinnedThreadId => pinnedThreadId !== threadId
  )
  const nextExpandedParentThreadIds = state.expandedParentThreadIds.filter(
    expandedThreadId => expandedThreadId !== threadId
  )
  const hadEnvMode = threadId in state.threadEnvModeById
  if (
    !hadVisitedAt &&
    nextPinnedThreadIds.length === state.pinnedThreadIds.length &&
    nextExpandedParentThreadIds.length === state.expandedParentThreadIds.length &&
    !hadEnvMode
  ) {
    return state
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById }
  const nextThreadEnvModeById = { ...state.threadEnvModeById }
  delete nextThreadLastVisitedAtById[threadId]
  delete nextThreadEnvModeById[threadId]
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    pinnedThreadIds: nextPinnedThreadIds,
    expandedParentThreadIds: nextExpandedParentThreadIds,
    threadEnvModeById: nextThreadEnvModeById,
  }
}

export function setThreadEnvMode(
  state: UiState,
  threadId: ThreadId,
  mode: ThreadEnvMode | null
): UiState {
  const previousMode = state.threadEnvModeById[threadId] ?? null
  if (previousMode === mode) {
    return state
  }
  if (mode === null) {
    if (!(threadId in state.threadEnvModeById)) {
      return state
    }
    const nextThreadEnvModeById = { ...state.threadEnvModeById }
    delete nextThreadEnvModeById[threadId]
    return {
      ...state,
      threadEnvModeById: nextThreadEnvModeById,
    }
  }
  return {
    ...state,
    threadEnvModeById: {
      ...state.threadEnvModeById,
      [threadId]: mode,
    },
  }
}

export function pinThread(state: UiState, threadId: ThreadId): UiState {
  if (state.pinnedThreadIds.includes(threadId)) {
    return state
  }
  return {
    ...state,
    pinnedThreadIds: [threadId, ...state.pinnedThreadIds],
  }
}

export function unpinThread(state: UiState, threadId: ThreadId): UiState {
  if (!state.pinnedThreadIds.includes(threadId)) {
    return state
  }
  return {
    ...state,
    pinnedThreadIds: state.pinnedThreadIds.filter(pinnedThreadId => pinnedThreadId !== threadId),
  }
}

export function togglePinnedThread(state: UiState, threadId: ThreadId): UiState {
  return state.pinnedThreadIds.includes(threadId)
    ? unpinThread(state, threadId)
    : pinThread(state, threadId)
}

export function setParentThreadExpanded(
  state: UiState,
  threadId: ThreadId,
  expanded: boolean
): UiState {
  const alreadyExpanded = state.expandedParentThreadIds.includes(threadId)
  if (alreadyExpanded === expanded) {
    return state
  }
  return {
    ...state,
    expandedParentThreadIds: expanded
      ? [...state.expandedParentThreadIds, threadId]
      : state.expandedParentThreadIds.filter(parentThreadId => parentThreadId !== threadId),
  }
}

export function toggleParentThreadExpanded(state: UiState, threadId: ThreadId): UiState {
  return setParentThreadExpanded(state, threadId, !state.expandedParentThreadIds.includes(threadId))
}

export function toggleProject(state: UiState, projectId: ProjectId): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  }
}

export function setProjectExpanded(
  state: UiState,
  projectId: ProjectId,
  expanded: boolean
): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  }
}

export function reorderProjects(
  state: UiState,
  draggedProjectId: ProjectId,
  targetProjectId: ProjectId
): UiState {
  if (draggedProjectId === targetProjectId) {
    return state
  }
  const draggedIndex = state.projectOrder.findIndex(projectId => projectId === draggedProjectId)
  const targetIndex = state.projectOrder.findIndex(projectId => projectId === targetProjectId)
  if (draggedIndex < 0 || targetIndex < 0) {
    return state
  }
  const projectOrder = [...state.projectOrder]
  const [draggedProject] = projectOrder.splice(draggedIndex, 1)
  if (!draggedProject) {
    return state
  }
  projectOrder.splice(targetIndex, 0, draggedProject)
  return {
    ...state,
    projectOrder,
  }
}

interface UiStateStore extends UiState {
  pendingNewSessionModalRequest: PendingNewSessionModalRequest | null
  syncProjects: (projects: readonly SyncProjectInput[]) => void
  syncThreads: (threads: readonly SyncThreadInput[]) => void
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void
  clearThreadUi: (threadId: ThreadId) => void
  pinThread: (threadId: ThreadId) => void
  unpinThread: (threadId: ThreadId) => void
  togglePinnedThread: (threadId: ThreadId) => void
  setThreadEnvMode: (threadId: ThreadId, mode: ThreadEnvMode | null) => void
  setParentThreadExpanded: (threadId: ThreadId, expanded: boolean) => void
  toggleParentThreadExpanded: (threadId: ThreadId) => void
  toggleProject: (projectId: ProjectId) => void
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void
  requestNewSessionModal: (request: PendingNewSessionModalRequest) => void
  clearPendingNewSessionModal: () => void
}

export const useUiStateStore = create<UiStateStore>(set => ({
  ...readPersistedUiState(),
  pinnedThreadIds: getPersistedPinnedThreadIds(),
  expandedParentThreadIds: getPersistedExpandedParentThreadIds(),
  threadEnvModeById: getPersistedThreadEnvModeById(),
  pendingNewSessionModalRequest: null,
  syncProjects: projects => set(state => syncProjects(state, projects)),
  syncThreads: threads => set(state => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set(state => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set(state => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: threadId => set(state => clearThreadUi(state, threadId)),
  pinThread: threadId => set(state => pinThread(state, threadId)),
  unpinThread: threadId => set(state => unpinThread(state, threadId)),
  togglePinnedThread: threadId => set(state => togglePinnedThread(state, threadId)),
  setThreadEnvMode: (threadId, mode) => set(state => setThreadEnvMode(state, threadId, mode)),
  setParentThreadExpanded: (threadId, expanded) =>
    set(state => setParentThreadExpanded(state, threadId, expanded)),
  toggleParentThreadExpanded: threadId => set(state => toggleParentThreadExpanded(state, threadId)),
  toggleProject: projectId => set(state => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set(state => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set(state => reorderProjects(state, draggedProjectId, targetProjectId)),
  requestNewSessionModal: request => set({ pendingNewSessionModalRequest: request }),
  clearPendingNewSessionModal: () => set({ pendingNewSessionModalRequest: null }),
}))

useUiStateStore.subscribe(state => debouncedPersistState.maybeExecute(state))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    debouncedPersistState.flush()
  })
}
