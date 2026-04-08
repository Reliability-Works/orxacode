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
import type { RenderedProjectData, SidebarProjectSnapshot } from './ProjectItem'

const THREAD_PREVIEW_LIMIT = 6

// ---------------------------------------------------------------------------
// Per-project builder (extracted to keep hook body small)
// ---------------------------------------------------------------------------

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
    threads: projectThreads,
    activeThreadId,
    isThreadListExpanded,
    previewLimit: THREAD_PREVIEW_LIMIT,
  })
  const hiddenThreadStatus = resolveProjectStatusIndicator(
    hiddenThreads.map(t => threadStatuses.get(t.id) ?? null)
  )
  const orderedProjectThreadIds = projectThreads.map(t => t.id)
  const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleProjectThreads
  const showEmptyThreadState = project.expanded && projectThreads.length === 0
  return {
    hasHiddenThreads,
    hiddenThreadStatus,
    orderedProjectThreadIds,
    project: { ...project, expanded: project.expanded },
    projectStatus,
    projectThreads,
    threadStatuses,
    renderedThreads,
    showEmptyThreadState,
    shouldShowThreadPanel,
    isThreadListExpanded,
  }
}

export function useSidebarRenderedProjects(params: {
  sidebarProjects: Array<SidebarProjectSnapshot>
  threads: SidebarThreadSnapshot[]
  routeThreadId: ThreadId | null
  sidebarProjectSortOrder: SidebarProjectSortOrder
  sidebarThreadSortOrder: SidebarThreadSortOrder
}): {
  renderedProjects: RenderedProjectData[]
  isManualProjectSorting: boolean
  expandedThreadListsByProject: ReadonlySet<ProjectId>
  expandThreadListForProject: (projectId: ProjectId) => void
  collapseThreadListForProject: (projectId: ProjectId) => void
} {
  const {
    sidebarProjects,
    threads,
    routeThreadId,
    sidebarProjectSortOrder,
    sidebarThreadSortOrder,
  } = params

  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set())
  const isManualProjectSorting = sidebarProjectSortOrder === 'manual'

  const visibleThreads = useMemo(() => threads.filter(t => t.archivedAt === null), [threads])
  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(sidebarProjects, visibleThreads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, sidebarProjects, visibleThreads]
  )
  const renderedProjects = useMemo(
    () =>
      sortedProjects.map(project =>
        buildRenderedProject({
          project,
          visibleThreads,
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
      visibleThreads,
    ]
  )

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
    renderedProjects,
    isManualProjectSorting,
    expandedThreadListsByProject,
    expandThreadListForProject,
    collapseThreadListForProject,
  }
}
