/**
 * useSidebarRenderedProjects — computes per-project render data from derived sidebar state.
 */

import { useCallback, useMemo, useState } from 'react'
import type { ProjectId, ThreadId } from '@orxa-code/contracts'
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from '@orxa-code/contracts/settings'
import {
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  resolveThreadStatusPill,
  resolveProjectStatusIndicator,
  getVisibleThreadsForProject,
} from '../Sidebar.logic'
import { derivePendingApprovals, derivePendingUserInputs } from '../../session-logic'
import type { SidebarThreadSnapshot } from './ThreadRow'
import type {
  RenderedPinnedThreadData,
  RenderedProjectData,
  SidebarProjectSnapshot,
} from './ProjectItem'

const THREAD_PREVIEW_LIMIT = 6

// ---------------------------------------------------------------------------
// Per-project builder (extracted to keep hook body small)
// ---------------------------------------------------------------------------

function buildProjectChildThreadsMap(
  projectThreads: SidebarThreadSnapshot[]
): Map<ThreadId, SidebarThreadSnapshot[]> {
  const visibleThreadById = new Map(projectThreads.map(thread => [thread.id, thread] as const))
  const childThreadIdsByParentId = new Map<ThreadId, SidebarThreadSnapshot[]>()
  for (const thread of projectThreads) {
    const parentThreadId = thread.parentLink?.parentThreadId ?? null
    if (!parentThreadId || !visibleThreadById.has(parentThreadId)) continue
    const children = childThreadIdsByParentId.get(parentThreadId) ?? []
    children.push(thread)
    childThreadIdsByParentId.set(parentThreadId, children)
  }
  for (const entry of childThreadIdsByParentId.values()) {
    entry.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
  }
  return childThreadIdsByParentId
}

function buildRootProjectThreads(projectThreads: SidebarThreadSnapshot[]): SidebarThreadSnapshot[] {
  const visibleThreadById = new Map(projectThreads.map(thread => [thread.id, thread] as const))
  return projectThreads.filter(thread => {
    const parentThreadId = thread.parentLink?.parentThreadId ?? null
    return !parentThreadId || !visibleThreadById.has(parentThreadId)
  })
}

function buildRenderedThreadEntries(
  threads: ReadonlyArray<SidebarThreadSnapshot>,
  childThreadIdsByParentId: ReadonlyMap<ThreadId, SidebarThreadSnapshot[]>
): Array<{ thread: SidebarThreadSnapshot; nestingLevel: number }> {
  const renderedThreadEntries: Array<{ thread: SidebarThreadSnapshot; nestingLevel: number }> = []
  const appendThreadTree = (thread: SidebarThreadSnapshot, nestingLevel: number) => {
    renderedThreadEntries.push({ thread, nestingLevel })
    const children = childThreadIdsByParentId.get(thread.id) ?? []
    for (const child of children) {
      appendThreadTree(child, nestingLevel + 1)
    }
  }
  for (const thread of threads) {
    appendThreadTree(thread, 0)
  }
  return renderedThreadEntries
}

function buildRenderedProject(opts: {
  project: SidebarProjectSnapshot
  visibleThreads: SidebarThreadSnapshot[]
  sidebarThreadSortOrder: SidebarThreadSortOrder
  routeThreadId: ThreadId | null
  expandedThreadListsByProject: ReadonlySet<ProjectId>
}): RenderedProjectData {
  const { project, visibleThreads, sidebarThreadSortOrder, routeThreadId } = opts
  const projectThreads = sortThreadsForSidebar(
    visibleThreads.filter(t => t.projectId === project.id),
    sidebarThreadSortOrder
  )
  const childThreadIdsByParentId = buildProjectChildThreadsMap(projectThreads)
  const rootProjectThreads = buildRootProjectThreads(projectThreads)
  const threadStatuses = new Map(
    projectThreads.map(thread => [
      thread.id,
      resolveThreadStatusPill({
        thread: thread as Parameters<typeof resolveThreadStatusPill>[0]['thread'],
        hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
        hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
      }),
    ])
  )
  const projectStatus = resolveProjectStatusIndicator(
    projectThreads.map(t => threadStatuses.get(t.id) ?? null)
  )
  const activeThreadId = routeThreadId ?? undefined
  const isThreadListExpanded = opts.expandedThreadListsByProject.has(project.id)
  const pinnedCollapsedThread =
    !project.expanded && activeThreadId
      ? (projectThreads.find(t => t.id === activeThreadId) ?? null)
      : null
  const shouldShowThreadPanel = project.expanded || pinnedCollapsedThread !== null
  const {
    hasHiddenThreads,
    hiddenThreads,
    visibleThreads: visibleProjectThreads,
  } = getVisibleThreadsForProject({
    threads: rootProjectThreads,
    activeThreadId,
    isThreadListExpanded,
    previewLimit: THREAD_PREVIEW_LIMIT,
  })
  const hiddenThreadStatus = resolveProjectStatusIndicator(
    hiddenThreads.map(t => threadStatuses.get(t.id) ?? null)
  )
  const orderedProjectThreadIds = projectThreads.map(t => t.id)
  const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleProjectThreads
  const renderedThreadEntries = buildRenderedThreadEntries(
    renderedThreads,
    childThreadIdsByParentId
  )
  const showEmptyThreadState = project.expanded && projectThreads.length === 0
  return {
    hasHiddenThreads,
    hiddenThreadStatus,
    orderedProjectThreadIds,
    project: { ...project, expanded: project.expanded },
    projectStatus,
    projectThreads,
    threadStatuses,
    renderedThreadEntries,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
  }
}

function buildRenderedPinnedThreads(params: {
  pinnedThreadIds: readonly ThreadId[]
  sidebarProjects: ReadonlyArray<SidebarProjectSnapshot>
  sidebarThreadSortOrder: SidebarThreadSortOrder
  visibleThreads: ReadonlyArray<SidebarThreadSnapshot>
}): RenderedPinnedThreadData[] {
  const { pinnedThreadIds, sidebarProjects, sidebarThreadSortOrder, visibleThreads } = params
  if (pinnedThreadIds.length === 0) {
    return []
  }
  const orderedProjectThreadIdsByProject = new Map<ProjectId, readonly ThreadId[]>(
    sidebarProjects.map(project => [
      project.id,
      sortThreadsForSidebar(
        visibleThreads.filter(thread => thread.projectId === project.id),
        sidebarThreadSortOrder
      ).map(thread => thread.id),
    ])
  )
  const visibleThreadById = new Map(visibleThreads.map(thread => [thread.id, thread] as const))
  return pinnedThreadIds.flatMap(threadId => {
    const thread = visibleThreadById.get(threadId)
    if (!thread) {
      return []
    }
    return [
      {
        thread,
        orderedProjectThreadIds: orderedProjectThreadIdsByProject.get(thread.projectId) ?? [
          thread.id,
        ],
        threadStatus: resolveThreadStatusPill({
          thread: thread as Parameters<typeof resolveThreadStatusPill>[0]['thread'],
          hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
          hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
        }),
      } satisfies RenderedPinnedThreadData,
    ]
  })
}

function useExpandedThreadListsState() {
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set())

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject(current => {
      if (current.has(projectId)) return current
      const next = new Set(current)
      next.add(projectId)
      return next
    })
  }, [])

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject(current => {
      if (!current.has(projectId)) return current
      const next = new Set(current)
      next.delete(projectId)
      return next
    })
  }, [])

  return {
    expandedThreadListsByProject,
    expandThreadListForProject,
    collapseThreadListForProject,
  }
}

export function useSidebarRenderedProjects(params: {
  sidebarProjects: Array<SidebarProjectSnapshot>
  threads: SidebarThreadSnapshot[]
  pinnedThreadIds: readonly ThreadId[]
  routeThreadId: ThreadId | null
  sidebarProjectSortOrder: SidebarProjectSortOrder
  sidebarThreadSortOrder: SidebarThreadSortOrder
}): {
  renderedProjects: RenderedProjectData[]
  renderedPinnedThreads: RenderedPinnedThreadData[]
  isManualProjectSorting: boolean
  expandedThreadListsByProject: ReadonlySet<ProjectId>
  expandThreadListForProject: (projectId: ProjectId) => void
  collapseThreadListForProject: (projectId: ProjectId) => void
} {
  const {
    sidebarProjects,
    threads,
    pinnedThreadIds,
    routeThreadId,
    sidebarProjectSortOrder,
    sidebarThreadSortOrder,
  } = params

  const { expandedThreadListsByProject, expandThreadListForProject, collapseThreadListForProject } =
    useExpandedThreadListsState()
  const isManualProjectSorting = sidebarProjectSortOrder === 'manual'

  const visibleThreads = useMemo(() => threads.filter(t => t.archivedAt === null), [threads])
  const pinnedThreadIdSet = useMemo(() => new Set(pinnedThreadIds), [pinnedThreadIds])
  const visibleUnpinnedThreads = useMemo(
    () => visibleThreads.filter(thread => !pinnedThreadIdSet.has(thread.id)),
    [pinnedThreadIdSet, visibleThreads]
  )
  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(sidebarProjects, visibleThreads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, sidebarProjects, visibleThreads]
  )
  const renderedProjects = useMemo(
    () =>
      sortedProjects.map(project =>
        buildRenderedProject({
          project,
          visibleThreads: visibleUnpinnedThreads,
          sidebarThreadSortOrder,
          routeThreadId,
          expandedThreadListsByProject,
        })
      ),
    [
      sidebarThreadSortOrder,
      expandedThreadListsByProject,
      routeThreadId,
      sortedProjects,
      visibleUnpinnedThreads,
    ]
  )
  const renderedPinnedThreads = useMemo(() => {
    return buildRenderedPinnedThreads({
      pinnedThreadIds,
      sidebarProjects,
      sidebarThreadSortOrder,
      visibleThreads,
    })
  }, [pinnedThreadIds, sidebarProjects, sidebarThreadSortOrder, visibleThreads])

  return {
    renderedProjects,
    renderedPinnedThreads,
    isManualProjectSorting,
    expandedThreadListsByProject,
    expandThreadListForProject,
    collapseThreadListForProject,
  }
}
