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
  childThreadIdsByParentId: ReadonlyMap<ThreadId, SidebarThreadSnapshot[]>,
  expandedParentThreadIdSet: ReadonlySet<ThreadId>
): Array<{
  thread: SidebarThreadSnapshot
  nestingLevel: number
  hasChildren: boolean
  childrenExpanded: boolean
}> {
  const renderedThreadEntries: Array<{
    thread: SidebarThreadSnapshot
    nestingLevel: number
    hasChildren: boolean
    childrenExpanded: boolean
  }> = []
  const appendThreadTree = (thread: SidebarThreadSnapshot, nestingLevel: number) => {
    const children = childThreadIdsByParentId.get(thread.id) ?? []
    const hasChildren = children.length > 0
    const childrenExpanded = expandedParentThreadIdSet.has(thread.id)
    renderedThreadEntries.push({ thread, nestingLevel, hasChildren, childrenExpanded })
    if (children.length === 0 || !expandedParentThreadIdSet.has(thread.id)) {
      return
    }
    for (const child of children) {
      appendThreadTree(child, nestingLevel + 1)
    }
  }
  for (const thread of threads) {
    appendThreadTree(thread, 0)
  }
  return renderedThreadEntries
}

function buildParentThreadIdByChildId(
  projectThreads: ReadonlyArray<SidebarThreadSnapshot>
): Map<ThreadId, ThreadId> {
  const map = new Map<ThreadId, ThreadId>()
  for (const thread of projectThreads) {
    const parentThreadId = thread.parentLink?.parentThreadId ?? null
    if (parentThreadId) {
      map.set(thread.id, parentThreadId)
    }
  }
  return map
}

function buildForcedExpandedParentThreadIds(
  parentThreadIdByChildId: ReadonlyMap<ThreadId, ThreadId>,
  activeThreadId: ThreadId | null
): Set<ThreadId> {
  const forced = new Set<ThreadId>()
  let cursor = activeThreadId
  while (cursor) {
    const parentThreadId = parentThreadIdByChildId.get(cursor) ?? null
    if (!parentThreadId) {
      break
    }
    forced.add(parentThreadId)
    cursor = parentThreadId
  }
  return forced
}

function buildThreadStatuses(projectThreads: SidebarThreadSnapshot[]) {
  return new Map(
    projectThreads.map(thread => [
      thread.id,
      resolveThreadStatusPill({
        thread: thread as Parameters<typeof resolveThreadStatusPill>[0]['thread'],
        hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
        hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
      }),
    ])
  )
}

function buildExpandedParentThreadIdSet(input: {
  childThreadIdsByParentId: ReadonlyMap<ThreadId, SidebarThreadSnapshot[]>
  expandedParentThreadIds: readonly ThreadId[]
  routeThreadId: ThreadId | null
  parentThreadIdByChildId: ReadonlyMap<ThreadId, ThreadId>
}) {
  const forcedExpandedParentThreadIds = buildForcedExpandedParentThreadIds(
    input.parentThreadIdByChildId,
    input.routeThreadId
  )
  return new Set<ThreadId>([
    ...input.expandedParentThreadIds.filter(threadId =>
      input.childThreadIdsByParentId.has(threadId)
    ),
    ...forcedExpandedParentThreadIds,
  ])
}

function buildRenderedProject(opts: {
  project: SidebarProjectSnapshot
  visibleThreads: ReadonlyArray<SidebarThreadSnapshot>
  sidebarThreadSortOrder: SidebarThreadSortOrder
  routeThreadId: ThreadId | null
  expandedThreadListsByProject: ReadonlySet<ProjectId>
  expandedParentThreadIds: readonly ThreadId[]
}): RenderedProjectData {
  const { project, visibleThreads, sidebarThreadSortOrder, routeThreadId } = opts
  const projectThreads = sortThreadsForSidebar(
    visibleThreads.filter(t => t.projectId === project.id),
    sidebarThreadSortOrder
  )
  const childThreadIdsByParentId = buildProjectChildThreadsMap(projectThreads)
  const parentThreadIdByChildId = buildParentThreadIdByChildId(projectThreads)
  const rootProjectThreads = buildRootProjectThreads(projectThreads)
  const threadStatuses = buildThreadStatuses(projectThreads)
  const projectStatus = resolveProjectStatusIndicator(
    projectThreads.map(t => threadStatuses.get(t.id) ?? null)
  )
  const activeThreadId = routeThreadId ?? undefined
  const expandedParentThreadIdSet = buildExpandedParentThreadIdSet({
    childThreadIdsByParentId,
    expandedParentThreadIds: opts.expandedParentThreadIds,
    routeThreadId,
    parentThreadIdByChildId,
  })
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
    childThreadIdsByParentId,
    expandedParentThreadIdSet
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

function buildRenderedProjects(params: {
  sortedProjects: ReadonlyArray<SidebarProjectSnapshot>
  visibleUnpinnedThreads: ReadonlyArray<SidebarThreadSnapshot>
  sidebarThreadSortOrder: SidebarThreadSortOrder
  routeThreadId: ThreadId | null
  expandedThreadListsByProject: ReadonlySet<ProjectId>
  expandedParentThreadIds: readonly ThreadId[]
}) {
  return params.sortedProjects.map(project =>
    buildRenderedProject({
      project,
      visibleThreads: params.visibleUnpinnedThreads,
      sidebarThreadSortOrder: params.sidebarThreadSortOrder,
      routeThreadId: params.routeThreadId,
      expandedThreadListsByProject: params.expandedThreadListsByProject,
      expandedParentThreadIds: params.expandedParentThreadIds,
    })
  )
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
  expandedParentThreadIds: readonly ThreadId[]
  routeThreadId: ThreadId | null
  sidebarProjectSortOrder: SidebarProjectSortOrder
  sidebarThreadSortOrder: SidebarThreadSortOrder
}) {
  const {
    sidebarProjects,
    threads,
    pinnedThreadIds,
    expandedParentThreadIds,
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
      buildRenderedProjects({
        sortedProjects,
        visibleUnpinnedThreads,
        sidebarThreadSortOrder,
        routeThreadId,
        expandedThreadListsByProject,
        expandedParentThreadIds,
      }),
    [
      sidebarThreadSortOrder,
      expandedThreadListsByProject,
      expandedParentThreadIds,
      routeThreadId,
      sortedProjects,
      visibleUnpinnedThreads,
    ]
  )
  const renderedPinnedThreads = useMemo(
    () =>
      buildRenderedPinnedThreads({
        pinnedThreadIds,
        sidebarProjects,
        sidebarThreadSortOrder,
        visibleThreads,
      }),
    [pinnedThreadIds, sidebarProjects, sidebarThreadSortOrder, visibleThreads]
  )

  return {
    renderedProjects,
    renderedPinnedThreads,
    isManualProjectSorting,
    expandedThreadListsByProject,
    expandThreadListForProject,
    collapseThreadListForProject,
  }
}
