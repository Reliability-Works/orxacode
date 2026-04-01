import type { ProjectListItem } from '@shared/ipc'

export function collapseProjectsByWorkspaceRoot(
  projects: ProjectListItem[],
  workspaceRootByDirectory: Record<string, string>
) {
  const projectsByWorkspaceRoot = new Map<string, ProjectListItem>()
  projects.forEach(project => {
    const workspaceRoot = workspaceRootByDirectory[project.worktree] ?? project.worktree
    const existing = projectsByWorkspaceRoot.get(workspaceRoot)
    if (!existing || existing.worktree !== workspaceRoot) {
      projectsByWorkspaceRoot.set(
        workspaceRoot,
        existing?.worktree === workspaceRoot
          ? existing
          : project.worktree === workspaceRoot
            ? project
            : existing ?? { ...project, worktree: workspaceRoot }
      )
    }
  })
  return [...projectsByWorkspaceRoot.values()]
}
