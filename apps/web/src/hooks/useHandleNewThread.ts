import { DEFAULT_RUNTIME_MODE, type ProjectId, ThreadId } from '@orxa-code/contracts'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from '../composerDraftStore'
import { newThreadId } from '../lib/utils'
import { orderItemsByPreferredIds } from '../components/Sidebar.logic'
import { useStore } from '../store'
import { useThreadById } from '../storeSelectors'
import { useUiStateStore } from '../uiStateStore'

type NewThreadOptions = {
  branch?: string | null
  worktreePath?: string | null
  envMode?: DraftThreadEnvMode
}

function buildDraftThreadContextPatch(options?: NewThreadOptions) {
  const hasBranchOption = options?.branch !== undefined
  const hasWorktreePathOption = options?.worktreePath !== undefined
  const hasEnvModeOption = options?.envMode !== undefined

  return {
    hasContextOverride: hasBranchOption || hasWorktreePathOption || hasEnvModeOption,
    patch: {
      ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
      ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
      ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
    },
  }
}

async function activateStoredDraftThread(params: {
  navigate: ReturnType<typeof useNavigate>
  routeThreadId: ThreadId | null
  projectId: ProjectId
  storedDraftThread: { threadId: ThreadId }
  options: NewThreadOptions | undefined
}) {
  const { setDraftThreadContext, setProjectDraftThreadId } = useComposerDraftStore.getState()
  const contextUpdate = buildDraftThreadContextPatch(params.options)
  if (contextUpdate.hasContextOverride) {
    setDraftThreadContext(params.storedDraftThread.threadId, contextUpdate.patch)
  }
  setProjectDraftThreadId(params.projectId, params.storedDraftThread.threadId)
  if (params.routeThreadId === params.storedDraftThread.threadId) {
    return
  }
  await params.navigate({
    to: '/$threadId',
    params: { threadId: params.storedDraftThread.threadId },
  })
}

function reuseActiveDraftThread(params: {
  routeThreadId: ThreadId
  projectId: ProjectId
  options: NewThreadOptions | undefined
}) {
  const { setDraftThreadContext, setProjectDraftThreadId } = useComposerDraftStore.getState()
  const contextUpdate = buildDraftThreadContextPatch(params.options)
  if (contextUpdate.hasContextOverride) {
    setDraftThreadContext(params.routeThreadId, contextUpdate.patch)
  }
  setProjectDraftThreadId(params.projectId, params.routeThreadId)
}

async function createDraftThread(params: {
  navigate: ReturnType<typeof useNavigate>
  projectId: ProjectId
  options: NewThreadOptions | undefined
}) {
  const { applyStickyState, setProjectDraftThreadId } = useComposerDraftStore.getState()
  const threadId = newThreadId()
  setProjectDraftThreadId(params.projectId, threadId, {
    createdAt: new Date().toISOString(),
    branch: params.options?.branch ?? null,
    worktreePath: params.options?.worktreePath ?? null,
    envMode: params.options?.envMode ?? 'local',
    runtimeMode: DEFAULT_RUNTIME_MODE,
  })
  applyStickyState(threadId)
  await params.navigate({ to: '/$threadId', params: { threadId } })
}

export function useHandleNewThread() {
  const projectIds = useStore(useShallow(store => store.projects.map(project => project.id)))
  const projectOrder = useUiStateStore(store => store.projectOrder)
  const navigate = useNavigate()
  const routeThreadId = useParams({
    strict: false,
    select: params => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  })
  const activeThread = useThreadById(routeThreadId)
  const activeDraftThread = useComposerDraftStore(store =>
    routeThreadId ? (store.draftThreadsByThreadId[routeThreadId] ?? null) : null
  )
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projectIds,
      preferredIds: projectOrder,
      getId: projectId => projectId,
    })
  }, [projectIds, projectOrder])

  const handleNewThread = useCallback(
    (projectId: ProjectId, options?: NewThreadOptions): Promise<void> => {
      const { clearProjectDraftThreadId, getDraftThread, getDraftThreadByProjectId } =
        useComposerDraftStore.getState()
      const storedDraftThread = getDraftThreadByProjectId(projectId)
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null
      if (storedDraftThread) {
        return activateStoredDraftThread({
          navigate,
          routeThreadId,
          projectId,
          storedDraftThread,
          options,
        })
      }

      clearProjectDraftThreadId(projectId)

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        reuseActiveDraftThread({ routeThreadId, projectId, options })
        return Promise.resolve()
      }

      return createDraftThread({ navigate, projectId, options })
    },
    [navigate, routeThreadId]
  )

  return {
    activeDraftThread,
    activeThread,
    defaultProjectId: orderedProjects[0] ?? null,
    handleNewThread,
    routeThreadId,
  }
}
