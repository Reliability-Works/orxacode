/**
 * useSidebarDerivedData — memoized computations & queries for the Sidebar.
 */

import { useMemo } from 'react'
import { ProjectId, ThreadId } from '@orxa-code/contracts'
import type { GitStatusResult } from '@orxa-code/contracts'
import { useQueries } from '@tanstack/react-query'
import { gitStatusQueryOptions } from '../../lib/gitReactQuery'
import type { Thread, Project } from '../../types'
import type { ThreadTerminalState } from '../../terminalStateStore.logic'
import { orderItemsByPreferredIds } from '../Sidebar.logic'
import type { SidebarThreadSnapshot } from './ThreadRow'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarDerivedData {
  orderedProjects: Project[]
  sidebarProjects: Array<Project & { expanded: boolean }>
  threads: Array<SidebarThreadSnapshot>
  projectCwdById: Map<string, string>
  routeTerminalOpen: boolean
  sidebarShortcutLabelOptions: {
    platform: string
    context: { terminalFocus: boolean; terminalOpen: boolean }
  }
  threadGitTargets: Array<{ threadId: ThreadId; branch: string | null; cwd: string | null }>
  threadGitStatusCwds: readonly string[]
  threadGitStatusQueries: unknown[]
  prByThreadId: Map<ThreadId, GitStatusResult['pr'] | null>
}

// ---------------------------------------------------------------------------
// Thread snapshot helpers
// ---------------------------------------------------------------------------

const sidebarThreadSnapshotCache = new WeakMap<
  Thread,
  { lastVisitedAt?: string | undefined; snapshot: SidebarThreadSnapshot }
>()

/** Exported for cross-module cache sharing. */
export { sidebarThreadSnapshotCache }

function getLatestUserMessageAt(thread: Thread): string | null {
  let latestUserMessageAt: string | null = null
  for (const message of thread.messages) {
    if (message.role !== 'user') continue
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt
    }
  }
  return latestUserMessageAt
}

export function toSidebarThreadSnapshot(
  thread: Thread,
  lastVisitedAt: string | undefined
): SidebarThreadSnapshot {
  const cached = sidebarThreadSnapshotCache.get(thread)
  if (cached && cached.lastVisitedAt === lastVisitedAt) return cached.snapshot
  const snapshot: SidebarThreadSnapshot = {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    modelSelection: thread.modelSelection,
    session: thread.session,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    latestTurn: thread.latestTurn,
    lastVisitedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    parentLink: thread.parentLink ?? null,
    activities: thread.activities,
    proposedPlans: thread.proposedPlans,
    latestUserMessageAt: getLatestUserMessageAt(thread),
  }
  sidebarThreadSnapshotCache.set(thread, { lastVisitedAt, snapshot })
  return snapshot
}

// ---------------------------------------------------------------------------
// PR map computation
// ---------------------------------------------------------------------------

type GitTarget = { threadId: ThreadId; branch: string | null; cwd: string | null }
type GitQuery = { data?: GitStatusResult }

export function computePrByThreadId(
  cwds: readonly string[],
  queries: GitQuery[],
  targets: GitTarget[]
): Map<ThreadId, GitStatusResult['pr'] | null> {
  const statusByCwd = new Map<string, GitStatusResult>()
  for (let i = 0; i < cwds.length; i += 1) {
    const cwd = cwds[i]
    const status = queries[i]?.data
    if (cwd && status) statusByCwd.set(cwd, status)
  }
  const map = new Map<ThreadId, GitStatusResult['pr'] | null>()
  for (const t of targets) {
    const status = t.cwd ? statusByCwd.get(t.cwd) : undefined
    const match = t.branch !== null && status?.branch !== null && status?.branch === t.branch
    map.set(t.threadId, match ? (status?.pr ?? null) : null)
  }
  return map
}

// ---------------------------------------------------------------------------
// Git target helpers
// ---------------------------------------------------------------------------

export function computeThreadGitTargets(
  threads: SidebarThreadSnapshot[],
  projectCwdById: Map<string, string>
): GitTarget[] {
  return threads.map(thread => ({
    threadId: thread.id,
    branch: thread.branch,
    cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
  }))
}

export function computeThreadGitStatusCwds(targets: GitTarget[]): string[] {
  return [
    ...new Set(
      targets
        .filter(t => t.branch !== null)
        .map(t => t.cwd)
        .filter((cwd): cwd is string => cwd !== null)
    ),
  ]
}

// ---------------------------------------------------------------------------
// Git sub-hook
// ---------------------------------------------------------------------------

function useThreadGitData(threads: SidebarThreadSnapshot[], projectCwdById: Map<string, string>) {
  const threadGitTargets = useMemo(
    () => computeThreadGitTargets(threads, projectCwdById),
    [threads, projectCwdById]
  )
  const threadGitStatusCwds = useMemo(
    () => computeThreadGitStatusCwds(threadGitTargets),
    [threadGitTargets]
  )
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map(cwd => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  })
  const prByThreadId = useMemo(
    () =>
      computePrByThreadId(
        threadGitStatusCwds,
        threadGitStatusQueries as GitQuery[],
        threadGitTargets
      ),
    [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]
  )
  return { threadGitTargets, threadGitStatusCwds, threadGitStatusQueries, prByThreadId }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSidebarDerivedData(params: {
  projects: Project[]
  serverThreads: Thread[]
  projectOrder: readonly ProjectId[]
  projectExpandedById: Record<ProjectId, boolean>
  threadLastVisitedAtById: Record<string, string | undefined>
  routeThreadId: ThreadId | null
  terminalStateByThreadId: Record<ThreadId, ThreadTerminalState>
}): SidebarDerivedData {
  const {
    projects,
    serverThreads,
    projectOrder,
    projectExpandedById,
    threadLastVisitedAtById,
    routeThreadId,
    terminalStateByThreadId,
  } = params

  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: (p: Project) => p.id,
      }),
    [projectOrder, projects]
  )
  const sidebarProjects = useMemo(
    () => orderedProjects.map(p => ({ ...p, expanded: projectExpandedById[p.id] ?? true })),
    [orderedProjects, projectExpandedById]
  )
  const threads = useMemo(
    () => serverThreads.map(t => toSidebarThreadSnapshot(t, threadLastVisitedAtById[t.id])),
    [serverThreads, threadLastVisitedAtById]
  )
  const projectCwdById = useMemo(
    () => new Map(projects.map(p => [p.id, p.cwd] as const)),
    [projects]
  )
  const routeTerminalOpen = routeThreadId
    ? (terminalStateByThreadId[routeThreadId]?.terminalOpen ?? false)
    : false
  const sidebarShortcutLabelOptions = useMemo(
    () => ({
      platform: navigator.platform,
      context: { terminalFocus: false, terminalOpen: routeTerminalOpen },
    }),
    [routeTerminalOpen]
  )
  const gitData = useThreadGitData(threads, projectCwdById)

  return {
    orderedProjects,
    sidebarProjects,
    threads,
    projectCwdById,
    routeTerminalOpen,
    sidebarShortcutLabelOptions,
    ...gitData,
  }
}
