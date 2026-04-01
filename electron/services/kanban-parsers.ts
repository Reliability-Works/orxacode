import path from 'node:path'
import type {
  KanbanAutomation,
  KanbanColumnId,
  KanbanManagementSession,
  KanbanMergeStatus,
  KanbanProvider,
  KanbanReviewComment,
  KanbanRun,
  KanbanRunLogItem,
  KanbanRuntimeStatus,
  KanbanSchedule,
  KanbanSettings,
  KanbanTask,
  KanbanTaskActivityKind,
  KanbanTaskCheckpoint,
  KanbanTaskDependency,
  KanbanTaskRuntime,
  KanbanTaskStatusSummary,
  KanbanTaskTrashStatus,
  KanbanWorktree,
  KanbanWorkspace,
} from '../../shared/ipc'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseColumnId(value: unknown): KanbanColumnId {
  return (asString(value) || 'backlog') as KanbanColumnId
}

function defaultKanbanSettings(workspaceDir: string): KanbanSettings {
  return {
    workspaceDir,
    autoCommit: false,
    autoPr: false,
    defaultProvider: 'opencode',
    providerDefaults: {},
    scriptShortcuts: [],
    worktreeInclude: {
      filePath: path.join(workspaceDir, '.worktreeinclude'),
      detected: false,
      source: 'none',
      entries: [],
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  }
}

export function parseWorkspace(row: Record<string, unknown>): KanbanWorkspace {
  const directory = asString(row.workspace_dir)
  return {
    directory,
    name: path.basename(directory) || directory,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  }
}

export function parseTask(row: Record<string, unknown>): KanbanTask {
  const workspaceDir = asString(row.workspace_dir)
  const task = {
    id: asString(row.id),
    workspaceDir,
    title: asString(row.title),
    prompt: asString(row.prompt),
    description: asString(row.description),
    provider: (asString(row.provider) || 'opencode') as KanbanProvider,
    providerConfig: parseJson<KanbanTask['providerConfig']>(row.provider_config_json, undefined),
    columnId: parseColumnId(row.column_id),
    position: Number(row.position) || 0,
    statusSummary: (asString(row.status_summary) || 'idle') as KanbanTaskStatusSummary,
    worktreePath: asString(row.worktree_path) || undefined,
    baseRef: asString(row.base_ref) || undefined,
    taskBranch: asString(row.task_branch) || undefined,
    providerSessionKey: asString(row.provider_session_key) || undefined,
    providerThreadId: asString(row.provider_thread_id) || undefined,
    latestRunId: asString(row.latest_run_id) || undefined,
    autoStartWhenUnblocked: Number(row.auto_start_when_unblocked) === 1,
    blocked: false,
    shipStatus: (asString(row.ship_status) || 'unshipped') as KanbanTask['shipStatus'],
    trashStatus: (asString(row.trash_status) || 'active') as KanbanTaskTrashStatus,
    restoreColumnId: (asString(row.restore_column_id) ||
      undefined) as KanbanTask['restoreColumnId'],
    latestPreview: asString(row.latest_preview) || undefined,
    latestActivityKind: (asString(row.latest_activity_kind) || undefined) as
      | KanbanTaskActivityKind
      | undefined,
    mergeStatus: (asString(row.merge_status) || undefined) as KanbanMergeStatus | undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    completedAt: typeof row.completed_at === 'number' ? row.completed_at : undefined,
    trashedAt: typeof row.trashed_at === 'number' ? row.trashed_at : undefined,
  } satisfies KanbanTask
  return task
}

export function parseDependency(row: Record<string, unknown>): KanbanTaskDependency {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    fromTaskId: asString(row.from_task_id),
    toTaskId: asString(row.to_task_id),
    createdAt: Number(row.created_at) || Date.now(),
  }
}

export function parseRun(row: Record<string, unknown>): KanbanRun {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    taskId: asString(row.task_id) || undefined,
    automationId: asString(row.automation_id) || undefined,
    provider: (asString(row.provider) || 'opencode') as KanbanProvider,
    status: (asString(row.status) || 'running') as KanbanRun['status'],
    sessionKey: asString(row.session_key) || undefined,
    providerThreadId: asString(row.provider_thread_id) || undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    completedAt: typeof row.completed_at === 'number' ? row.completed_at : undefined,
    shipStatus: (asString(row.ship_status) || 'unshipped') as KanbanRun['shipStatus'],
    error: asString(row.error) || undefined,
    logs: parseJson<KanbanRunLogItem[]>(row.logs_json, []),
  }
}

export function parseAutomation(row: Record<string, unknown>): KanbanAutomation {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    name: asString(row.name),
    prompt: asString(row.prompt),
    provider: (asString(row.provider) || 'opencode') as KanbanProvider,
    browserModeEnabled: Number(row.browser_mode_enabled) === 1,
    enabled: Number(row.enabled) === 1,
    autoStart: Number(row.auto_start) === 1,
    schedule: parseJson<KanbanSchedule>(row.schedule_json, {
      type: 'daily',
      time: '09:00',
      days: [1, 2, 3, 4, 5],
    }),
    lastRunAt: typeof row.last_run_at === 'number' ? row.last_run_at : undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  }
}

export function parseReviewComment(row: Record<string, unknown>): KanbanReviewComment {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    taskId: asString(row.task_id),
    runId: asString(row.run_id) || undefined,
    filePath: asString(row.file_path),
    line: Number(row.line) || 1,
    body: asString(row.body),
    createdAt: Number(row.created_at) || Date.now(),
  }
}

export function parseSettings(
  row: Record<string, unknown> | null,
  workspaceDir: string
): KanbanSettings {
  if (!row) {
    return defaultKanbanSettings(workspaceDir)
  }
  return {
    workspaceDir,
    autoCommit: Number(row.auto_commit) === 1,
    autoPr: Number(row.auto_pr) === 1,
    defaultProvider: (asString(row.default_provider) || 'opencode') as KanbanProvider,
    providerDefaults: parseJson<KanbanSettings['providerDefaults']>(
      row.provider_defaults_json,
      {}
    ),
    scriptShortcuts: parseJson<KanbanSettings['scriptShortcuts']>(row.script_shortcuts_json, []),
    worktreeInclude: parseJson<KanbanSettings['worktreeInclude']>(
      row.worktree_include_json,
      defaultKanbanSettings(workspaceDir).worktreeInclude
    ),
    updatedAt: Number(row.updated_at) || Date.now(),
  }
}

export function parseRuntime(row: Record<string, unknown>): KanbanTaskRuntime {
  return {
    taskId: asString(row.task_id),
    workspaceDir: asString(row.workspace_dir),
    provider: (asString(row.provider) || 'opencode') as KanbanProvider,
    status: (asString(row.status) || 'idle') as KanbanRuntimeStatus,
    resumeToken: asString(row.resume_token) || undefined,
    terminalId: asString(row.terminal_id) || undefined,
    worktreePath: asString(row.worktree_path) || undefined,
    baseRef: asString(row.base_ref) || undefined,
    taskBranch: asString(row.task_branch) || undefined,
    lastEventSummary: asString(row.last_event_summary) || undefined,
    latestPreview: asString(row.latest_preview) || undefined,
    latestActivityKind: (asString(row.latest_activity_kind) || undefined) as
      | KanbanTaskActivityKind
      | undefined,
    mergeStatus: (asString(row.merge_status) || undefined) as KanbanMergeStatus | undefined,
    trashStatus: (asString(row.trash_status) || 'active') as KanbanTaskTrashStatus,
    checkpointCursor: asString(row.checkpoint_cursor) || undefined,
    lastCheckpointId: asString(row.last_checkpoint_id) || undefined,
    updatedAt: Number(row.updated_at) || Date.now(),
    trashedAt: typeof row.trashed_at === 'number' ? row.trashed_at : undefined,
  }
}

export function parseWorktree(row: Record<string, unknown>): KanbanWorktree {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    taskId: asString(row.task_id) || undefined,
    label: asString(row.label),
    provider: (asString(row.provider) || undefined) as KanbanProvider | undefined,
    repoRoot: asString(row.repo_root),
    directory: asString(row.directory),
    branch: asString(row.branch),
    baseRef: asString(row.base_ref),
    status: (asString(row.status) || 'ready') as KanbanWorktree['status'],
    mergeStatus: (asString(row.merge_status) || 'clean') as KanbanMergeStatus,
    latestPreview: asString(row.latest_preview) || undefined,
    latestActivityKind: (asString(row.latest_activity_kind) || undefined) as
      | KanbanTaskActivityKind
      | undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
    trashedAt: typeof row.trashed_at === 'number' ? row.trashed_at : undefined,
  }
}

export function parseCheckpoint(row: Record<string, unknown>): KanbanTaskCheckpoint {
  return {
    id: asString(row.id),
    workspaceDir: asString(row.workspace_dir),
    taskId: asString(row.task_id),
    runId: asString(row.run_id) || undefined,
    label: asString(row.label),
    source: (asString(row.source) || 'manual') as KanbanTaskCheckpoint['source'],
    sessionKey: asString(row.session_key) || undefined,
    providerThreadId: asString(row.provider_thread_id) || undefined,
    gitRevision: asString(row.git_revision) || undefined,
    diffRaw: asString(row.diff_raw),
    createdAt: Number(row.created_at) || Date.now(),
  }
}

export function parseManagementSession(row: Record<string, unknown>): KanbanManagementSession {
  return {
    workspaceDir: asString(row.workspace_dir),
    provider: (asString(row.provider) || 'opencode') as KanbanProvider,
    sessionKey: asString(row.session_key),
    providerThreadId: asString(row.provider_thread_id) || undefined,
    status: (asString(row.status) || 'idle') as KanbanManagementSession['status'],
    transcript: parseJson<KanbanManagementSession['transcript']>(row.transcript_json, []),
    updatedAt: Number(row.updated_at) || Date.now(),
    lastError: asString(row.last_error) || undefined,
  }
}
