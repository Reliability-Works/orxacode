import type { ProjectId } from '@orxa-code/contracts'

interface ResolveNewSessionProjectIdInput {
  projectId?: ProjectId | null | undefined
  activeThreadProjectId?: ProjectId | null | undefined
  activeDraftThreadProjectId?: ProjectId | null | undefined
  defaultProjectId?: ProjectId | null | undefined
}

export function resolveNewSessionProjectId(
  input: ResolveNewSessionProjectIdInput
): ProjectId | null {
  return (
    input.projectId ??
    input.activeThreadProjectId ??
    input.activeDraftThreadProjectId ??
    input.defaultProjectId ??
    null
  )
}
