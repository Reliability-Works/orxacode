import type { OpenDirectoryResult, OpenDirectoryTarget } from './opencode-core'

export type WorkspaceWorktree = {
  id: string
  name: string
  directory: string
  repoRoot: string
  branch: string | null
  isMain: boolean
  locked: boolean
  prunable: boolean
}

export type CreateWorkspaceWorktreeInput = {
  workspaceDir: string
  name: string
  baseRef?: string
}

export type WorkspaceWorktreeOpenInput = {
  directory: string
  target: OpenDirectoryTarget
}

export type WorkspaceWorktreeOpenResult = OpenDirectoryResult
