/**
 * Zustand action implementations for composerDraftStore — thread management actions.
 *
 * Covers draft-thread and project-draft-thread state. Content actions
 * (prompt, model, images, terminal contexts) live in
 * composerDraftStore.actions.content.ts.
 *
 * Extraction-only refactor — runtime behavior is preserved exactly.
 */
import {
  type ModelSelection,
  type ProviderKind,
  type ProjectId,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ThreadId,
} from '@orxa-code/contracts'
import * as Equal from 'effect/Equal'
import { normalizeModelSelection } from './composerDraftStore.normalize'
import {
  type ComposerDraftStoreState,
  type ComposerThreadDraftState,
  type DraftThreadState,
  type DraftThreadEnvMode,
  createEmptyThreadDraft,
  revokeObjectPreviewUrl,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_INTERACTION_MODE,
  updateDraftByThreadId,
} from './composerDraftStore.state'

type SetState = (
  partial:
    | ComposerDraftStoreState
    | Partial<ComposerDraftStoreState>
    | ((
        state: ComposerDraftStoreState
      ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
  replace?: false
) => void

type GetState = () => ComposerDraftStoreState

function draftThreadsEqual(a: DraftThreadState, b: DraftThreadState): boolean {
  return (
    a.projectId === b.projectId &&
    a.createdAt === b.createdAt &&
    a.runtimeMode === b.runtimeMode &&
    a.interactionMode === b.interactionMode &&
    a.branch === b.branch &&
    a.worktreePath === b.worktreePath &&
    a.envMode === b.envMode
  )
}

type ProjectSetOptions = {
  branch?: string | null
  worktreePath?: string | null
  createdAt?: string
  envMode?: DraftThreadEnvMode
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
}

function resolveWorktreePath(
  existing: DraftThreadState | undefined,
  opts: ProjectSetOptions | undefined
): string | null {
  if (opts?.worktreePath === undefined) return existing?.worktreePath ?? null
  return opts.worktreePath ?? null
}

function resolveBranch(
  existing: DraftThreadState | undefined,
  opts: ProjectSetOptions | undefined
): string | null {
  if (opts?.branch === undefined) return existing?.branch ?? null
  return opts.branch ?? null
}

function buildNextDraftThreadForProjectSet(
  projectId: ProjectId,
  existingThread: DraftThreadState | undefined,
  options: ProjectSetOptions | undefined
): DraftThreadState {
  const nextWorktreePath = resolveWorktreePath(existingThread, options)
  const nextBranch = resolveBranch(existingThread, options)
  return {
    projectId,
    createdAt: options?.createdAt ?? existingThread?.createdAt ?? new Date().toISOString(),
    runtimeMode: options?.runtimeMode ?? existingThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode:
      options?.interactionMode ?? existingThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
    branch: nextBranch,
    worktreePath: nextWorktreePath,
    envMode:
      options?.envMode ?? (nextWorktreePath ? 'worktree' : (existingThread?.envMode ?? 'local')),
  }
}

function buildNextDraftThreadForContextSet(
  existing: DraftThreadState,
  options: {
    branch?: string | null
    worktreePath?: string | null
    projectId?: ProjectId
    createdAt?: string
    envMode?: DraftThreadEnvMode
    runtimeMode?: RuntimeMode
    interactionMode?: ProviderInteractionMode
  }
): DraftThreadState {
  const nextWorktreePath =
    options.worktreePath === undefined ? existing.worktreePath : (options.worktreePath ?? null)
  return {
    projectId: options.projectId ?? existing.projectId,
    createdAt:
      options.createdAt === undefined
        ? existing.createdAt
        : options.createdAt || existing.createdAt,
    runtimeMode: options.runtimeMode ?? existing.runtimeMode,
    interactionMode: options.interactionMode ?? existing.interactionMode,
    branch: options.branch === undefined ? existing.branch : (options.branch ?? null),
    worktreePath: nextWorktreePath,
    envMode: options.envMode ?? (nextWorktreePath ? 'worktree' : (existing.envMode ?? 'local')),
  }
}

function removeOrphanedPreviousThread(
  previousThreadId: ThreadId | undefined,
  currentThreadId: ThreadId,
  nextProjectMap: Record<ProjectId, ThreadId>,
  nextDraftThreadsMap: Record<ThreadId, DraftThreadState>,
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>
): Record<ThreadId, ComposerThreadDraftState> {
  let nextDraftsByThreadId = draftsByThreadId
  if (
    previousThreadId &&
    previousThreadId !== currentThreadId &&
    !Object.values(nextProjectMap).includes(previousThreadId)
  ) {
    delete nextDraftThreadsMap[previousThreadId]
    if (draftsByThreadId[previousThreadId] !== undefined) {
      nextDraftsByThreadId = { ...draftsByThreadId }
      delete nextDraftsByThreadId[previousThreadId]
    }
  }
  return nextDraftsByThreadId
}

export function actionGetDraftThreadByProjectId(
  get: GetState,
  projectId: ProjectId
): ReturnType<ComposerDraftStoreState['getDraftThreadByProjectId']> {
  if (projectId.length === 0) return null
  const threadId = get().projectDraftThreadIdByProjectId[projectId]
  if (!threadId) return null
  const draftThread = get().draftThreadsByThreadId[threadId]
  if (!draftThread || draftThread.projectId !== projectId) return null
  return { threadId, ...draftThread }
}

export function actionGetDraftThread(get: GetState, threadId: ThreadId): DraftThreadState | null {
  if (threadId.length === 0) return null
  return get().draftThreadsByThreadId[threadId] ?? null
}

export function actionSetProjectDraftThreadId(
  set: SetState,
  projectId: ProjectId,
  threadId: ThreadId,
  options?: {
    branch?: string | null
    worktreePath?: string | null
    createdAt?: string
    envMode?: DraftThreadEnvMode
    runtimeMode?: RuntimeMode
    interactionMode?: ProviderInteractionMode
  }
): void {
  if (projectId.length === 0 || threadId.length === 0) return
  set(state => {
    const existingThread = state.draftThreadsByThreadId[threadId]
    const previousThreadIdForProject = state.projectDraftThreadIdByProjectId[projectId]
    const nextDraftThread = buildNextDraftThreadForProjectSet(projectId, existingThread, options)
    const hasSameProjectMapping = previousThreadIdForProject === threadId
    if (
      hasSameProjectMapping &&
      existingThread &&
      draftThreadsEqual(existingThread, nextDraftThread)
    ) {
      return state
    }
    const nextProjectDraftThreadIdByProjectId: Record<ProjectId, ThreadId> = {
      ...state.projectDraftThreadIdByProjectId,
      [projectId]: threadId,
    }
    const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
      ...state.draftThreadsByThreadId,
      [threadId]: nextDraftThread,
    }
    const nextDraftsByThreadId = removeOrphanedPreviousThread(
      previousThreadIdForProject,
      threadId,
      nextProjectDraftThreadIdByProjectId,
      nextDraftThreadsByThreadId,
      state.draftsByThreadId
    )
    return {
      draftsByThreadId: nextDraftsByThreadId,
      draftThreadsByThreadId: nextDraftThreadsByThreadId,
      projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
    }
  })
}

export function actionSetDraftThreadContext(
  set: SetState,
  threadId: ThreadId,
  options: {
    branch?: string | null
    worktreePath?: string | null
    projectId?: ProjectId
    createdAt?: string
    envMode?: DraftThreadEnvMode
    runtimeMode?: RuntimeMode
    interactionMode?: ProviderInteractionMode
  }
): void {
  if (threadId.length === 0) return
  set(state => {
    const existing = state.draftThreadsByThreadId[threadId]
    if (!existing) return state
    const nextDraftThread = buildNextDraftThreadForContextSet(existing, options)
    const nextProjectId = nextDraftThread.projectId
    if (nextProjectId.length === 0) return state
    if (draftThreadsEqual(existing, nextDraftThread)) return state
    const nextProjectDraftThreadIdByProjectId: Record<ProjectId, ThreadId> = {
      ...state.projectDraftThreadIdByProjectId,
      [nextProjectId]: threadId,
    }
    if (existing.projectId !== nextProjectId) {
      if (nextProjectDraftThreadIdByProjectId[existing.projectId] === threadId) {
        delete nextProjectDraftThreadIdByProjectId[existing.projectId]
      }
    }
    return {
      draftThreadsByThreadId: {
        ...state.draftThreadsByThreadId,
        [threadId]: nextDraftThread,
      },
      projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
    }
  })
}

function clearProjectDraftThreadBody(
  state: ComposerDraftStoreState,
  projectId: ProjectId,
  threadId: ThreadId
): ComposerDraftStoreState | Partial<ComposerDraftStoreState> {
  const restProjectMappings = Object.fromEntries(
    Object.entries(state.projectDraftThreadIdByProjectId).filter(([key]) => key !== projectId)
  ) as Record<ProjectId, ThreadId>
  const nextDraftThreadsByThreadId: Record<ThreadId, DraftThreadState> = {
    ...state.draftThreadsByThreadId,
  }
  let nextDraftsByThreadId = state.draftsByThreadId
  if (!Object.values(restProjectMappings).includes(threadId)) {
    delete nextDraftThreadsByThreadId[threadId]
    if (state.draftsByThreadId[threadId] !== undefined) {
      nextDraftsByThreadId = { ...state.draftsByThreadId }
      delete nextDraftsByThreadId[threadId]
    }
  }
  return {
    draftsByThreadId: nextDraftsByThreadId,
    draftThreadsByThreadId: nextDraftThreadsByThreadId,
    projectDraftThreadIdByProjectId: restProjectMappings,
  }
}

export function actionClearProjectDraftThreadId(set: SetState, projectId: ProjectId): void {
  if (projectId.length === 0) return
  set(state => {
    const threadId = state.projectDraftThreadIdByProjectId[projectId]
    if (threadId === undefined) return state
    return clearProjectDraftThreadBody(state, projectId, threadId)
  })
}

export function actionClearProjectDraftThreadById(
  set: SetState,
  projectId: ProjectId,
  threadId: ThreadId
): void {
  if (projectId.length === 0 || threadId.length === 0) return
  set(state => {
    if (state.projectDraftThreadIdByProjectId[projectId] !== threadId) return state
    return clearProjectDraftThreadBody(state, projectId, threadId)
  })
}

export function actionClearDraftThread(set: SetState, get: GetState, threadId: ThreadId): void {
  if (threadId.length === 0) return
  const existing = get().draftsByThreadId[threadId]
  if (existing) {
    for (const image of existing.images) {
      revokeObjectPreviewUrl(image.previewUrl)
    }
  }
  set(state => {
    const hasDraftThread = state.draftThreadsByThreadId[threadId] !== undefined
    const hasProjectMapping = Object.values(state.projectDraftThreadIdByProjectId).includes(
      threadId
    )
    const hasComposerDraft = state.draftsByThreadId[threadId] !== undefined
    if (!hasDraftThread && !hasProjectMapping && !hasComposerDraft) return state
    const nextProjectDraftThreadIdByProjectId = Object.fromEntries(
      Object.entries(state.projectDraftThreadIdByProjectId).filter(
        ([, draftThreadId]) => draftThreadId !== threadId
      )
    ) as Record<ProjectId, ThreadId>
    const restDraftThreadsByThreadId = Object.fromEntries(
      Object.entries(state.draftThreadsByThreadId).filter(([key]) => key !== threadId)
    ) as Record<ThreadId, DraftThreadState>
    const restDraftsByThreadId = Object.fromEntries(
      Object.entries(state.draftsByThreadId).filter(([key]) => key !== threadId)
    ) as Record<ThreadId, ComposerThreadDraftState>
    return {
      draftsByThreadId: restDraftsByThreadId,
      draftThreadsByThreadId: restDraftThreadsByThreadId,
      projectDraftThreadIdByProjectId: nextProjectDraftThreadIdByProjectId,
    }
  })
}

export function actionSetStickyModelSelection(
  set: SetState,
  modelSelection: ModelSelection | null | undefined
): void {
  const normalized = normalizeModelSelection(modelSelection)
  set(state => {
    if (!normalized) return state
    const nextMap: Partial<Record<ProviderKind, ModelSelection>> = {
      ...state.stickyModelSelectionByProvider,
      [normalized.provider]: normalized,
    }
    if (Equal.equals(state.stickyModelSelectionByProvider, nextMap)) {
      return state.stickyActiveProvider === normalized.provider
        ? state
        : { stickyActiveProvider: normalized.provider }
    }
    return {
      stickyModelSelectionByProvider: nextMap,
      stickyActiveProvider: normalized.provider,
    }
  })
}

export function actionApplyStickyState(set: SetState, threadId: ThreadId): void {
  if (threadId.length === 0) return
  set(state => {
    const stickyMap = state.stickyModelSelectionByProvider
    const stickyActiveProvider = state.stickyActiveProvider
    if (Object.keys(stickyMap).length === 0 && stickyActiveProvider === null) return state
    const existing = state.draftsByThreadId[threadId]
    const base = existing ?? createEmptyThreadDraft()
    const nextMap = { ...base.modelSelectionByProvider }
    for (const [provider, selection] of Object.entries(stickyMap)) {
      if (selection) {
        const current = nextMap[provider as ProviderKind]
        nextMap[provider as ProviderKind] = {
          ...selection,
          model: current?.model ?? selection.model,
        }
      }
    }
    if (
      Equal.equals(base.modelSelectionByProvider, nextMap) &&
      base.activeProvider === stickyActiveProvider
    ) {
      return state
    }
    const nextDraft: ComposerThreadDraftState = {
      ...base,
      modelSelectionByProvider: nextMap,
      activeProvider: stickyActiveProvider,
    }
    return updateDraftByThreadId(state, threadId, nextDraft)
  })
}

export type { SetState, GetState }
