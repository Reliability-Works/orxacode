import type {
  KanbanMergeStatus,
  KanbanRuntimeStatus,
  KanbanTask,
  KanbanTaskActivityKind,
  KanbanTaskRuntime,
  KanbanTaskTrashStatus,
  KanbanWorktree,
} from '../../shared/ipc'

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      ;(result as Record<string, unknown>)[key] = value
    }
  }
  return result
}

function deriveRuntimeStatus(task: KanbanTask): KanbanRuntimeStatus {
  return (task.trashStatus === 'trashed' ? 'archived' : task.statusSummary) as KanbanRuntimeStatus
}

function deriveTrashStatus(
  task: KanbanTask,
  current: KanbanTaskRuntime | null
): KanbanTaskTrashStatus {
  return (task.trashStatus ?? current?.trashStatus ?? 'active') as KanbanTaskTrashStatus
}

export function mergeRuntimeFields(
  task: KanbanTask,
  current: KanbanTaskRuntime | null,
  override: Partial<KanbanTaskRuntime> | undefined,
  resumeToken: string
): KanbanTaskRuntime {
  const fromCurrent: Partial<KanbanTaskRuntime> = current
    ? {
        terminalId: current.terminalId,
        worktreePath: current.worktreePath,
        baseRef: current.baseRef,
        taskBranch: current.taskBranch,
        lastEventSummary: current.lastEventSummary,
        latestPreview: current.latestPreview,
        latestActivityKind: current.latestActivityKind,
        mergeStatus: current.mergeStatus,
        trashStatus: current.trashStatus,
        checkpointCursor: current.checkpointCursor,
        lastCheckpointId: current.lastCheckpointId,
        trashedAt: current.trashedAt,
      }
    : {}

  const fromTask: Partial<KanbanTaskRuntime> = {
    worktreePath: task.worktreePath,
    baseRef: task.baseRef,
    taskBranch: task.taskBranch,
    latestPreview: task.latestPreview,
    latestActivityKind: task.latestActivityKind,
    mergeStatus: task.mergeStatus,
    trashStatus: task.trashStatus,
    trashedAt: task.trashedAt,
  }

  const merged = {
    taskId: task.id,
    workspaceDir: task.workspaceDir,
    provider: task.provider,
    status: deriveRuntimeStatus(task),
    resumeToken,
    trashStatus: deriveTrashStatus(task, current),
    updatedAt: Date.now(),
    ...stripUndefined(fromCurrent),
    ...stripUndefined(fromTask),
    ...stripUndefined(override ?? {}),
  } as KanbanTaskRuntime
  // These three fields must use specific derivation, not just spread precedence
  merged.status = override?.status ?? deriveRuntimeStatus(task)
  merged.resumeToken = override?.resumeToken ?? resumeToken
  merged.trashStatus = override?.trashStatus ?? deriveTrashStatus(task, current)
  return merged
}

function deriveWorktreeStatus(task: KanbanTask): KanbanWorktree['status'] {
  if (task.trashStatus === 'trashed') return 'trashed'
  if (task.statusSummary === 'running') return 'active'
  return 'ready'
}

export function mergeWorktreeFields(
  task: KanbanTask,
  current: KanbanWorktree | undefined,
  override: Partial<KanbanWorktree> | undefined
): KanbanWorktree {
  const fromCurrent: Partial<KanbanWorktree> = current
    ? {
        repoRoot: current.repoRoot,
        mergeStatus: current.mergeStatus,
        latestPreview: current.latestPreview,
        latestActivityKind: current.latestActivityKind,
        trashedAt: current.trashedAt,
      }
    : {}

  const fromTask: Partial<KanbanWorktree> = {
    latestPreview: task.latestPreview,
    latestActivityKind: task.latestActivityKind as KanbanTaskActivityKind | undefined,
    mergeStatus: task.mergeStatus as KanbanMergeStatus | undefined,
    trashedAt: task.trashedAt,
  }

  return {
    id: current?.id ?? '',
    workspaceDir: task.workspaceDir,
    taskId: task.id,
    label: task.title,
    provider: task.provider,
    repoRoot: task.workspaceDir,
    directory: task.worktreePath!,
    branch: task.taskBranch!,
    baseRef: task.baseRef!,
    status: deriveWorktreeStatus(task),
    mergeStatus: 'clean',
    createdAt: current?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    ...stripUndefined(fromCurrent),
    ...stripUndefined(fromTask),
    ...stripUndefined(override ?? {}),
  }
}
