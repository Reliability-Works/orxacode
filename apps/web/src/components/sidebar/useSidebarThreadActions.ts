/**
 * useSidebarThreadActions — thread click / navigate / context-menu / rename / archive.
 */

import { useCallback, useRef, useState } from 'react'
import { ThreadId } from '@orxa-code/contracts'
import type { MouseEvent } from 'react'
import { isMacPlatform, newCommandId } from '../../lib/utils'
import { readNativeApi } from '../../nativeApi'
import { toastManager } from '../ui/toastState'
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard'
import type { SidebarThreadSnapshot } from './ThreadRow'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarThreadActionsReturn {
  handleThreadClick: (
    event: MouseEvent,
    threadId: ThreadId,
    orderedProjectThreadIds: readonly ThreadId[]
  ) => void
  navigateToThread: (threadId: ThreadId) => void
  handleThreadContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => Promise<void>
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>
  attemptArchiveThread: (threadId: ThreadId) => Promise<void>
  renamingThreadId: ThreadId | null
  renamingTitle: string
  setRenamingThreadId: React.Dispatch<React.SetStateAction<ThreadId | null>>
  setRenamingTitle: React.Dispatch<React.SetStateAction<string>>
  cancelRename: () => void
  commitRename: (threadId: ThreadId, newTitle: string, originalTitle: string) => Promise<void>
  renamingInputRef: React.RefObject<HTMLInputElement | null>
  renamingCommittedRef: React.MutableRefObject<boolean>
  copyThreadIdToClipboard: (threadId: ThreadId, ctx: { threadId: ThreadId }) => void
  copyPathToClipboard: (path: string, ctx: { path: string }) => void
}

// ---------------------------------------------------------------------------
// Extracted async helpers (no hooks — safe to extract)
// ---------------------------------------------------------------------------

async function execCommitRename(
  threadId: ThreadId,
  newTitle: string,
  originalTitle: string,
  finishRename: () => void
): Promise<void> {
  const trimmed = newTitle.trim()
  if (trimmed.length === 0) {
    toastManager.add({ type: 'warning', title: 'Thread title cannot be empty' })
    finishRename()
    return
  }
  if (trimmed === originalTitle) {
    finishRename()
    return
  }
  const api = readNativeApi()
  if (!api) {
    finishRename()
    return
  }
  try {
    await api.orchestration.dispatchCommand({
      type: 'thread.meta.update',
      commandId: newCommandId(),
      threadId,
      title: trimmed,
    })
  } catch (error) {
    toastManager.add({
      type: 'error',
      title: 'Failed to rename thread',
      description: error instanceof Error ? error.message : 'An error occurred.',
    })
  }
  finishRename()
}

async function execThreadContextMenu(opts: {
  threadId: ThreadId
  position: { x: number; y: number }
  threads: SidebarThreadSnapshot[]
  projectCwdById: Map<string, string | null>
  confirmThreadDelete: boolean
  setRenamingThreadId: React.Dispatch<React.SetStateAction<ThreadId | null>>
  setRenamingTitle: React.Dispatch<React.SetStateAction<string>>
  renamingCommittedRef: React.MutableRefObject<boolean>
  markThreadUnread: (threadId: ThreadId, completedAt?: string) => void
  copyPathToClipboard: (path: string, ctx: { path: string }) => void
  copyThreadIdToClipboard: (threadId: ThreadId, ctx: { threadId: ThreadId }) => void
  deleteThread: (
    threadId: ThreadId,
    opts?: { deletedThreadIds?: ReadonlySet<ThreadId> }
  ) => Promise<void>
}): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  const thread = opts.threads.find(t => t.id === opts.threadId)
  if (!thread) return
  const threadWorkspacePath =
    thread.worktreePath ?? opts.projectCwdById.get(thread.projectId) ?? null
  const clicked = await api.contextMenu.show(
    [
      { id: 'rename', label: 'Rename thread' },
      { id: 'mark-unread', label: 'Mark unread' },
      { id: 'copy-path', label: 'Copy Path' },
      { id: 'copy-thread-id', label: 'Copy Thread ID' },
      { id: 'delete', label: 'Delete', destructive: true },
    ],
    opts.position
  )
  if (clicked === 'rename') {
    opts.setRenamingThreadId(opts.threadId)
    opts.setRenamingTitle(thread.title)
    opts.renamingCommittedRef.current = false
    return
  }
  if (clicked === 'mark-unread') {
    opts.markThreadUnread(opts.threadId, thread.latestTurn?.completedAt ?? undefined)
    return
  }
  if (clicked === 'copy-path') {
    if (!threadWorkspacePath) {
      toastManager.add({
        type: 'error',
        title: 'Path unavailable',
        description: 'This thread does not have a workspace path to copy.',
      })
      return
    }
    opts.copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath })
    return
  }
  if (clicked === 'copy-thread-id') {
    opts.copyThreadIdToClipboard(opts.threadId, { threadId: opts.threadId })
    return
  }
  if (clicked !== 'delete') return
  if (opts.confirmThreadDelete) {
    const confirmed = await api.dialogs.confirm(
      [
        `Delete thread "${thread.title}"?`,
        'This permanently clears conversation history for this thread.',
      ].join('\n')
    )
    if (!confirmed) return
  }
  await opts.deleteThread(opts.threadId)
}

async function execMultiSelectContextMenu(opts: {
  position: { x: number; y: number }
  selectedThreadIds: ReadonlySet<ThreadId>
  threads: SidebarThreadSnapshot[]
  confirmThreadDelete: boolean
  markThreadUnread: (threadId: ThreadId, completedAt?: string) => void
  clearSelection: () => void
  deleteThread: (
    threadId: ThreadId,
    opts?: { deletedThreadIds?: ReadonlySet<ThreadId> }
  ) => Promise<void>
  removeFromSelection: (ids: ThreadId[]) => void
}): Promise<void> {
  const api = readNativeApi()
  if (!api) return
  const ids = [...opts.selectedThreadIds]
  if (ids.length === 0) return
  const count = ids.length
  const clicked = await api.contextMenu.show(
    [
      { id: 'mark-unread', label: `Mark unread (${count})` },
      { id: 'delete', label: `Delete (${count})`, destructive: true },
    ],
    opts.position
  )
  if (clicked === 'mark-unread') {
    for (const id of ids) {
      const thread = opts.threads.find(c => c.id === id)
      opts.markThreadUnread(id, thread?.latestTurn?.completedAt ?? undefined)
    }
    opts.clearSelection()
    return
  }
  if (clicked !== 'delete') return
  if (opts.confirmThreadDelete) {
    const confirmed = await api.dialogs.confirm(
      [
        `Delete ${count} thread${count === 1 ? '' : 's'}?`,
        'This permanently clears conversation history for these threads.',
      ].join('\n')
    )
    if (!confirmed) return
  }
  const deletedIds = new Set<ThreadId>(ids)
  for (const id of ids) {
    await opts.deleteThread(id, { deletedThreadIds: deletedIds })
  }
  opts.removeFromSelection(ids)
}

// ---------------------------------------------------------------------------
// Clipboard sub-hook (extracted to reduce hook body line count)
// ---------------------------------------------------------------------------

function useThreadClipboard() {
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: ctx =>
      toastManager.add({ type: 'success', title: 'Thread ID copied', description: ctx.threadId }),
    onError: err =>
      toastManager.add({
        type: 'error',
        title: 'Failed to copy thread ID',
        description: err instanceof Error ? err.message : 'An error occurred.',
      }),
  })
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ctx =>
      toastManager.add({ type: 'success', title: 'Path copied', description: ctx.path }),
    onError: err =>
      toastManager.add({
        type: 'error',
        title: 'Failed to copy path',
        description: err instanceof Error ? err.message : 'An error occurred.',
      }),
  })
  return { copyThreadIdToClipboard, copyPathToClipboard }
}

// ---------------------------------------------------------------------------
// Params type alias (reduces function signature line count)
// ---------------------------------------------------------------------------

export interface SidebarThreadActionsParams {
  navigate: ReturnType<typeof import('@tanstack/react-router').useNavigate>
  threads: SidebarThreadSnapshot[]
  projectCwdById: Map<string, string | null>
  appSettings: { confirmThreadDelete: boolean; confirmThreadArchive?: boolean }
  archiveThread: (threadId: ThreadId) => Promise<void>
  deleteThread: (
    threadId: ThreadId,
    opts?: { deletedThreadIds?: ReadonlySet<ThreadId> }
  ) => Promise<void>
  markThreadUnread: (threadId: ThreadId, completedAt?: string) => void
  selectedThreadIds: ReadonlySet<ThreadId>
  clearSelection: () => void
  toggleThreadSelection: (threadId: ThreadId) => void
  rangeSelectTo: (threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => void
  removeFromSelection: (ids: ThreadId[]) => void
  setSelectionAnchor: (threadId: ThreadId) => void
}

// ---------------------------------------------------------------------------
// Rename sub-hook
// ---------------------------------------------------------------------------

function useThreadRename() {
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null)
  const [renamingTitle, setRenamingTitle] = useState('')
  const renamingCommittedRef = useRef(false)
  const renamingInputRef = useRef<HTMLInputElement | null>(null)

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null)
    renamingInputRef.current = null
  }, [])

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () =>
        setRenamingThreadId(cur => {
          if (cur !== threadId) return cur
          renamingInputRef.current = null
          return null
        })
      await execCommitRename(threadId, newTitle, originalTitle, finishRename)
    },
    []
  )

  return {
    renamingThreadId,
    renamingTitle,
    setRenamingThreadId,
    setRenamingTitle,
    renamingCommittedRef,
    renamingInputRef,
    cancelRename,
    commitRename,
  }
}

// ---------------------------------------------------------------------------
// Navigation / click sub-hook
// ---------------------------------------------------------------------------

function useThreadNavigation(
  params: Pick<
    SidebarThreadActionsParams,
    | 'navigate'
    | 'selectedThreadIds'
    | 'clearSelection'
    | 'setSelectionAnchor'
    | 'toggleThreadSelection'
    | 'rangeSelectTo'
  >
) {
  const {
    navigate,
    selectedThreadIds,
    clearSelection,
    setSelectionAnchor,
    toggleThreadSelection,
    rangeSelectTo,
  } = params

  const navigateToThread = useCallback(
    (threadId: ThreadId) => {
      if (selectedThreadIds.size > 0) clearSelection()
      setSelectionAnchor(threadId)
      void navigate({ to: '/$threadId', params: { threadId } })
    },
    [clearSelection, navigate, selectedThreadIds.size, setSelectionAnchor]
  )

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform)
      const isModClick = isMac ? event.metaKey : event.ctrlKey
      if (isModClick) {
        event.preventDefault()
        toggleThreadSelection(threadId)
        return
      }
      if (event.shiftKey) {
        event.preventDefault()
        rangeSelectTo(threadId, orderedProjectThreadIds)
        return
      }
      if (selectedThreadIds.size > 0) clearSelection()
      setSelectionAnchor(threadId)
      void navigate({ to: '/$threadId', params: { threadId } })
    },
    [
      clearSelection,
      navigate,
      rangeSelectTo,
      selectedThreadIds.size,
      setSelectionAnchor,
      toggleThreadSelection,
    ]
  )

  return { navigateToThread, handleThreadClick }
}

// ---------------------------------------------------------------------------
// Context-menu sub-hook
// ---------------------------------------------------------------------------

interface ContextMenuHookParams extends Pick<
  SidebarThreadActionsParams,
  | 'threads'
  | 'projectCwdById'
  | 'appSettings'
  | 'markThreadUnread'
  | 'deleteThread'
  | 'selectedThreadIds'
  | 'clearSelection'
  | 'removeFromSelection'
> {
  setRenamingThreadId: React.Dispatch<React.SetStateAction<ThreadId | null>>
  setRenamingTitle: React.Dispatch<React.SetStateAction<string>>
  renamingCommittedRef: React.MutableRefObject<boolean>
  copyPathToClipboard: (path: string, ctx: { path: string }) => void
  copyThreadIdToClipboard: (threadId: ThreadId, ctx: { threadId: ThreadId }) => void
}

function useThreadContextMenus(params: ContextMenuHookParams) {
  const {
    threads,
    projectCwdById,
    appSettings,
    markThreadUnread,
    deleteThread,
    selectedThreadIds,
    clearSelection,
    removeFromSelection,
    setRenamingThreadId,
    setRenamingTitle,
    renamingCommittedRef,
    copyPathToClipboard,
    copyThreadIdToClipboard,
  } = params

  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      await execThreadContextMenu({
        threadId,
        position,
        threads,
        projectCwdById,
        confirmThreadDelete: appSettings.confirmThreadDelete,
        setRenamingThreadId,
        setRenamingTitle,
        renamingCommittedRef,
        markThreadUnread,
        copyPathToClipboard,
        copyThreadIdToClipboard,
        deleteThread,
      })
    },
    [
      appSettings.confirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      projectCwdById,
      renamingCommittedRef,
      setRenamingThreadId,
      setRenamingTitle,
      threads,
    ]
  )

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      await execMultiSelectContextMenu({
        position,
        selectedThreadIds,
        threads,
        confirmThreadDelete: appSettings.confirmThreadDelete,
        markThreadUnread,
        clearSelection,
        deleteThread,
        removeFromSelection,
      })
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
      threads,
    ]
  )

  return { handleThreadContextMenu, handleMultiSelectContextMenu }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarThreadActions(
  params: SidebarThreadActionsParams
): SidebarThreadActionsReturn {
  const { archiveThread } = params
  const { copyThreadIdToClipboard, copyPathToClipboard } = useThreadClipboard()
  const rename = useThreadRename()
  const nav = useThreadNavigation(params)

  const attemptArchiveThread = useCallback(
    async (threadId: ThreadId) => {
      try {
        await archiveThread(threadId)
      } catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Failed to archive thread',
          description: error instanceof Error ? error.message : 'An error occurred.',
        })
      }
    },
    [archiveThread]
  )

  const contextMenus = useThreadContextMenus({
    threads: params.threads,
    projectCwdById: params.projectCwdById,
    appSettings: params.appSettings,
    markThreadUnread: params.markThreadUnread,
    deleteThread: params.deleteThread,
    selectedThreadIds: params.selectedThreadIds,
    clearSelection: params.clearSelection,
    removeFromSelection: params.removeFromSelection,
    setRenamingThreadId: rename.setRenamingThreadId,
    setRenamingTitle: rename.setRenamingTitle,
    renamingCommittedRef: rename.renamingCommittedRef,
    copyPathToClipboard,
    copyThreadIdToClipboard,
  })

  return {
    handleThreadClick: nav.handleThreadClick,
    navigateToThread: nav.navigateToThread,
    handleThreadContextMenu: contextMenus.handleThreadContextMenu,
    handleMultiSelectContextMenu: contextMenus.handleMultiSelectContextMenu,
    attemptArchiveThread,
    renamingThreadId: rename.renamingThreadId,
    renamingTitle: rename.renamingTitle,
    setRenamingThreadId: rename.setRenamingThreadId,
    setRenamingTitle: rename.setRenamingTitle,
    cancelRename: rename.cancelRename,
    commitRename: rename.commitRename,
    renamingInputRef: rename.renamingInputRef,
    renamingCommittedRef: rename.renamingCommittedRef,
    copyThreadIdToClipboard,
    copyPathToClipboard,
  }
}
