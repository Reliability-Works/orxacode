import { useEffect, useMemo } from 'react'
import type { ProjectListItem, WorkspaceWorktree } from '@shared/ipc'
import { collapseProjectsByWorkspaceRoot } from '../lib/workspace-roots'

type UseWorkspaceShellSurfaceArgs = {
  projects: ProjectListItem[]
  activeProjectDir: string | undefined
  projectSearchQuery: string
  projectSortMode: 'updated' | 'recent' | 'alpha-asc' | 'alpha-desc'
  workspaceMetaByDirectory: Record<string, { lastOpenedAt: number; lastUpdatedAt: number }>
  workspaceRootByDirectory: Record<string, string>
  worktreesByWorkspace: Record<string, WorkspaceWorktree[]>
  setSelectedWorkspaceWorktree: (workspaceRoot: string, directory?: string) => void
}

function buildFilteredProjects({
  projectSearchQuery,
  projectSortMode,
  projects,
  workspaceMetaByDirectory,
  workspaceRootByDirectory,
}: Pick<
  UseWorkspaceShellSurfaceArgs,
  | 'projectSearchQuery'
  | 'projectSortMode'
  | 'projects'
  | 'workspaceMetaByDirectory'
  | 'workspaceRootByDirectory'
>) {
  const query = projectSearchQuery.trim().toLowerCase()
  const filtered = collapseProjectsByWorkspaceRoot(projects, workspaceRootByDirectory).filter(
    project => {
      const name = (project.name || project.worktree.split('/').at(-1) || project.worktree).toLowerCase()
      return query ? name.includes(query) : true
    }
  )
  const withIndex = filtered.map((project, index) => ({ project, index }))
  withIndex.sort((left, right) => {
    const leftName =
      left.project.name || left.project.worktree.split('/').at(-1) || left.project.worktree
    const rightName =
      right.project.name || right.project.worktree.split('/').at(-1) || right.project.worktree
    if (projectSortMode === 'alpha-asc') {
      return leftName.localeCompare(rightName)
    }
    if (projectSortMode === 'alpha-desc') {
      return rightName.localeCompare(leftName)
    }
    if (projectSortMode === 'recent') {
      const leftTime = workspaceMetaByDirectory[left.project.worktree]?.lastOpenedAt ?? 0
      const rightTime = workspaceMetaByDirectory[right.project.worktree]?.lastOpenedAt ?? 0
      if (rightTime !== leftTime) {
        return rightTime - leftTime
      }
    }
    if (projectSortMode === 'updated') {
      const leftTime = workspaceMetaByDirectory[left.project.worktree]?.lastUpdatedAt ?? 0
      const rightTime = workspaceMetaByDirectory[right.project.worktree]?.lastUpdatedAt ?? 0
      if (rightTime !== leftTime) {
        return rightTime - leftTime
      }
    }
    return left.index - right.index
  })
  return withIndex.map(entry => entry.project)
}

export function useWorkspaceShellSurface({
  projects,
  activeProjectDir,
  projectSearchQuery,
  projectSortMode,
  workspaceMetaByDirectory,
  workspaceRootByDirectory,
  worktreesByWorkspace,
  setSelectedWorkspaceWorktree,
}: UseWorkspaceShellSurfaceArgs) {
  const activeProject = useMemo(
    () => projects.find(item => item.worktree === activeProjectDir),
    [projects, activeProjectDir]
  )

  const activeWorkspaceRoot = activeProjectDir
    ? workspaceRootByDirectory[activeProjectDir] ?? activeProjectDir
    : undefined

  const sidebarActiveProjectDir = activeWorkspaceRoot

  const filteredProjects = useMemo(() => buildFilteredProjects({
    projectSearchQuery,
    projectSortMode,
    projects,
    workspaceMetaByDirectory,
    workspaceRootByDirectory,
  }), [
    projectSearchQuery,
    projectSortMode,
    projects,
    workspaceMetaByDirectory,
    workspaceRootByDirectory,
  ])

  const activeWorkspaceWorktree = useMemo(() => {
    if (!activeProjectDir || !activeWorkspaceRoot) {
      return null
    }
    const worktrees = worktreesByWorkspace[activeWorkspaceRoot] ?? []
    const matched = worktrees.find(entry => entry.directory === activeProjectDir)
    if (matched) {
      return {
        directory: matched.directory,
        label:
          matched.name ||
          (matched.isMain ? 'main' : matched.directory.split('/').at(-1) || matched.directory),
        branch: matched.branch || undefined,
        isMain: matched.isMain,
      }
    }
    return {
      directory: activeProjectDir,
      label:
        activeProjectDir === activeWorkspaceRoot
          ? 'main'
          : activeProjectDir.split('/').at(-1) || activeProjectDir,
      branch: undefined,
      isMain: activeProjectDir === activeWorkspaceRoot,
    }
  }, [activeProjectDir, activeWorkspaceRoot, worktreesByWorkspace])

  useEffect(() => {
    if (!activeProjectDir || !activeWorkspaceRoot || activeProjectDir === activeWorkspaceRoot) {
      return
    }
    setSelectedWorkspaceWorktree(activeWorkspaceRoot, activeProjectDir)
  }, [activeProjectDir, activeWorkspaceRoot, setSelectedWorkspaceWorktree])

  return {
    activeProject,
    activeWorkspaceWorktree,
    filteredProjects,
    sidebarActiveProjectDir,
  }
}
