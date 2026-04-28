/**
 * Sidebar — main navigation panel (thin orchestrator after decomposition).
 *
 * Extracted modules:
 * - `sidebar/ThreadRow.tsx`                  — thread-row rendering + status helpers
 * - `sidebar/ProjectItem.tsx`                — project-item rendering (uses ThreadRow)
 * - `sidebar/SidebarHelpers.tsx`             — ProjectSortMenu, SortableProjectItem
 * - `sidebar/useSidebarStoreBindings.ts`     — all store subscriptions
 * - `sidebar/useSidebarWiring.ts`            — hook wiring (derived data, actions, callbacks)
 * - `sidebar/useSidebarRenderedProjects.ts`  — per-project render data computation
 * - `sidebar/useSidebarCallbackFactories.ts` — getThreadRowProps / getProjectItemProps factories
 * - `Sidebar.hooks.ts`                       — custom hooks (callbacks, effects, derived data)
 * - `SidebarBody.tsx`                        — presentational return surface
 */

import { useEffect, useMemo, useState } from 'react'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'
import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
} from '@orxa-code/contracts/settings'
import { useSidebarStoreBindings } from './sidebar/useSidebarStoreBindings'
import { useSidebarWiring } from './sidebar/useSidebarWiring'
import { toSidebarThreadSnapshot } from './sidebar/useSidebarDerivedData'
import type { SidebarThreadSnapshot } from './sidebar/ThreadRow'
import { SidebarBody, type SidebarBodyProps } from './SidebarBody'
import { NewSessionModal } from './session'
import { useUiStateStore } from '../uiStateStore'
import { useChatsBaseDir } from '../hooks/useChatsBaseDir'
import { isChatProject } from '../lib/chatProject'
import type { Project, Thread } from '../types'

interface ChatProjectPartition {
  /**
   * Projects to render in the main project list (chat projects removed so they
   * don't appear as their own entry — chats are rendered in the dedicated
   * `SidebarChatGroup` instead).
   */
  nonChatProjects: Project[]
  /** Chat-only project subset, used to identify chat threads in the chat group. */
  chatProjects: Project[]
  /** Chat-only thread subset, in unsorted form. */
  chatThreads: Thread[]
}

function partitionByChatBaseDir(
  projects: Project[],
  threads: Thread[],
  baseDir: string | null
): ChatProjectPartition {
  if (!baseDir) {
    return { nonChatProjects: projects, chatProjects: [], chatThreads: [] }
  }
  const chatProjectIds = new Set<ProjectId>()
  const nonChatProjects: Project[] = []
  const chatProjects: Project[] = []
  for (const project of projects) {
    if (isChatProject(project, baseDir)) {
      chatProjectIds.add(project.id)
      chatProjects.push(project)
    } else {
      nonChatProjects.push(project)
    }
  }
  if (chatProjectIds.size === 0) {
    return { nonChatProjects: projects, chatProjects: [], chatThreads: [] }
  }
  const chatThreads: Thread[] = []
  for (const thread of threads) {
    if (chatProjectIds.has(thread.projectId)) chatThreads.push(thread)
  }
  return { nonChatProjects, chatProjects, chatThreads }
}

function useChatThreadSnapshots(
  chatThreads: Thread[],
  threadLastVisitedAtById: Record<ThreadId, string>
): SidebarThreadSnapshot[] {
  return useMemo(
    () =>
      chatThreads
        .filter(thread => thread.archivedAt === null)
        .map(thread => toSidebarThreadSnapshot(thread, threadLastVisitedAtById[thread.id]))
        .sort((a, b) => {
          const aKey = a.updatedAt ?? a.createdAt
          const bKey = b.updatedAt ?? b.createdAt
          return aKey < bKey ? 1 : aKey > bKey ? -1 : 0
        }),
    [chatThreads, threadLastVisitedAtById]
  )
}

function usePendingNewSessionModalEffect(opts: {
  setModalProjectId: (value: ProjectId | null) => void
  setModalPrimaryThreadId: (value: ThreadId | null) => void
  setModalOpen: (value: boolean) => void
}) {
  const pendingNewSessionModalRequest = useUiStateStore(
    store => store.pendingNewSessionModalRequest
  )
  const clearPendingNewSessionModal = useUiStateStore(store => store.clearPendingNewSessionModal)
  useEffect(() => {
    if (!pendingNewSessionModalRequest) return
    opts.setModalProjectId(pendingNewSessionModalRequest.projectId)
    opts.setModalPrimaryThreadId(
      pendingNewSessionModalRequest.mode === 'split-secondary'
        ? (pendingNewSessionModalRequest.primaryThreadId ?? null)
        : null
    )
    opts.setModalOpen(true)
    clearPendingNewSessionModal()
  }, [clearPendingNewSessionModal, pendingNewSessionModalRequest, opts])
}

// -- Re-exports for external consumers --

export type { SidebarThreadSnapshot } from './sidebar/ThreadRow'
export type { SidebarProjectSnapshot } from './sidebar/ProjectItem'

// -- Types --

export type FullSidebarProjectSnapshot = import('../types').Project & {
  expanded: boolean
}

function buildSidebarBodyProps(
  s: ReturnType<typeof useSidebarStoreBindings>,
  w: ReturnType<typeof useSidebarWiring>,
  chatGroup: {
    chatProjects: Project[]
    chatThreadSnapshots: SidebarThreadSnapshot[]
    chatBaseDir: string | null
  }
): SidebarBodyProps {
  return {
    isOnSettings: s.pathname.startsWith('/settings'),
    pathname: s.pathname,
    chatProjects: chatGroup.chatProjects,
    chatThreadSnapshots: chatGroup.chatThreadSnapshots,
    chatBaseDir: chatGroup.chatBaseDir,
    shouldShowProjectPathEntry:
      w.projectActions.addingProject && !s.shouldBrowseForProjectImmediately,
    showArm64IntelBuildWarning: w.desktopUpdate.showArm64IntelBuildWarning,
    arm64IntelBuildWarningDescription: w.desktopUpdate.arm64IntelBuildWarningDescription,
    desktopUpdateState: w.desktopUpdate.desktopUpdateState,
    desktopUpdateButtonAction: w.desktopUpdate.desktopUpdateButtonAction,
    desktopUpdateButtonDisabled: w.desktopUpdate.desktopUpdateButtonDisabled,
    onDesktopUpdateButtonClick: w.desktopUpdate.handleDesktopUpdateButtonClick,
    bootstrapComplete: s.bootstrapComplete,
    projects: s.projects,
    renderedPinnedThreads: w.renderedPinnedThreads,
    renderedProjects: w.renderedProjects,
    isManualProjectSorting: w.isManualProjectSorting,
    appSettings: {
      sidebarProjectSortOrder: s.appSettings.sidebarProjectSortOrder as SidebarProjectSortOrder,
      sidebarThreadSortOrder: s.appSettings.sidebarThreadSortOrder as SidebarThreadSortOrder,
    },
    onUpdateProjectSortOrder: (sortOrder: string) => {
      s.updateSettings({ sidebarProjectSortOrder: sortOrder as SidebarProjectSortOrder })
    },
    onUpdateThreadSortOrder: (sortOrder: string) => {
      s.updateSettings({ sidebarThreadSortOrder: sortOrder as SidebarThreadSortOrder })
    },
    newCwd: w.projectActions.newCwd,
    isPickingFolder: w.projectActions.isPickingFolder,
    isAddingProject: w.projectActions.isAddingProject,
    addProjectError: w.projectActions.addProjectError,
    addProjectInputRef: w.projectActions.addProjectInputRef,
    canAddProject: w.projectActions.canAddProject,
    onNewCwdChange: w.projectActions.setNewCwd,
    onAddProject: w.projectActions.handleAddProject,
    onStartAddProject: w.projectActions.handleStartAddProject,
    onPickFolder: w.projectActions.handlePickFolder,
    onAddProjectKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') w.projectActions.handleAddProject()
      if (e.key === 'Escape') {
        w.projectActions.setAddingProject(false)
        w.projectActions.setAddProjectError(null)
      }
    },
    onNavigateToSettings: () => void s.navigate({ to: '/settings' }),
    getThreadRowProps: w.getThreadRowProps,
    routeThreadId: s.routeThreadId,
    selectedThreadIds: s.selectedThreadIds,
    threadJumpLabelById: w.threadJumpLabelById,
    terminalStateByThreadId: s.terminalStateByThreadId,
    prByThreadId: w.prByThreadId,
    confirmingDeleteThreadId: w.confirmingDeleteThreadId,
    getProjectItemProps: w.getProjectItemProps,
    projectDnDSensors: w.projectActions.projectDnDSensors,
    projectCollisionDetection: w.projectActions.projectCollisionDetection,
    onProjectDragStart: w.projectActions.handleProjectDragStart,
    onProjectDragEnd: w.projectActions.handleProjectDragEnd,
    onProjectDragCancel: w.projectActions.handleProjectDragCancel,
    attachProjectListAutoAnimateRef: w.projectActions.attachProjectListAutoAnimateRef,
  }
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default function Sidebar() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalProjectId, setModalProjectId] = useState<ProjectId | null>(null)
  const [modalPrimaryThreadId, setModalPrimaryThreadId] = useState<ThreadId | null>(null)
  const s = useSidebarStoreBindings()
  const chatBaseDir = useChatsBaseDir()
  const partition = useMemo(
    () => partitionByChatBaseDir(s.projects, s.serverThreads, chatBaseDir),
    [s.projects, s.serverThreads, chatBaseDir]
  )
  // NOTE: only `projects` is filtered. `serverThreads` retains the full set so
  // wiring (delete handlers, jump labels, terminal/PR status, selection model)
  // applies uniformly to chat threads. Chat threads naturally drop out of the
  // project rendering paths because no matching project exists in
  // `partition.nonChatProjects`.
  const sWithModal: typeof s = {
    ...s,
    projects: partition.nonChatProjects,
    handleNewThread: projectId => {
      setModalProjectId(projectId)
      setModalOpen(true)
      return Promise.resolve()
    },
  }
  const w = useSidebarWiring(sWithModal)
  const handleCloseModal = () => {
    setModalOpen(false)
    setModalProjectId(null)
    setModalPrimaryThreadId(null)
  }
  usePendingNewSessionModalEffect({
    setModalProjectId,
    setModalPrimaryThreadId,
    setModalOpen,
  })
  const chatThreadSnapshots = useChatThreadSnapshots(
    partition.chatThreads,
    s.threadLastVisitedAtById
  )
  const bodyProps = buildSidebarBodyProps(sWithModal, w, {
    chatProjects: partition.chatProjects,
    chatThreadSnapshots,
    chatBaseDir,
  })

  return (
    <>
      {modalOpen ? (
        <NewSessionModal
          open
          onClose={handleCloseModal}
          projectId={modalProjectId}
          {...(modalPrimaryThreadId
            ? {
                onCreated: async threadId => {
                  await s.navigate({
                    to: '/$threadId',
                    params: { threadId: modalPrimaryThreadId },
                    search: previous => ({
                      ...previous,
                      split: '1',
                      secondaryThreadId: threadId,
                      focusedPane: 'secondary',
                      maximizedPane: undefined,
                    }),
                    replace: true,
                  })
                },
              }
            : {})}
        />
      ) : null}
      <SidebarBody {...bodyProps} />
    </>
  )
}

// ── Re-exports ──────────────────────────────────────────────────────

export { ProjectSortMenu, SortableProjectItem } from './sidebar/SidebarHelpers'
export { AppBrandMark } from './SidebarBody'
