import type { SessionType } from '../types/canvas'
import { useWorkspaceWorktrees } from './useWorkspaceWorktrees'

type UseWorkspaceDetailSurfaceArgs = {
  workspaceDetailDirectory: string | undefined
  createSession: (
    directory?: string,
    sessionTypeOrPrompt?: SessionType | string
  ) => Promise<unknown>
  setStatusLine: (value: string) => void
}

export function useWorkspaceDetailSurface({
  workspaceDetailDirectory,
  createSession,
  setStatusLine,
}: UseWorkspaceDetailSurfaceArgs) {
  return useWorkspaceWorktrees({
    workspaceDir: workspaceDetailDirectory,
    createSession,
    setStatusLine,
  })
}
