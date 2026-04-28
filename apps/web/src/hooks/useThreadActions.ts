import { ThreadId } from '@orxa-code/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback } from 'react'

import { getFallbackThreadIdAfterDelete } from '../components/Sidebar.logic'
import { useComposerDraftStore } from '../composerDraftStore'
import { gitRemoveWorktreeMutationOptions } from '../lib/gitReactQuery'
import { newCommandId } from '../lib/utils'
import { readNativeApi } from '../nativeApi'
import { useStore } from '../store'
import { useTerminalStateStore } from '../terminalStateStore'
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from '../worktreeCleanup'
import { toastManager } from '../components/ui/toastState'
import { useSettings } from './useSettings'

type NativeApi = NonNullable<ReturnType<typeof readNativeApi>>
type ThreadStoreState = ReturnType<typeof useStore.getState>
type ThreadEntry = ThreadStoreState['threads'][number]
type ProjectEntry = ThreadStoreState['projects'][number]
type DeleteThreadOptions = { deletedThreadIds?: ReadonlySet<ThreadId> }
type DeleteThreadAction = (threadId: ThreadId, opts?: DeleteThreadOptions) => Promise<void>
type RemoveWorktreeFn = (input: { cwd: string; path: string; force: boolean }) => Promise<unknown>

type ThreadDeleteContext = {
  thread: ThreadEntry
  threadProject: ProjectEntry | undefined
  orphanedWorktreePath: string | null
  displayWorktreePath: string | null
  shouldNavigateToFallback: boolean
  fallbackThreadId: ThreadId | null
}

function getThreadEntry(threadId: ThreadId) {
  return useStore.getState().threads.find(entry => entry.id === threadId)
}

function buildThreadDeleteContext(
  threadId: ThreadId,
  deletedThreadIds: ReadonlySet<ThreadId>,
  sortOrder: ReturnType<typeof useSettings>['sidebarThreadSortOrder'],
  routeThreadId: ThreadId | null
): ThreadDeleteContext | null {
  const { projects, threads } = useStore.getState()
  const thread = threads.find(entry => entry.id === threadId)
  if (!thread) return null
  const threadProject = projects.find(project => project.id === thread.projectId)
  const survivingThreads =
    deletedThreadIds.size > 0
      ? threads.filter(entry => entry.id === threadId || !deletedThreadIds.has(entry.id))
      : threads
  const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId)
  return {
    thread,
    threadProject,
    orphanedWorktreePath,
    displayWorktreePath: orphanedWorktreePath
      ? formatWorktreePathForDisplay(orphanedWorktreePath)
      : null,
    shouldNavigateToFallback: routeThreadId === threadId,
    fallbackThreadId: getFallbackThreadIdAfterDelete({
      threads,
      deletedThreadId: threadId,
      deletedThreadIds,
      sortOrder,
    }),
  }
}

async function confirmWorktreeDeletion(api: NativeApi, context: ThreadDeleteContext) {
  if (context.orphanedWorktreePath === null || context.threadProject === undefined) {
    return false
  }
  return api.dialogs.confirm(
    [
      'This thread is the only one linked to this worktree:',
      context.displayWorktreePath ?? context.orphanedWorktreePath,
      '',
      'Delete the worktree too?',
    ].join('\n')
  )
}

async function stopThreadSessionIfNeeded(api: NativeApi, threadId: ThreadId, thread: ThreadEntry) {
  if (thread.session && thread.session.status !== 'closed') {
    await api.orchestration
      .dispatchCommand({
        type: 'thread.session.stop',
        commandId: newCommandId(),
        threadId,
        createdAt: new Date().toISOString(),
      })
      .catch(() => undefined)
  }
}

async function closeThreadTerminalIfNeeded(api: NativeApi, threadId: ThreadId) {
  try {
    await api.terminal.close({ threadId, deleteHistory: true })
  } catch {
    // Terminal may already be closed.
  }
}

function clearDeletedThreadState(
  context: ThreadDeleteContext,
  clearComposerDraftForThread: (threadId: ThreadId) => void,
  clearProjectDraftThreadById: (projectId: ThreadEntry['projectId'], threadId: ThreadId) => void,
  clearTerminalState: (threadId: ThreadId) => void
) {
  clearComposerDraftForThread(context.thread.id)
  clearProjectDraftThreadById(context.thread.projectId, context.thread.id)
  clearTerminalState(context.thread.id)
}

async function navigateAfterThreadDelete(
  navigate: ReturnType<typeof useNavigate>,
  context: ThreadDeleteContext
) {
  if (!context.shouldNavigateToFallback) return
  if (context.fallbackThreadId) {
    await navigate({
      to: '/$threadId',
      params: { threadId: context.fallbackThreadId },
      replace: true,
    })
    return
  }
  await navigate({ to: '/', replace: true })
}

async function removeOrphanedWorktreeIfNeeded(
  threadId: ThreadId,
  context: ThreadDeleteContext,
  shouldDeleteWorktree: boolean,
  removeWorktree: RemoveWorktreeFn
) {
  if (!shouldDeleteWorktree || !context.orphanedWorktreePath || !context.threadProject) {
    return
  }
  try {
    await removeWorktree({
      cwd: context.threadProject.cwd,
      path: context.orphanedWorktreePath,
      force: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error removing worktree.'
    console.error('Failed to remove orphaned worktree after thread deletion', {
      threadId,
      projectCwd: context.threadProject.cwd,
      worktreePath: context.orphanedWorktreePath,
      error,
    })
    toastManager.add({
      type: 'error',
      title: 'Thread deleted, but worktree removal failed',
      description: `Could not remove ${context.displayWorktreePath ?? context.orphanedWorktreePath}. ${message}`,
    })
  }
}

async function deleteThreadAction(
  {
    sortOrder,
    routeThreadId,
    navigate,
    clearComposerDraftForThread,
    clearProjectDraftThreadById,
    clearTerminalState,
    removeWorktree,
  }: {
    sortOrder: ReturnType<typeof useSettings>['sidebarThreadSortOrder']
    routeThreadId: ThreadId | null
    navigate: ReturnType<typeof useNavigate>
    clearComposerDraftForThread: (threadId: ThreadId) => void
    clearProjectDraftThreadById: (projectId: ThreadEntry['projectId'], threadId: ThreadId) => void
    clearTerminalState: (threadId: ThreadId) => void
    removeWorktree: RemoveWorktreeFn
  },
  threadId: ThreadId,
  opts: DeleteThreadOptions = {}
): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  const deletedThreadIds = opts.deletedThreadIds ?? new Set<ThreadId>()
  const context = buildThreadDeleteContext(threadId, deletedThreadIds, sortOrder, routeThreadId)
  if (!context) return
  const shouldDeleteWorktree = await confirmWorktreeDeletion(api, context)
  await stopThreadSessionIfNeeded(api, threadId, context.thread)
  await closeThreadTerminalIfNeeded(api, threadId)
  await api.orchestration.dispatchCommand({
    type: 'thread.delete',
    commandId: newCommandId(),
    threadId,
  })
  clearDeletedThreadState(
    context,
    clearComposerDraftForThread,
    clearProjectDraftThreadById,
    clearTerminalState
  )
  await navigateAfterThreadDelete(navigate, context)
  await removeOrphanedWorktreeIfNeeded(threadId, context, shouldDeleteWorktree, removeWorktree)
}

async function confirmAndDeleteThreadAction(
  {
    confirmThreadDelete,
    deleteThread,
  }: {
    confirmThreadDelete: boolean
    deleteThread: DeleteThreadAction
  },
  threadId: ThreadId
) {
  const api = readNativeApi()
  if (!api) return
  const thread = getThreadEntry(threadId)
  if (!thread) return
  if (confirmThreadDelete) {
    const confirmed = await api.dialogs.confirm(
      [
        `Delete thread "${thread.title}"?`,
        'This permanently clears conversation history for this thread.',
      ].join('\n')
    )
    if (!confirmed) return
  }
  await deleteThread(threadId)
}

export function useThreadActions() {
  const appSettings = useSettings()
  const clearComposerDraftForThread = useComposerDraftStore(store => store.clearDraftThread)
  const clearProjectDraftThreadById = useComposerDraftStore(
    store => store.clearProjectDraftThreadById
  )
  const clearTerminalState = useTerminalStateStore(state => state.clearTerminalState)
  const routeThreadId = useParams({
    strict: false,
    select: params => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }))

  const deleteThread = useCallback(
    async (threadId: ThreadId, opts: DeleteThreadOptions = {}) =>
      deleteThreadAction(
        {
          sortOrder: appSettings.sidebarThreadSortOrder,
          routeThreadId,
          navigate,
          clearComposerDraftForThread,
          clearProjectDraftThreadById,
          clearTerminalState,
          removeWorktree: removeWorktreeMutation.mutateAsync,
        },
        threadId,
        opts
      ),
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      appSettings.sidebarThreadSortOrder,
      navigate,
      removeWorktreeMutation.mutateAsync,
      routeThreadId,
    ]
  )
  const confirmAndDeleteThread = useCallback(
    async (threadId: ThreadId) =>
      confirmAndDeleteThreadAction(
        {
          confirmThreadDelete: appSettings.confirmThreadDelete,
          deleteThread,
        },
        threadId
      ),
    [appSettings.confirmThreadDelete, deleteThread]
  )

  return {
    deleteThread,
    confirmAndDeleteThread,
  }
}
