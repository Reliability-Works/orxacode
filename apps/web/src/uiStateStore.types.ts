import { type ProjectId, type ThreadId } from '@orxa-code/contracts'

export interface PersistedUiState {
  expandedProjectCwds?: string[]
  projectOrderCwds?: string[]
  pinnedThreadIds?: string[]
  expandedParentThreadIds?: string[]
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>
  projectOrder: ProjectId[]
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>
  pinnedThreadIds: ThreadId[]
  expandedParentThreadIds: ThreadId[]
}

export interface UiState extends UiProjectState, UiThreadState {}

export interface PendingNewSessionModalRequest {
  projectId: ProjectId
  mode: 'default' | 'split-secondary'
  primaryThreadId?: ThreadId
}

export interface SyncProjectInput {
  id: ProjectId
  cwd: string
}

export interface SyncThreadInput {
  id: ThreadId
  seedVisitedAt?: string | undefined
}

export const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  pinnedThreadIds: [],
  expandedParentThreadIds: [],
}
