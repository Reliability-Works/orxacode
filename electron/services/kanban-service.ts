import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  GitCommitRequest,
  KanbanAutomation,
  KanbanBoardSnapshot,
  KanbanCheckpointDiff,
  KanbanColumnId,
  KanbanCreateAutomationInput,
  KanbanCreateWorktreeInput,
  KanbanCreateTaskInput,
  KanbanDiffFile,
  KanbanGitCommitEntry,
  KanbanGitState,
  KanbanLegacyImportInput,
  KanbanManagementOperation,
  KanbanManagementPromptResult,
  KanbanManagementSession,
  KanbanMoveTaskInput,
  KanbanProvider,
  KanbanReviewComment,
  KanbanRun,
  KanbanScriptShortcutResult,
  KanbanSettings,
  KanbanTaskCheckpoint,
  KanbanTask,
  KanbanTaskDependency,
  KanbanTaskDetail,
  KanbanTaskRuntime,
  KanbanTaskStatusSummary,
  KanbanTaskTerminal,
  KanbanUpdateAutomationInput,
  KanbanUpdateSettingsInput,
  KanbanUpdateTaskInput,
  KanbanWorktree,
  KanbanWorktreeStatusDetail,
  OrxaEvent,
  SessionMessageBundle,
} from '../../shared/ipc'
import type { OpencodeService } from './opencode-service'
import type { CodexService } from './codex-service'
import type { ClaudeChatService } from './claude-chat-service'
import type { OrxaTerminalService } from './orxa-terminal-service'
import { getPersistenceDatabasePath } from './persistence-service'
import { OpencodeCommandHelpers } from './opencode-command-helpers'
import { sanitizeError } from './opencode-runtime-helpers'
import { parseUnifiedDiff } from './kanban-diff'
import { buildKanbanManagementPrompt, parseKanbanManagementResponse } from './kanban-management'
import { TaskWorktreeService, slugify } from './kanban-worktree-service'
import {
  asRecord,
  asString,
  parseAutomation,
  parseCheckpoint,
  parseDependency,
  parseManagementSession,
  parseReviewComment,
  parseRun,
  parseRuntime,
  parseSettings,
  parseTask,
  parseWorktree,
  parseWorkspace,
} from './kanban-parsers'
import type { PersistenceDatabase } from './kanban-schema'
import { createDatabase, initKanbanDatabase, migrateKanbanSchema } from './kanban-schema'
import { mergeRuntimeFields, mergeWorktreeFields } from './kanban-service-helpers'
import {
  refreshOpencodeTaskStatus,
  refreshCodexTaskStatus,
  refreshClaudeTaskStatus,
  startOpencodeProviderSession,
  startCodexProviderSession,
  startClaudeProviderSession,
} from './kanban-provider-refresh'

function summarizeSessionBundles(messages: SessionMessageBundle[]) {
  return messages.map((bundle, index) => {
    const content =
      bundle.parts
        .map(part => {
          const record = part as Record<string, unknown>
          return asString(record.text ?? record.content).trim()
        })
        .filter(part => part.length > 0)
        .join('\n\n') ||
      asString((bundle.info as Record<string, unknown>).summary).trim() ||
      '(no content)'
    return {
      id: asString((bundle.info as Record<string, unknown>).id) || `bundle-${index}`,
      role: ((bundle.info as Record<string, unknown>).role === 'user' ? 'user' : 'assistant') as
        | 'user'
        | 'assistant',
      content,
      timestamp:
        Number(asRecord((bundle.info as Record<string, unknown>).time)?.createdAt ?? Date.now()) ||
        Date.now(),
    }
  })
}

type KanbanServiceDeps = {
  opencodeService: OpencodeService
  codexService: CodexService
  claudeChatService: ClaudeChatService
  terminalService: OrxaTerminalService
  databasePath?: string
}

export class KanbanService extends EventEmitter {
  private readonly database: PersistenceDatabase
  private readonly worktrees: TaskWorktreeService
  private readonly opencodeService: OpencodeService
  private readonly codexService: CodexService
  private readonly claudeChatService: ClaudeChatService
  private readonly terminalService: OrxaTerminalService
  private readonly commands = new OpencodeCommandHelpers()
  private readonly schedulerTimer: ReturnType<typeof setInterval>
  private schedulerRunning = false
  onEvent?: (event: OrxaEvent) => void

  constructor({
    opencodeService,
    codexService,
    claudeChatService,
    terminalService,
    databasePath,
  }: KanbanServiceDeps) {
    super()
    const resolvedPath = databasePath ?? getPersistenceDatabasePath()
    mkdirSync(path.dirname(resolvedPath), { recursive: true })
    this.database = createDatabase(resolvedPath)
    this.worktrees = new TaskWorktreeService({
      patchesRootPath: path.join(path.dirname(resolvedPath), 'kanban-trashed-task-patches'),
    })
    this.opencodeService = opencodeService
    this.codexService = codexService
    this.claudeChatService = claudeChatService
    this.terminalService = terminalService
    initKanbanDatabase(this.database)
    migrateKanbanSchema(this.database)
    this.schedulerTimer = setInterval(() => {
      void this.runSchedulerTick()
    }, 30_000)
    this.schedulerTimer.unref?.()
  }

  destroy() {
    clearInterval(this.schedulerTimer)
  }

  private emitEvent(event: OrxaEvent) {
    this.onEvent?.(event)
  }

  private touchWorkspace(workspaceDir: string) {
    const now = Date.now()
    this.database
      .prepare(
        `
      INSERT INTO kanban_workspaces (workspace_dir, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET updated_at = excluded.updated_at
    `
      )
      .run(workspaceDir, now, now)
  }

  private touchBoard(workspaceDir: string) {
    this.touchWorkspace(workspaceDir)
    this.database
      .prepare(
        `
      INSERT INTO kanban_boards (workspace_dir, updated_at)
      VALUES (?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET updated_at = excluded.updated_at
    `
      )
      .run(workspaceDir, Date.now())
  }

  private listTasks(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_tasks
      WHERE workspace_dir = ?
      ORDER BY column_id ASC, position ASC, updated_at DESC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseTask(row))
  }

  private listDependencies(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_task_dependencies
      WHERE workspace_dir = ?
      ORDER BY created_at ASC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseDependency(row))
  }

  private listRunsInternal(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_runs
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseRun(row))
  }

  private listAutomationsInternal(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_automations
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseAutomation(row))
  }

  private listReviewComments(workspaceDir: string, taskId?: string) {
    const rows = taskId
      ? (this.database
          .prepare(
            `
        SELECT * FROM kanban_review_comments
        WHERE workspace_dir = ? AND task_id = ?
        ORDER BY created_at ASC
      `
          )
          .all(workspaceDir, taskId) as Record<string, unknown>[])
      : (this.database
          .prepare(
            `
        SELECT * FROM kanban_review_comments
        WHERE workspace_dir = ?
        ORDER BY created_at ASC
      `
          )
          .all(workspaceDir) as Record<string, unknown>[])
    return rows.map(row => parseReviewComment(row))
  }

  private listWorkspacesInternal() {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_workspaces
      ORDER BY updated_at DESC, workspace_dir ASC
    `
      )
      .all() as Record<string, unknown>[]
    return rows.map(row => parseWorkspace(row))
  }

  private getSettingsInternal(workspaceDir: string) {
    const row = this.database
      .prepare(
        `
      SELECT * FROM kanban_settings
      WHERE workspace_dir = ?
    `
      )
      .get(workspaceDir) as Record<string, unknown> | undefined
    return parseSettings(row ?? null, workspaceDir)
  }

  private listRuntimesInternal(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_task_runtime
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseRuntime(row))
  }

  private listWorktreesInternal(workspaceDir: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_worktrees
      WHERE workspace_dir = ?
      ORDER BY updated_at DESC, created_at DESC
    `
      )
      .all(workspaceDir) as Record<string, unknown>[]
    return rows.map(row => parseWorktree(row))
  }

  private getTaskRuntimeInternal(workspaceDir: string, taskId: string) {
    const row = this.database
      .prepare(
        `
      SELECT * FROM kanban_task_runtime
      WHERE workspace_dir = ? AND task_id = ?
    `
      )
      .get(workspaceDir, taskId) as Record<string, unknown> | undefined
    return row ? parseRuntime(row) : null
  }

  private listCheckpointsInternal(workspaceDir: string, taskId: string) {
    const rows = this.database
      .prepare(
        `
      SELECT * FROM kanban_task_checkpoints
      WHERE workspace_dir = ? AND task_id = ?
      ORDER BY created_at DESC
    `
      )
      .all(workspaceDir, taskId) as Record<string, unknown>[]
    return rows.map(row => parseCheckpoint(row))
  }

  private getManagementSessionInternal(workspaceDir: string, provider: KanbanProvider) {
    const row = this.database
      .prepare(
        `
      SELECT * FROM kanban_management_sessions
      WHERE workspace_dir = ? AND provider = ?
    `
      )
      .get(workspaceDir, provider) as Record<string, unknown> | undefined
    return row ? parseManagementSession(row) : null
  }

  private withBlocked(tasks: KanbanTask[], dependencies: KanbanTaskDependency[]) {
    const completed = new Set(
      tasks
        .filter(
          task =>
            task.completedAt ||
            task.statusSummary === 'completed' ||
            task.shipStatus === 'committed' ||
            task.shipStatus === 'pr_opened' ||
            task.shipStatus === 'merged'
        )
        .map(task => task.id)
    )
    return tasks.map(task => ({
      ...task,
      blocked: dependencies.some(dep => dep.toTaskId === task.id && !completed.has(dep.fromTaskId)),
    }))
  }

  private upsertTask(task: KanbanTask) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_tasks (
        id, workspace_dir, title, prompt, description, provider, provider_config_json, column_id, position,
        status_summary, worktree_path, base_ref, task_branch, provider_session_key,
        provider_thread_id, latest_run_id, auto_start_when_unblocked, ship_status,
        trash_status, restore_column_id, latest_preview, latest_activity_kind, merge_status,
        created_at, updated_at, completed_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        prompt = excluded.prompt,
        description = excluded.description,
        provider = excluded.provider,
        provider_config_json = excluded.provider_config_json,
        column_id = excluded.column_id,
        position = excluded.position,
        status_summary = excluded.status_summary,
        worktree_path = excluded.worktree_path,
        base_ref = excluded.base_ref,
        task_branch = excluded.task_branch,
        provider_session_key = excluded.provider_session_key,
        provider_thread_id = excluded.provider_thread_id,
        latest_run_id = excluded.latest_run_id,
        auto_start_when_unblocked = excluded.auto_start_when_unblocked,
        ship_status = excluded.ship_status,
        trash_status = excluded.trash_status,
        restore_column_id = excluded.restore_column_id,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        merge_status = excluded.merge_status,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        trashed_at = excluded.trashed_at
    `
      )
      .run(
        task.id,
        task.workspaceDir,
        task.title,
        task.prompt,
        task.description,
        task.provider,
        JSON.stringify(task.providerConfig ?? {}),
        task.columnId,
        task.position,
        task.statusSummary,
        task.worktreePath ?? null,
        task.baseRef ?? null,
        task.taskBranch ?? null,
        task.providerSessionKey ?? null,
        task.providerThreadId ?? null,
        task.latestRunId ?? null,
        task.autoStartWhenUnblocked ? 1 : 0,
        task.shipStatus ?? 'unshipped',
        task.trashStatus,
        task.restoreColumnId ?? null,
        task.latestPreview ?? null,
        task.latestActivityKind ?? null,
        task.mergeStatus ?? null,
        task.createdAt,
        task.updatedAt,
        task.completedAt ?? null,
        task.trashedAt ?? null
      )
    this.touchBoard(task.workspaceDir)
    return task
  }

  private upsertRun(run: KanbanRun) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_runs (
        id, workspace_dir, task_id, automation_id, provider, status, session_key,
        provider_thread_id, ship_status, error, logs_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        session_key = excluded.session_key,
        provider_thread_id = excluded.provider_thread_id,
        ship_status = excluded.ship_status,
        error = excluded.error,
        logs_json = excluded.logs_json,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `
      )
      .run(
        run.id,
        run.workspaceDir,
        run.taskId ?? null,
        run.automationId ?? null,
        run.provider,
        run.status,
        run.sessionKey ?? null,
        run.providerThreadId ?? null,
        run.shipStatus ?? 'unshipped',
        run.error ?? null,
        JSON.stringify(run.logs),
        run.createdAt,
        run.updatedAt,
        run.completedAt ?? null
      )
    this.touchBoard(run.workspaceDir)
    return run
  }

  private upsertSettings(settings: KanbanSettings) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_settings (
        workspace_dir, auto_commit, auto_pr, default_provider,
        provider_defaults_json, script_shortcuts_json, worktree_include_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_dir) DO UPDATE SET
        auto_commit = excluded.auto_commit,
        auto_pr = excluded.auto_pr,
        default_provider = excluded.default_provider,
        provider_defaults_json = excluded.provider_defaults_json,
        script_shortcuts_json = excluded.script_shortcuts_json,
        worktree_include_json = excluded.worktree_include_json,
        updated_at = excluded.updated_at
    `
      )
      .run(
        settings.workspaceDir,
        settings.autoCommit ? 1 : 0,
        settings.autoPr ? 1 : 0,
        settings.defaultProvider,
        JSON.stringify(settings.providerDefaults ?? {}),
        JSON.stringify(settings.scriptShortcuts),
        JSON.stringify(settings.worktreeInclude),
        settings.updatedAt
      )
    this.touchBoard(settings.workspaceDir)
    return settings
  }

  private upsertRuntime(runtime: KanbanTaskRuntime) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_task_runtime (
        task_id, workspace_dir, provider, status, resume_token, terminal_id,
        worktree_path, base_ref, task_branch, last_event_summary, latest_preview,
        latest_activity_kind, merge_status, trash_status, checkpoint_cursor,
        last_checkpoint_id, updated_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        workspace_dir = excluded.workspace_dir,
        provider = excluded.provider,
        status = excluded.status,
        resume_token = excluded.resume_token,
        terminal_id = excluded.terminal_id,
        worktree_path = excluded.worktree_path,
        base_ref = excluded.base_ref,
        task_branch = excluded.task_branch,
        last_event_summary = excluded.last_event_summary,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        merge_status = excluded.merge_status,
        trash_status = excluded.trash_status,
        checkpoint_cursor = excluded.checkpoint_cursor,
        last_checkpoint_id = excluded.last_checkpoint_id,
        updated_at = excluded.updated_at,
        trashed_at = excluded.trashed_at
    `
      )
      .run(
        runtime.taskId,
        runtime.workspaceDir,
        runtime.provider,
        runtime.status,
        runtime.resumeToken ?? null,
        runtime.terminalId ?? null,
        runtime.worktreePath ?? null,
        runtime.baseRef ?? null,
        runtime.taskBranch ?? null,
        runtime.lastEventSummary ?? null,
        runtime.latestPreview ?? null,
        runtime.latestActivityKind ?? null,
        runtime.mergeStatus ?? null,
        runtime.trashStatus,
        runtime.checkpointCursor ?? null,
        runtime.lastCheckpointId ?? null,
        runtime.updatedAt,
        runtime.trashedAt ?? null
      )
    this.touchBoard(runtime.workspaceDir)
    return runtime
  }

  private upsertWorktree(worktree: KanbanWorktree) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_worktrees (
        id, workspace_dir, task_id, label, provider, repo_root, directory, branch, base_ref,
        status, merge_status, latest_preview, latest_activity_kind, created_at, updated_at, trashed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        label = excluded.label,
        provider = excluded.provider,
        repo_root = excluded.repo_root,
        directory = excluded.directory,
        branch = excluded.branch,
        base_ref = excluded.base_ref,
        status = excluded.status,
        merge_status = excluded.merge_status,
        latest_preview = excluded.latest_preview,
        latest_activity_kind = excluded.latest_activity_kind,
        updated_at = excluded.updated_at,
        trashed_at = excluded.trashed_at
    `
      )
      .run(
        worktree.id,
        worktree.workspaceDir,
        worktree.taskId ?? null,
        worktree.label,
        worktree.provider ?? null,
        worktree.repoRoot,
        worktree.directory,
        worktree.branch,
        worktree.baseRef,
        worktree.status,
        worktree.mergeStatus,
        worktree.latestPreview ?? null,
        worktree.latestActivityKind ?? null,
        worktree.createdAt,
        worktree.updatedAt,
        worktree.trashedAt ?? null
      )
    this.touchBoard(worktree.workspaceDir)
    return worktree
  }

  private upsertManagementSession(session: KanbanManagementSession) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_management_sessions (
        workspace_dir, provider, session_key, provider_thread_id,
        status, transcript_json, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_dir, provider) DO UPDATE SET
        session_key = excluded.session_key,
        provider_thread_id = excluded.provider_thread_id,
        status = excluded.status,
        transcript_json = excluded.transcript_json,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `
      )
      .run(
        session.workspaceDir,
        session.provider,
        session.sessionKey,
        session.providerThreadId ?? null,
        session.status,
        JSON.stringify(session.transcript),
        session.lastError ?? null,
        session.updatedAt
      )
    return session
  }

  private createCheckpointRecord(checkpoint: KanbanTaskCheckpoint) {
    this.database
      .prepare(
        `
      INSERT INTO kanban_task_checkpoints (
        id, workspace_dir, task_id, run_id, label, source,
        session_key, provider_thread_id, git_revision, diff_raw, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        checkpoint.id,
        checkpoint.workspaceDir,
        checkpoint.taskId,
        checkpoint.runId ?? null,
        checkpoint.label,
        checkpoint.source,
        checkpoint.sessionKey ?? null,
        checkpoint.providerThreadId ?? null,
        checkpoint.gitRevision ?? null,
        checkpoint.diffRaw,
        checkpoint.createdAt
      )
    const runtime = this.getTaskRuntimeInternal(checkpoint.workspaceDir, checkpoint.taskId)
    if (runtime) {
      this.upsertRuntime({
        ...runtime,
        lastCheckpointId: checkpoint.id,
        updatedAt: Date.now(),
      })
    }
    this.emitEvent({
      type: 'kanban.checkpoint',
      payload: {
        workspaceDir: checkpoint.workspaceDir,
        taskId: checkpoint.taskId,
        checkpoint,
      },
    })
    return checkpoint
  }

  private nextTaskPosition(workspaceDir: string, columnId: KanbanColumnId) {
    const row = this.database
      .prepare(
        `
      SELECT COALESCE(MAX(position), -1) AS position
      FROM kanban_tasks
      WHERE workspace_dir = ? AND column_id = ?
    `
      )
      .get(workspaceDir, columnId) as { position?: number } | undefined
    return (row?.position ?? -1) + 1
  }

  private buildResumeToken(task: KanbanTask, sessionKey?: string, providerThreadId?: string) {
    return JSON.stringify({
      sessionKey: sessionKey ?? task.providerSessionKey ?? null,
      providerThreadId: providerThreadId ?? task.providerThreadId ?? null,
    })
  }

  private syncRuntimeForTask(task: KanbanTask, override?: Partial<KanbanTaskRuntime>) {
    const current = this.getTaskRuntimeInternal(task.workspaceDir, task.id)
    const next = mergeRuntimeFields(task, current, override, this.buildResumeToken(task))
    return this.upsertRuntime(next)
  }

  private syncWorktreeForTask(task: KanbanTask, override?: Partial<KanbanWorktree>) {
    if (!task.worktreePath || !task.taskBranch || !task.baseRef) {
      return null
    }
    const current = this.listWorktreesInternal(task.workspaceDir).find(
      item => item.taskId === task.id || item.directory === task.worktreePath
    )
    const next = mergeWorktreeFields(task, current, override)
    if (!next.id) {
      next.id = randomUUID()
    }
    return this.upsertWorktree(next)
  }

  private async resolveGitRevision(directory: string) {
    const output = await this.commands
      .runCommandWithOutput('git', ['-C', directory, 'rev-parse', 'HEAD'], directory)
      .catch(() => '')
    return output.trim() || undefined
  }

  private async resolveRepoRoot(directory: string) {
    const output = await this.commands
      .runCommandWithOutput('git', ['-C', directory, 'rev-parse', '--show-toplevel'], directory)
      .catch(() => '')
    return output.trim() || path.resolve(directory)
  }

  private resolveWorktreeIncludeSettings(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir)
    const repoRoot = existsSync(normalized) ? normalized : path.resolve(workspaceDir)
    const current = this.getSettingsInternal(normalized)
    const include = this.worktrees.readWorktreeInclude(repoRoot)
    if (
      include.detected ||
      current.worktreeInclude.source !== 'none' ||
      current.worktreeInclude.entries.length === 0
    ) {
      return { settings: { ...current, worktreeInclude: include }, repoRoot }
    }
    return {
      settings: {
        ...current,
        worktreeInclude: {
          ...current.worktreeInclude,
          filePath: include.filePath,
          detected: false,
        },
      },
      repoRoot,
    }
  }

  private async captureCurrentDiff(task: KanbanTask) {
    const directory = task.worktreePath ?? task.workspaceDir
    return this.opencodeService.gitDiff(directory).catch(error => sanitizeError(error))
  }

  private async createCheckpoint(
    task: KanbanTask,
    source: KanbanTaskCheckpoint['source'],
    label: string
  ) {
    const diffRaw = await this.captureCurrentDiff(task)
    const checkpoint: KanbanTaskCheckpoint = {
      id: randomUUID(),
      workspaceDir: task.workspaceDir,
      taskId: task.id,
      runId: task.latestRunId,
      label,
      source,
      sessionKey: task.providerSessionKey,
      providerThreadId: task.providerThreadId,
      gitRevision: await this.resolveGitRevision(task.worktreePath ?? task.workspaceDir),
      diffRaw,
      createdAt: Date.now(),
    }
    return this.createCheckpointRecord(checkpoint)
  }

  private async ensureTaskTerminal(task: KanbanTask) {
    const runtime = this.getTaskRuntimeInternal(task.workspaceDir, task.id)
    if (runtime?.terminalId) {
      const current = this.terminalService
        .listPtys(task.workspaceDir, 'kanban')
        .find(entry => entry.id === runtime.terminalId)
      if (current) {
        return current
      }
    }
    const cwd = task.worktreePath ?? task.workspaceDir
    const terminal = this.terminalService.createPty(
      task.workspaceDir,
      cwd,
      `Kanban: ${task.title}`,
      'kanban'
    )
    this.syncRuntimeForTask(task, { terminalId: terminal.id, worktreePath: cwd })
    this.emitEvent({
      type: 'kanban.runtime',
      payload: {
        workspaceDir: task.workspaceDir,
        runtime: this.getTaskRuntimeInternal(task.workspaceDir, task.id)!,
      },
    })
    return terminal
  }

  private async maybeAutoShipTask(task: KanbanTask) {
    if (
      !task.completedAt ||
      task.trashStatus === 'trashed' ||
      task.shipStatus === 'committed' ||
      task.shipStatus === 'pr_opened' ||
      task.shipStatus === 'merged'
    ) {
      return
    }
    const settings = this.getSettingsInternal(task.workspaceDir)
    if (settings.autoPr) {
      await this.openTaskPr(task.workspaceDir, task.id).catch(() => undefined)
      return
    }
    if (settings.autoCommit) {
      await this.commitTask(task.workspaceDir, task.id).catch(() => undefined)
    }
  }

  private async refreshTask(task: KanbanTask) {
    try {
      const previousStatusSummary = task.statusSummary
      const result = await this.refreshTaskProviderStatus(task)
      if (result) {
        task.statusSummary = result.statusSummary
        if (result.providerThreadId !== undefined) {
          task.providerThreadId = result.providerThreadId
        }
        task.latestPreview = result.latestPreview || task.latestPreview
        task.latestActivityKind = result.latestActivityKind ?? task.latestActivityKind
      }
      if (task.statusSummary === 'completed' && !task.completedAt) {
        task.completedAt = Date.now()
      }
      task.updatedAt = Date.now()
      this.upsertTask(task)
      this.syncLatestRunForTaskStatus(task, previousStatusSummary)
      const runtime = this.syncRuntimeForTask(task, {
        lastEventSummary: result?.lastEventSummary,
        latestPreview: task.latestPreview,
        latestActivityKind: task.latestActivityKind,
      })
      this.syncWorktreeForTask(task, {
        latestPreview: task.latestPreview,
        latestActivityKind: task.latestActivityKind,
      })
      this.emitEvent({
        type: 'kanban.runtime',
        payload: { workspaceDir: task.workspaceDir, runtime },
      })
      await this.maybeAutoShipTask(task)
    } catch {
      // Best effort runtime refresh.
    }
    return task
  }

  private async refreshTaskProviderStatus(task: KanbanTask) {
    if (task.provider === 'opencode' && task.worktreePath && task.providerThreadId) {
      return refreshOpencodeTaskStatus(task, this.opencodeService)
    }
    if (task.provider === 'codex' && task.providerThreadId) {
      return refreshCodexTaskStatus(task, this.codexService)
    }
    if (task.provider === 'claude' && task.providerSessionKey) {
      return refreshClaudeTaskStatus(task, this.claudeChatService)
    }
    return null
  }

  private async startProviderSession(task: KanbanTask, worktreePath: string) {
    if (task.provider === 'opencode') {
      return startOpencodeProviderSession(task, worktreePath, this.opencodeService)
    }
    if (task.provider === 'codex') {
      return startCodexProviderSession(task, worktreePath, this.codexService)
    }
    return startClaudeProviderSession(task, worktreePath, this.claudeChatService)
  }

  private async refreshWorkspace(workspaceDir: string) {
    const tasks = this.listTasks(workspaceDir)
    await Promise.all(
      tasks
        .filter(task => task.statusSummary === 'running' || task.statusSummary === 'starting')
        .map(task => this.refreshTask(task))
    )
    await this.evaluateDueAutomations(workspaceDir)
    await this.tryAutoStartUnblocked(workspaceDir)
  }

  async listWorkspaces() {
    return this.listWorkspacesInternal()
  }

  async addWorkspaceDirectory(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir)
    this.touchWorkspace(normalized)
    return this.listWorkspacesInternal().find(workspace => workspace.directory === normalized)
  }

  async removeWorkspaceDirectory(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir)
    for (const terminal of this.terminalService.listPtys(normalized, 'kanban')) {
      try {
        this.terminalService.closePty(normalized, terminal.id)
      } catch {
        // Best effort terminal cleanup.
      }
    }
    this.database
      .prepare(`DELETE FROM kanban_review_comments WHERE workspace_dir = ?`)
      .run(normalized)
    this.database
      .prepare(`DELETE FROM kanban_task_checkpoints WHERE workspace_dir = ?`)
      .run(normalized)
    this.database.prepare(`DELETE FROM kanban_task_runtime WHERE workspace_dir = ?`).run(normalized)
    this.database
      .prepare(`DELETE FROM kanban_management_sessions WHERE workspace_dir = ?`)
      .run(normalized)
    this.database.prepare(`DELETE FROM kanban_settings WHERE workspace_dir = ?`).run(normalized)
    this.database.prepare(`DELETE FROM kanban_runs WHERE workspace_dir = ?`).run(normalized)
    this.database
      .prepare(`DELETE FROM kanban_task_dependencies WHERE workspace_dir = ?`)
      .run(normalized)
    this.database.prepare(`DELETE FROM kanban_tasks WHERE workspace_dir = ?`).run(normalized)
    this.database.prepare(`DELETE FROM kanban_automations WHERE workspace_dir = ?`).run(normalized)
    this.database.prepare(`DELETE FROM kanban_boards WHERE workspace_dir = ?`).run(normalized)
    this.database.prepare(`DELETE FROM kanban_workspaces WHERE workspace_dir = ?`).run(normalized)
    return true
  }

  async getSettings(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir)
    this.touchWorkspace(normalized)
    const { settings } = this.resolveWorktreeIncludeSettings(normalized)
    return settings
  }

  async updateSettings(input: KanbanUpdateSettingsInput) {
    const normalized = path.resolve(input.workspaceDir)
    const current = this.getSettingsInternal(normalized)
    const next: KanbanSettings = {
      ...current,
      ...input,
      workspaceDir: normalized,
      updatedAt: Date.now(),
      providerDefaults: input.providerDefaults ?? current.providerDefaults,
      scriptShortcuts: input.scriptShortcuts ?? current.scriptShortcuts,
      worktreeInclude: input.worktreeInclude ?? current.worktreeInclude,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      autoCommit: input.autoCommit ?? current.autoCommit,
      autoPr: input.autoPr ?? current.autoPr,
    }
    return this.upsertSettings(next)
  }

  async getBoard(workspaceDir: string): Promise<KanbanBoardSnapshot> {
    const normalized = path.resolve(workspaceDir)
    this.touchBoard(normalized)
    await this.refreshWorkspace(normalized)
    const tasks = this.listTasks(normalized)
    const dependencies = this.listDependencies(normalized)
    const activeTasks = tasks.filter(task => task.trashStatus !== 'trashed')
    const trashedTasks = tasks.filter(task => task.trashStatus === 'trashed')
    const snapshot = {
      workspaceDir: normalized,
      settings: this.getSettingsInternal(normalized),
      tasks: this.withBlocked(activeTasks, dependencies),
      trashedTasks,
      runtimes: this.listRuntimesInternal(normalized),
      worktrees: this.listWorktreesInternal(normalized),
      dependencies,
      runs: this.listRunsInternal(normalized),
      automations: this.listAutomationsInternal(normalized),
      reviewComments: this.listReviewComments(normalized),
    } satisfies KanbanBoardSnapshot
    this.emitEvent({ type: 'kanban.board', payload: { workspaceDir: normalized, snapshot } })
    return snapshot
  }

  async importLegacyJobs(input: KanbanLegacyImportInput) {
    for (const job of input.jobs) {
      const normalized = path.resolve(job.projectDir)
      const existing = this.database
        .prepare(
          `
        SELECT id FROM kanban_automations WHERE id = ?
      `
        )
        .get(job.id) as { id?: string } | undefined
      if (!existing) {
        this.createAutomation({
          id: job.id,
          workspaceDir: normalized,
          name: job.name,
          prompt: job.prompt,
          provider: job.agentMode ?? 'opencode',
          browserModeEnabled: job.browserModeEnabled === true,
          enabled: job.enabled,
          autoStart: true,
          schedule: job.schedule,
          lastRunAt: job.lastRunAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
      }
    }
    for (const run of input.runs) {
      const existing = this.database
        .prepare(`SELECT id FROM kanban_runs WHERE id = ?`)
        .get(run.id) as { id?: string } | undefined
      if (existing) {
        continue
      }
      this.upsertRun({
        id: run.id,
        workspaceDir: path.resolve(run.projectDir),
        automationId: run.jobID,
        provider: 'opencode',
        status:
          run.status === 'failed' ? 'failed' : run.status === 'completed' ? 'completed' : 'running',
        sessionKey: run.sessionID,
        providerThreadId: run.sessionID,
        createdAt: run.createdAt,
        updatedAt: run.completedAt ?? run.createdAt,
        completedAt: run.completedAt,
        error: run.error,
        logs: [
          {
            id: randomUUID(),
            kind: 'system',
            level: run.error ? 'error' : 'info',
            message: run.error ?? `Migrated legacy job run: ${run.jobName}`,
            timestamp: run.createdAt,
          },
        ],
      })
    }
    return true
  }

  private createAutomation(
    input: KanbanCreateAutomationInput & {
      id?: string
      lastRunAt?: number
      createdAt?: number
      updatedAt?: number
      enabled?: boolean
    }
  ) {
    const now = Date.now()
    const automation: KanbanAutomation = {
      id: input.id ?? randomUUID(),
      workspaceDir: path.resolve(input.workspaceDir),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      provider: input.provider,
      browserModeEnabled: input.browserModeEnabled === true,
      enabled: input.enabled ?? true,
      autoStart: input.autoStart ?? true,
      schedule: input.schedule,
      lastRunAt: input.lastRunAt,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }
    this.database
      .prepare(
        `
      INSERT INTO kanban_automations (
        id, workspace_dir, name, prompt, provider, browser_mode_enabled,
        enabled, auto_start, schedule_json, last_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        prompt = excluded.prompt,
        provider = excluded.provider,
        browser_mode_enabled = excluded.browser_mode_enabled,
        enabled = excluded.enabled,
        auto_start = excluded.auto_start,
        schedule_json = excluded.schedule_json,
        last_run_at = excluded.last_run_at,
        updated_at = excluded.updated_at
    `
      )
      .run(
        automation.id,
        automation.workspaceDir,
        automation.name,
        automation.prompt,
        automation.provider,
        automation.browserModeEnabled ? 1 : 0,
        automation.enabled ? 1 : 0,
        automation.autoStart ? 1 : 0,
        JSON.stringify(automation.schedule),
        automation.lastRunAt ?? null,
        automation.createdAt,
        automation.updatedAt
      )
    this.touchBoard(automation.workspaceDir)
    return automation
  }

  async listAutomations(workspaceDir: string) {
    return this.listAutomationsInternal(path.resolve(workspaceDir))
  }

  async createAutomationPublic(input: KanbanCreateAutomationInput) {
    return this.createAutomation(input)
  }

  async updateAutomation(input: KanbanUpdateAutomationInput) {
    const normalized = path.resolve(input.workspaceDir)
    const current = this.listAutomationsInternal(normalized).find(
      automation => automation.id === input.id
    )
    if (!current) {
      throw new Error('Automation not found')
    }
    return this.createAutomation({
      ...current,
      ...input,
      workspaceDir: normalized,
      updatedAt: Date.now(),
    })
  }

  async deleteAutomation(workspaceDir: string, automationId: string) {
    this.database
      .prepare(`DELETE FROM kanban_automations WHERE workspace_dir = ? AND id = ?`)
      .run(path.resolve(workspaceDir), automationId)
    return true
  }

  async createTask(input: KanbanCreateTaskInput) {
    const normalized = path.resolve(input.workspaceDir)
    const task: KanbanTask = {
      id: randomUUID(),
      workspaceDir: normalized,
      title: input.title.trim() || 'New task',
      prompt: input.prompt.trim(),
      description: input.description?.trim() || '',
      provider: input.provider,
      providerConfig: input.providerConfig,
      columnId: input.columnId ?? 'backlog',
      position: this.nextTaskPosition(normalized, input.columnId ?? 'backlog'),
      statusSummary: 'idle',
      baseRef: input.baseRef?.trim() || undefined,
      autoStartWhenUnblocked: input.autoStartWhenUnblocked === true,
      blocked: false,
      shipStatus: 'unshipped',
      trashStatus: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.upsertTask(task)
    this.syncRuntimeForTask(task, { status: 'idle' })
    return task
  }

  async updateTask(input: KanbanUpdateTaskInput) {
    const normalized = path.resolve(input.workspaceDir)
    const current = this.listTasks(normalized).find(task => task.id === input.id)
    if (!current) {
      throw new Error('Task not found')
    }
    const next = {
      ...current,
      ...input,
      workspaceDir: normalized,
      title: input.title?.trim() ?? current.title,
      prompt: input.prompt?.trim() ?? current.prompt,
      description: input.description?.trim() ?? current.description,
      providerConfig: input.providerConfig ?? current.providerConfig,
      updatedAt: Date.now(),
    } satisfies KanbanTask
    this.upsertTask(next)
    this.syncRuntimeForTask(next, {
      provider: next.provider,
      baseRef: next.baseRef,
    })
    return next
  }

  async moveTask(input: KanbanMoveTaskInput) {
    const normalized = path.resolve(input.workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === input.taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    const tasks = this.listTasks(normalized).filter(
      candidate => candidate.columnId === input.columnId && candidate.id !== task.id
    )
    tasks.splice(Math.max(0, Math.min(input.position, tasks.length)), 0, {
      ...task,
      columnId: input.columnId,
      position: 0,
    })
    tasks.forEach((candidate, index) => {
      const nextTask = {
        ...candidate,
        columnId: input.columnId,
        position: index,
        updatedAt: Date.now(),
        ...(candidate.id === task.id && input.columnId === 'done'
          ? {
              statusSummary: 'completed',
              completedAt: Date.now(),
              shipStatus: candidate.shipStatus ?? 'unshipped',
            }
          : {}),
      } satisfies KanbanTask
      this.upsertTask(nextTask)
      this.syncRuntimeForTask(nextTask, {
        status: nextTask.trashStatus === 'trashed' ? 'archived' : nextTask.statusSummary,
      })
    })
    await this.tryAutoStartUnblocked(normalized)
    return this.getBoard(normalized)
  }

  async trashTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const current = this.listTasks(normalized).find(task => task.id === taskId)
    if (!current) {
      throw new Error('Task not found')
    }
    await this.stopTask(normalized, taskId).catch(() => undefined)
    await this.worktrees.cleanup(current).catch(() => undefined)
    const next = {
      ...current,
      restoreColumnId: current.columnId,
      trashStatus: 'trashed' as const,
      statusSummary: current.completedAt ? ('completed' as const) : ('stopped' as const),
      trashedAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.upsertTask(next)
    this.syncRuntimeForTask(next, {
      status: 'archived',
      trashedAt: Date.now(),
      trashStatus: 'trashed',
      worktreePath: undefined,
    })
    this.syncWorktreeForTask(next, { status: 'trashed', trashedAt: Date.now() })
    await this.tryAutoStartUnblocked(normalized)
    return next
  }

  async restoreTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const current = this.listTasks(normalized).find(task => task.id === taskId)
    if (!current) {
      throw new Error('Task not found')
    }
    const next = this.upsertTask({
      ...current,
      trashStatus: 'active',
      columnId: current.restoreColumnId ?? 'done',
      trashedAt: undefined,
      updatedAt: Date.now(),
    })
    this.syncRuntimeForTask(next, {
      status: next.statusSummary,
      trashStatus: 'active',
      trashedAt: undefined,
    })
    this.syncWorktreeForTask(next, { status: 'ready', trashedAt: undefined })
    return next
  }

  async deleteTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const current = this.listTasks(normalized).find(task => task.id === taskId)
    if (current) {
      await this.stopTask(normalized, taskId).catch(() => undefined)
      await this.worktrees.cleanup(current, { preservePatch: false }).catch(() => undefined)
      const runtime = this.getTaskRuntimeInternal(normalized, taskId)
      if (runtime?.terminalId) {
        try {
          this.terminalService.closePty(normalized, runtime.terminalId)
        } catch {
          // Best effort cleanup.
        }
      }
    }
    this.database
      .prepare(`DELETE FROM kanban_review_comments WHERE workspace_dir = ? AND task_id = ?`)
      .run(normalized, taskId)
    this.database
      .prepare(`DELETE FROM kanban_task_checkpoints WHERE workspace_dir = ? AND task_id = ?`)
      .run(normalized, taskId)
    this.database
      .prepare(`DELETE FROM kanban_task_runtime WHERE workspace_dir = ? AND task_id = ?`)
      .run(normalized, taskId)
    this.database
      .prepare(
        `DELETE FROM kanban_task_dependencies WHERE workspace_dir = ? AND (from_task_id = ? OR to_task_id = ?)`
      )
      .run(normalized, taskId, taskId)
    this.database
      .prepare(`DELETE FROM kanban_runs WHERE workspace_dir = ? AND task_id = ?`)
      .run(normalized, taskId)
    this.database
      .prepare(`DELETE FROM kanban_tasks WHERE workspace_dir = ? AND id = ?`)
      .run(normalized, taskId)
    return true
  }

  async linkTasks(workspaceDir: string, fromTaskId: string, toTaskId: string) {
    const normalized = path.resolve(workspaceDir)
    this.database
      .prepare(
        `
      INSERT OR IGNORE INTO kanban_task_dependencies (id, workspace_dir, from_task_id, to_task_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(randomUUID(), normalized, fromTaskId, toTaskId, Date.now())
    return this.getBoard(normalized)
  }

  async unlinkTasks(workspaceDir: string, fromTaskId: string, toTaskId: string) {
    const normalized = path.resolve(workspaceDir)
    this.database
      .prepare(
        `
      DELETE FROM kanban_task_dependencies WHERE workspace_dir = ? AND from_task_id = ? AND to_task_id = ?
    `
      )
      .run(normalized, fromTaskId, toTaskId)
    return this.getBoard(normalized)
  }

  private createRun(task: KanbanTask, automationId?: string) {
    const run: KanbanRun = {
      id: randomUUID(),
      workspaceDir: task.workspaceDir,
      taskId: task.id,
      automationId,
      provider: task.provider,
      status: 'running',
      sessionKey: task.providerSessionKey,
      providerThreadId: task.providerThreadId,
      shipStatus: task.shipStatus ?? 'unshipped',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      logs: [
        {
          id: randomUUID(),
          kind: 'system',
          message: `Starting ${task.provider} task`,
          timestamp: Date.now(),
        },
      ],
    }
    this.upsertRun(run)
    return run
  }

  private syncLatestRunForTaskStatus(
    task: KanbanTask,
    previousStatusSummary?: KanbanTaskStatusSummary
  ) {
    if (!task.latestRunId) {
      return
    }
    const wasActive = previousStatusSummary === 'starting' || previousStatusSummary === 'running'
    const nextRunStatus =
      task.statusSummary === 'completed'
        ? 'completed'
        : task.statusSummary === 'failed'
          ? 'failed'
          : task.statusSummary === 'stopped'
            ? 'stopped'
            : null
    if (!wasActive || !nextRunStatus) {
      return
    }
    const run = this.listRunsInternal(task.workspaceDir).find(
      candidate => candidate.id === task.latestRunId
    )
    if (!run || run.status === nextRunStatus) {
      return
    }
    const now = Date.now()
    const message =
      nextRunStatus === 'completed'
        ? 'Task completed'
        : nextRunStatus === 'failed'
          ? 'Task failed'
          : 'Task stopped'
    this.upsertRun({
      ...run,
      status: nextRunStatus,
      updatedAt: now,
      completedAt: run.completedAt ?? now,
      error: nextRunStatus === 'failed' ? (task.latestPreview ?? run.error) : run.error,
      logs: [
        ...run.logs,
        {
          id: randomUUID(),
          kind: 'system',
          level: nextRunStatus === 'failed' ? 'error' : 'info',
          message,
          timestamp: now,
        },
      ],
    })
  }

  private updateTaskRunBindings(task: KanbanTask, run: KanbanRun) {
    const next = {
      ...task,
      latestRunId: run.id,
      providerSessionKey: run.sessionKey ?? task.providerSessionKey,
      providerThreadId: run.providerThreadId ?? task.providerThreadId,
      updatedAt: Date.now(),
    }
    this.upsertTask(next)
    return next
  }

  async startTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    let task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    const dependencies = this.listDependencies(normalized)
    task = this.withBlocked([task], dependencies)[0]!
    if (task.blocked) {
      throw new Error('Task is blocked by unresolved dependencies')
    }
    const { settings } = this.resolveWorktreeIncludeSettings(normalized)
    const worktree = await this.worktrees.ensure(task, settings.worktreeInclude.entries)
    task = this.upsertTask({
      ...task,
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      statusSummary: 'starting',
      columnId: task.columnId === 'backlog' ? 'in_progress' : task.columnId,
      trashStatus: 'active',
      updatedAt: Date.now(),
    })
    const terminal = await this.ensureTaskTerminal(task)
    this.syncRuntimeForTask(task, {
      status: 'starting',
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      terminalId: terminal.id,
      trashStatus: 'active',
    })
    let run = this.createRun(task)
    const providerResult = await this.startProviderSession(task, worktree.worktreePath)
    run = this.upsertRun({
      ...run,
      sessionKey: providerResult.sessionKey,
      providerThreadId: providerResult.providerThreadId,
      updatedAt: Date.now(),
    })
    task = this.updateTaskRunBindings(
      {
        ...task,
        providerSessionKey: providerResult.sessionKey,
        providerThreadId: providerResult.providerThreadId,
        statusSummary: 'running',
      },
      run
    )
    const runtime = this.syncRuntimeForTask(task, {
      status: 'running',
      terminalId: terminal.id,
      worktreePath: worktree.worktreePath,
      taskBranch: worktree.branch,
      baseRef: worktree.baseRef,
      resumeToken: this.buildResumeToken(task),
      trashStatus: 'active',
    })
    this.syncWorktreeForTask(task, {
      repoRoot: worktree.repoRoot,
      directory: worktree.worktreePath,
      branch: worktree.branch,
      baseRef: worktree.baseRef,
      status: 'active',
    })
    await this.createCheckpoint(task, 'start', 'Task started')
    this.emitEvent({ type: 'kanban.task', payload: { workspaceDir: normalized, task } })
    this.emitEvent({ type: 'kanban.run', payload: { workspaceDir: normalized, run } })
    this.emitEvent({ type: 'kanban.runtime', payload: { workspaceDir: normalized, runtime } })
    return task
  }

  async resumeTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    if (!task.providerThreadId && !task.providerSessionKey) {
      return this.startTask(normalized, taskId)
    }
    return this.sendReviewFeedback(normalized, taskId, 'Continue working on this task.')
  }

  async stopTask(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    if (task.provider === 'opencode' && task.worktreePath && task.providerThreadId) {
      await this.opencodeService
        .abortSession(task.worktreePath, task.providerThreadId)
        .catch(() => undefined)
    } else if (task.provider === 'codex' && task.providerThreadId) {
      await this.codexService.interruptThreadTree(task.providerThreadId).catch(() => undefined)
    } else if (task.provider === 'claude' && task.providerSessionKey) {
      await this.claudeChatService.interruptTurn(task.providerSessionKey).catch(() => undefined)
    }
    const next = this.upsertTask({ ...task, statusSummary: 'stopped', updatedAt: Date.now() })
    const runtime = this.syncRuntimeForTask(next, { status: 'stopped' })
    this.syncWorktreeForTask(next, { status: 'stopped' })
    const run = next.latestRunId
      ? this.listRunsInternal(normalized).find(candidate => candidate.id === next.latestRunId)
      : null
    if (run && run.status === 'running') {
      this.upsertRun({
        ...run,
        status: 'stopped',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        logs: [
          ...run.logs,
          {
            id: randomUUID(),
            kind: 'system',
            message: 'Task stopped',
            timestamp: Date.now(),
          },
        ],
      })
    }
    this.emitEvent({ type: 'kanban.runtime', payload: { workspaceDir: normalized, runtime } })
    return next
  }

  async addReviewComment(
    workspaceDir: string,
    taskId: string,
    filePath: string,
    line: number,
    body: string
  ) {
    const normalized = path.resolve(workspaceDir)
    const comment: KanbanReviewComment = {
      id: randomUUID(),
      workspaceDir: normalized,
      taskId,
      filePath,
      line,
      body: body.trim(),
      createdAt: Date.now(),
    }
    this.database
      .prepare(
        `
      INSERT INTO kanban_review_comments (id, workspace_dir, task_id, run_id, file_path, line, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        comment.id,
        comment.workspaceDir,
        comment.taskId,
        null,
        comment.filePath,
        comment.line,
        comment.body,
        comment.createdAt
      )
    return comment
  }

  async sendReviewFeedback(workspaceDir: string, taskId: string, body: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    const message = body.trim()
    if (!message) {
      return task
    }
    if (task.provider === 'opencode' && task.worktreePath && task.providerThreadId) {
      await this.opencodeService.sendPrompt({
        directory: task.worktreePath,
        sessionID: task.providerThreadId,
        text: message,
        promptSource: 'user',
      })
    } else if (task.provider === 'codex' && task.providerThreadId) {
      await this.codexService.startTurn({
        threadId: task.providerThreadId,
        prompt: message,
        cwd: task.worktreePath ?? task.workspaceDir,
      })
    } else if (task.provider === 'claude' && task.providerSessionKey) {
      await this.claudeChatService.startTurn(
        task.providerSessionKey,
        task.worktreePath ?? task.workspaceDir,
        message
      )
    } else {
      return this.startTask(normalized, task.id)
    }
    const next = this.upsertTask({
      ...task,
      statusSummary: 'running',
      columnId: 'review',
      latestPreview: message,
      latestActivityKind: 'review',
      updatedAt: Date.now(),
    })
    const runtime = this.syncRuntimeForTask(next, {
      status: 'running',
      lastEventSummary: message,
      latestPreview: message,
      latestActivityKind: 'review',
    })
    this.syncWorktreeForTask(next, {
      status: 'active',
      latestPreview: message,
      latestActivityKind: 'review',
    })
    const run = next.latestRunId
      ? this.listRunsInternal(normalized).find(candidate => candidate.id === next.latestRunId)
      : null
    if (run) {
      this.upsertRun({
        ...run,
        status: 'running',
        updatedAt: Date.now(),
        logs: [
          ...run.logs,
          {
            id: randomUUID(),
            kind: 'review_feedback',
            message,
            timestamp: Date.now(),
          },
        ],
      })
    }
    await this.createCheckpoint(next, 'review', 'Review feedback')
    this.emitEvent({ type: 'kanban.runtime', payload: { workspaceDir: normalized, runtime } })
    return next
  }

  async commitTask(workspaceDir: string, taskId: string, message?: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task?.worktreePath) {
      throw new Error('Task worktree not found')
    }
    const result = await this.opencodeService.gitCommit(task.worktreePath, {
      includeUnstaged: true,
      message,
      nextStep: 'commit',
    } satisfies GitCommitRequest)
    const run =
      this.listRunsInternal(normalized).find(candidate => candidate.id === task.latestRunId) ??
      this.createRun(task)
    const nextRun = this.upsertRun({
      ...run,
      status: 'completed',
      shipStatus: 'committed',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [
        ...run.logs,
        {
          id: randomUUID(),
          kind: 'ship',
          message: `Committed ${result.commitHash.slice(0, 7)}`,
          timestamp: Date.now(),
        },
      ],
    })
    const nextTask = this.upsertTask({
      ...task,
      shipStatus: 'committed',
      columnId: 'done',
      statusSummary: 'completed',
      latestActivityKind: 'ship',
      latestPreview: 'Committed changes',
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
    this.syncRuntimeForTask(nextTask, {
      status: 'completed',
      lastEventSummary: 'Committed changes',
      latestActivityKind: 'ship',
      latestPreview: 'Committed changes',
    })
    this.syncWorktreeForTask(nextTask, {
      status: 'ready',
      latestActivityKind: 'ship',
      latestPreview: 'Committed changes',
    })
    await this.createCheckpoint(nextTask, 'ship', 'Commit')
    return nextRun
  }

  async openTaskPr(workspaceDir: string, taskId: string, baseBranch?: string, message?: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task?.worktreePath) {
      throw new Error('Task worktree not found')
    }
    const result = await this.opencodeService.gitCommit(task.worktreePath, {
      includeUnstaged: true,
      message,
      baseBranch,
      nextStep: 'commit_and_create_pr',
    } satisfies GitCommitRequest)
    const run =
      this.listRunsInternal(normalized).find(candidate => candidate.id === task.latestRunId) ??
      this.createRun(task)
    const nextRun = this.upsertRun({
      ...run,
      status: 'completed',
      shipStatus: 'pr_opened',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [
        ...run.logs,
        {
          id: randomUUID(),
          kind: 'ship',
          message: result.prUrl ? `Opened PR ${result.prUrl}` : 'Opened PR',
          timestamp: Date.now(),
        },
      ],
    })
    const nextTask = this.upsertTask({
      ...task,
      shipStatus: 'pr_opened',
      columnId: 'done',
      statusSummary: 'completed',
      latestActivityKind: 'ship',
      latestPreview: 'Opened pull request',
      updatedAt: Date.now(),
      completedAt: Date.now(),
    })
    this.syncRuntimeForTask(nextTask, {
      status: 'completed',
      lastEventSummary: 'Opened pull request',
      latestActivityKind: 'ship',
      latestPreview: 'Opened pull request',
    })
    this.syncWorktreeForTask(nextTask, {
      status: 'ready',
      latestActivityKind: 'ship',
      latestPreview: 'Opened pull request',
    })
    await this.createCheckpoint(nextTask, 'ship', 'Open PR')
    return nextRun
  }

  async listRuns(workspaceDir: string) {
    return this.listRunsInternal(path.resolve(workspaceDir))
  }

  async getRun(workspaceDir: string, runId: string) {
    return this.listRunsInternal(path.resolve(workspaceDir)).find(run => run.id === runId) ?? null
  }

  async getTaskDetail(workspaceDir: string, taskId: string): Promise<KanbanTaskDetail> {
    const normalized = path.resolve(workspaceDir)
    let task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    task = await this.refreshTask(task)
    const runtime = this.getTaskRuntimeInternal(normalized, taskId)
    const worktree =
      this.listWorktreesInternal(normalized).find(entry => entry.taskId === taskId) ?? null
    const run = task.latestRunId
      ? (this.listRunsInternal(normalized).find(candidate => candidate.id === task.latestRunId) ??
        null)
      : null
    const dependencies = this.listDependencies(normalized).filter(
      dep => dep.fromTaskId === taskId || dep.toTaskId === taskId
    )
    const reviewComments = this.listReviewComments(normalized, taskId)
    const checkpoints = this.listCheckpointsInternal(normalized, taskId)
    let diff = 'No local changes.'
    let structuredDiff: KanbanDiffFile[] = []
    let transcript: KanbanTaskDetail['transcript'] = []
    if (task.worktreePath) {
      diff = await this.opencodeService
        .gitDiff(task.worktreePath)
        .catch(error => sanitizeError(error))
      structuredDiff = parseUnifiedDiff(diff)
    }
    if (task.provider === 'opencode' && task.worktreePath && task.providerThreadId) {
      const messages = await this.opencodeService
        .loadMessages(task.worktreePath, task.providerThreadId)
        .catch(() => [])
      transcript = summarizeSessionBundles(messages)
    } else if (task.provider === 'claude' && task.providerThreadId) {
      const messages = await this.claudeChatService
        .getSessionMessages(task.providerThreadId, task.worktreePath ?? task.workspaceDir)
        .catch(() => [])
      transcript = messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      }))
    } else {
      transcript = (run?.logs ?? []).map(log => ({
        id: log.id,
        role: 'system' as const,
        content: log.message,
        timestamp: log.timestamp,
      }))
    }
    const detail = {
      task,
      runtime,
      worktree,
      run,
      dependencies,
      reviewComments,
      checkpoints,
      diff,
      structuredDiff,
      transcript,
    }
    this.emitEvent({ type: 'kanban.taskDetail', payload: { workspaceDir: normalized, detail } })
    return detail
  }

  async getTaskRuntime(workspaceDir: string, taskId: string) {
    return this.getTaskRuntimeInternal(path.resolve(workspaceDir), taskId)
  }

  async listWorktrees(workspaceDir: string) {
    return this.listWorktreesInternal(path.resolve(workspaceDir))
  }

  async createWorktree(input: KanbanCreateWorktreeInput) {
    const normalized = path.resolve(input.workspaceDir)
    const created = await this.worktrees.createStandalone(normalized, input.label, input.baseRef)
    const worktree = this.upsertWorktree({
      id: randomUUID(),
      workspaceDir: normalized,
      label: input.label.trim() || path.basename(created.worktreePath),
      provider: input.provider,
      repoRoot: created.repoRoot,
      directory: created.worktreePath,
      branch: created.branch,
      baseRef: created.baseRef,
      status: 'ready',
      mergeStatus: 'clean',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    this.emitEvent({ type: 'kanban.worktree', payload: { workspaceDir: normalized, worktree } })
    return worktree
  }

  async openWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir)
    const worktree = this.listWorktreesInternal(normalized).find(entry => entry.id === worktreeId)
    if (!worktree) {
      throw new Error('Worktree not found')
    }
    await this.opencodeService.openDirectoryIn(worktree.directory, 'finder')
    return true
  }

  async deleteWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir)
    const worktree = this.listWorktreesInternal(normalized).find(entry => entry.id === worktreeId)
    if (!worktree) {
      throw new Error('Worktree not found')
    }
    if (existsSync(worktree.directory)) {
      await this.commands
        .runCommand(
          'git',
          ['-C', worktree.repoRoot, 'worktree', 'remove', '--force', worktree.directory],
          worktree.repoRoot
        )
        .catch(() => undefined)
    }
    this.database
      .prepare(`DELETE FROM kanban_worktrees WHERE workspace_dir = ? AND id = ?`)
      .run(normalized, worktreeId)
    return true
  }

  async getWorktreeStatus(
    workspaceDir: string,
    worktreeId: string
  ): Promise<KanbanWorktreeStatusDetail> {
    const normalized = path.resolve(workspaceDir)
    const worktree = this.listWorktreesInternal(normalized).find(entry => entry.id === worktreeId)
    if (!worktree) {
      throw new Error('Worktree not found')
    }
    const gitState = await this.getGitState(worktree.directory)
    const conflictsRaw = await this.commands
      .runCommandWithOutput(
        'git',
        ['-C', worktree.directory, 'diff', '--name-only', '--diff-filter=U'],
        worktree.directory
      )
      .catch(() => '')
    const conflicts = conflictsRaw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    const hasChanges = Boolean(gitState.statusText.trim())
    const detail = {
      worktree: this.upsertWorktree({
        ...worktree,
        status: conflicts.length > 0 ? 'conflicted' : hasChanges ? 'active' : worktree.status,
        mergeStatus: conflicts.length > 0 ? 'conflicted' : worktree.mergeStatus,
        updatedAt: Date.now(),
      }),
      gitState,
      conflicts,
      hasChanges,
    } satisfies KanbanWorktreeStatusDetail
    this.emitEvent({
      type: 'kanban.worktree',
      payload: { workspaceDir: normalized, worktree: detail.worktree, detail },
    })
    return detail
  }

  async mergeWorktree(workspaceDir: string, worktreeId: string) {
    const normalized = path.resolve(workspaceDir)
    const worktree = this.listWorktreesInternal(normalized).find(entry => entry.id === worktreeId)
    if (!worktree) {
      throw new Error('Worktree not found')
    }
    await this.opencodeService.gitCheckoutBranch(worktree.repoRoot, worktree.baseRef)
    try {
      await this.commands.runCommand(
        'git',
        ['-C', worktree.repoRoot, 'merge', '--no-ff', worktree.branch],
        worktree.repoRoot
      )
    } catch {
      const conflictDetail = await this.getWorktreeStatus(normalized, worktreeId)
      const next = this.upsertWorktree({
        ...conflictDetail.worktree,
        status: 'conflicted',
        mergeStatus: 'conflicted',
        updatedAt: Date.now(),
      })
      const task = next.taskId
        ? this.listTasks(normalized).find(entry => entry.id === next.taskId)
        : null
      if (task) {
        this.upsertTask({
          ...task,
          mergeStatus: 'conflicted',
          latestActivityKind: 'merge',
          latestPreview: 'Merge conflicts need resolution',
          updatedAt: Date.now(),
        })
        this.syncRuntimeForTask(task, {
          mergeStatus: 'conflicted',
          latestActivityKind: 'merge',
          latestPreview: 'Merge conflicts need resolution',
        })
      }
      return { ...conflictDetail, worktree: next }
    }
    const next = this.upsertWorktree({
      ...worktree,
      status: 'merged',
      mergeStatus: 'merged',
      updatedAt: Date.now(),
    })
    const task = next.taskId
      ? this.listTasks(normalized).find(entry => entry.id === next.taskId)
      : null
    if (task) {
      const nextTask = this.upsertTask({
        ...task,
        shipStatus: 'merged',
        mergeStatus: 'merged',
        latestActivityKind: 'merge',
        latestPreview: `Merged ${next.branch} into ${next.baseRef}`,
        updatedAt: Date.now(),
        completedAt: task.completedAt ?? Date.now(),
      })
      this.syncRuntimeForTask(nextTask, {
        status: 'completed',
        mergeStatus: 'merged',
        latestActivityKind: 'merge',
        latestPreview: `Merged ${next.branch} into ${next.baseRef}`,
      })
    }
    return this.getWorktreeStatus(normalized, worktreeId)
  }

  async resolveMergeWithAgent(
    workspaceDir: string,
    worktreeId: string,
    provider: KanbanProvider = 'opencode'
  ) {
    const normalized = path.resolve(workspaceDir)
    const worktree = this.listWorktreesInternal(normalized).find(entry => entry.id === worktreeId)
    if (!worktree) {
      throw new Error('Worktree not found')
    }
    const detail = await this.getWorktreeStatus(normalized, worktreeId)
    const task = worktree.taskId
      ? (this.listTasks(normalized).find(entry => entry.id === worktree.taskId) ?? null)
      : await this.createTask({
          workspaceDir: normalized,
          title: `Resolve merge for ${worktree.label}`,
          prompt: `Resolve merge conflicts in worktree ${worktree.directory} and prepare it to merge cleanly into ${worktree.baseRef}. Conflicted files: ${detail.conflicts.join(', ') || 'unknown'}`,
          description: 'Generated to resolve a worktree merge conflict',
          provider,
          columnId: 'review',
        })
    if (!task) {
      throw new Error('Unable to create merge-resolution task')
    }
    await this.sendReviewFeedback(
      normalized,
      task.id,
      `Resolve merge conflicts for worktree ${worktree.branch}. Conflicted files: ${detail.conflicts.join(', ') || 'unknown'}.`
    )
    return this.listTasks(normalized).find(entry => entry.id === task.id)!
  }

  async createWorktreeIncludeFromGitignore(workspaceDir: string) {
    const normalized = path.resolve(workspaceDir)
    const repoRoot = await this.resolveRepoRoot(normalized)
    const include = this.worktrees.createWorktreeIncludeFromGitignore(repoRoot)
    return this.upsertSettings({
      ...this.getSettingsInternal(normalized),
      workspaceDir: normalized,
      worktreeInclude: include,
      updatedAt: Date.now(),
    })
  }

  async runScriptShortcut(
    workspaceDir: string,
    taskId: string,
    shortcutId: string
  ): Promise<KanbanScriptShortcutResult> {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(entry => entry.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    const settings = this.getSettingsInternal(normalized)
    const shortcut = settings.scriptShortcuts.find(entry => entry.id === shortcutId)
    if (!shortcut) {
      throw new Error('Shortcut not found')
    }
    const cwd = task.worktreePath ?? task.workspaceDir
    try {
      const output = await this.commands.runCommandWithOutput('zsh', ['-lc', shortcut.command], cwd)
      const result = {
        shortcutId,
        command: shortcut.command,
        cwd,
        ok: true,
        exitCode: 0,
        output,
        createdAt: Date.now(),
      } satisfies KanbanScriptShortcutResult
      this.emitEvent({
        type: 'kanban.shortcut',
        payload: { workspaceDir: normalized, taskId, result },
      })
      return result
    } catch (error) {
      const result = {
        shortcutId,
        command: shortcut.command,
        cwd,
        ok: false,
        exitCode: 1,
        output: sanitizeError(error),
        createdAt: Date.now(),
      } satisfies KanbanScriptShortcutResult
      this.emitEvent({
        type: 'kanban.shortcut',
        payload: { workspaceDir: normalized, taskId, result },
      })
      return result
    }
  }

  async listCheckpoints(workspaceDir: string, taskId: string) {
    return this.listCheckpointsInternal(path.resolve(workspaceDir), taskId)
  }

  async createManualCheckpoint(workspaceDir: string, taskId: string, label?: string) {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    return this.createCheckpoint(task, 'manual', label?.trim() || 'Manual checkpoint')
  }

  async getCheckpointDiff(
    workspaceDir: string,
    taskId: string,
    fromCheckpointId: string,
    toCheckpointId?: string
  ): Promise<KanbanCheckpointDiff> {
    const normalized = path.resolve(workspaceDir)
    const checkpoints = this.listCheckpointsInternal(normalized, taskId)
    const fromCheckpoint = checkpoints.find(checkpoint => checkpoint.id === fromCheckpointId)
    if (!fromCheckpoint) {
      throw new Error('Checkpoint not found')
    }
    const toCheckpoint = toCheckpointId
      ? checkpoints.find(checkpoint => checkpoint.id === toCheckpointId)
      : undefined
    const raw = toCheckpoint?.diffRaw ?? fromCheckpoint.diffRaw
    return {
      workspaceDir: normalized,
      taskId,
      fromCheckpointId,
      toCheckpointId,
      raw,
      files: parseUnifiedDiff(raw),
    }
  }

  async getTaskTerminal(workspaceDir: string, taskId: string) {
    const runtime = this.getTaskRuntimeInternal(path.resolve(workspaceDir), taskId)
    if (!runtime?.terminalId) {
      return null
    }
    return (
      this.terminalService
        .listPtys(path.resolve(workspaceDir), 'kanban')
        .find(terminal => terminal.id === runtime.terminalId) ?? null
    )
  }

  async createTaskTerminal(workspaceDir: string, taskId: string): Promise<KanbanTaskTerminal> {
    const normalized = path.resolve(workspaceDir)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (!task) {
      throw new Error('Task not found')
    }
    return this.ensureTaskTerminal(task)
  }

  async connectTaskTerminal(workspaceDir: string, taskId: string) {
    const terminal = await this.getTaskTerminal(workspaceDir, taskId)
    if (!terminal) {
      throw new Error('Task terminal not found')
    }
    return this.terminalService.connectPty(path.resolve(workspaceDir), terminal.id)
  }

  async closeTaskTerminal(workspaceDir: string, taskId: string) {
    const normalized = path.resolve(workspaceDir)
    const runtime = this.getTaskRuntimeInternal(normalized, taskId)
    if (!runtime?.terminalId) {
      return true
    }
    this.terminalService.closePty(normalized, runtime.terminalId)
    const task = this.listTasks(normalized).find(candidate => candidate.id === taskId)
    if (task) {
      this.syncRuntimeForTask(task, { terminalId: undefined })
    }
    return true
  }

  async getGitState(workspaceDir: string): Promise<KanbanGitState> {
    const normalized = path.resolve(workspaceDir)
    const repoRoot = await this.resolveRepoRoot(normalized)
    const branchState = await this.opencodeService.gitBranches(repoRoot)
    const statusText = await this.opencodeService.gitStatus(repoRoot)
    const commitsRaw = await this.commands
      .runCommandWithOutput(
        'git',
        ['-C', repoRoot, 'log', '--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e', '-n', '40'],
        repoRoot
      )
      .catch(() => '')
    const commits = commitsRaw
      .split('\u001e')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => {
        const [hash, shortHash, author, relativeTime, ...subjectParts] = entry.split('\u001f')
        return {
          hash: hash ?? '',
          shortHash: shortHash ?? '',
          author: author ?? '',
          relativeTime: relativeTime ?? '',
          subject: subjectParts.join('\u001f') || shortHash || hash || '',
        } satisfies KanbanGitCommitEntry
      })
    const graphText = await this.commands
      .runCommandWithOutput(
        'git',
        ['-C', repoRoot, 'log', '--graph', '--oneline', '--decorate', '-n', '40'],
        repoRoot
      )
      .catch(() => '')
    return { workspaceDir: normalized, repoRoot, branchState, statusText, commits, graphText }
  }

  async gitFetch(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir))
    await this.commands.runCommand('git', ['-C', repoRoot, 'fetch', '--all', '--prune'], repoRoot)
    return this.getGitState(repoRoot)
  }

  async gitPull(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir))
    await this.commands.runCommand('git', ['-C', repoRoot, 'pull', '--ff-only'], repoRoot)
    return this.getGitState(repoRoot)
  }

  async gitPush(workspaceDir: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir))
    await this.commands.runCommand('git', ['-C', repoRoot, 'push'], repoRoot)
    return this.getGitState(repoRoot)
  }

  async gitCheckout(workspaceDir: string, branch: string) {
    const repoRoot = await this.resolveRepoRoot(path.resolve(workspaceDir))
    await this.opencodeService.gitCheckoutBranch(repoRoot, branch)
    return this.getGitState(repoRoot)
  }

  async startManagementSession(workspaceDir: string, provider?: KanbanProvider) {
    const normalized = path.resolve(workspaceDir)
    const resolvedProvider = provider ?? this.getSettingsInternal(normalized).defaultProvider
    const existing = this.getManagementSessionInternal(normalized, resolvedProvider)
    if (existing) {
      return existing
    }
    if (resolvedProvider === 'opencode') {
      const session = await this.opencodeService.createSession(normalized, 'Kanban board manager')
      return this.upsertManagementSession({
        workspaceDir: normalized,
        provider: resolvedProvider,
        sessionKey: session.id,
        status: 'idle',
        transcript: [],
        updatedAt: Date.now(),
      })
    }
    if (resolvedProvider === 'codex') {
      const thread = await this.codexService.startThread({
        cwd: normalized,
        title: 'Kanban board manager',
      })
      return this.upsertManagementSession({
        workspaceDir: normalized,
        provider: resolvedProvider,
        sessionKey: thread.id,
        providerThreadId: thread.id,
        status: 'idle',
        transcript: [],
        updatedAt: Date.now(),
      })
    }
    return this.upsertManagementSession({
      workspaceDir: normalized,
      provider: resolvedProvider,
      sessionKey: `kanban:management:${slugify(normalized)}`,
      status: 'idle',
      transcript: [],
      updatedAt: Date.now(),
    })
  }

  async getManagementSession(workspaceDir: string, provider: KanbanProvider) {
    return this.getManagementSessionInternal(path.resolve(workspaceDir), provider)
  }

  private async dispatchManagementOperation(
    workspaceDir: string,
    operation: KanbanManagementOperation
  ) {
    const dp = () => this.getSettingsInternal(workspaceDir).defaultProvider
    const op = operation as Record<string, unknown>
    const taskId = op.taskId as string
    const handlers: Record<string, () => Promise<unknown>> = {
      create_task: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'create_task' }>
        const created = await this.createTask({
          workspaceDir, title: o.title, prompt: o.prompt, description: o.description,
          provider: o.provider ?? dp(), columnId: o.columnId ?? 'backlog',
          autoStartWhenUnblocked: o.autoStartWhenUnblocked,
        })
        if (o.columnId === 'ready') {
          await this.moveTask({ workspaceDir, taskId: created.id, columnId: 'ready', position: 0 })
        }
      },
      update_task: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'update_task' }>
        await this.updateTask({
          workspaceDir, id: o.taskId, title: o.title, prompt: o.prompt,
          description: o.description, provider: o.provider,
          autoStartWhenUnblocked: o.autoStartWhenUnblocked,
        })
      },
      link_tasks: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'link_tasks' }>
        await this.linkTasks(workspaceDir, o.fromTaskId, o.toTaskId)
      },
      unlink_tasks: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'unlink_tasks' }>
        await this.unlinkTasks(workspaceDir, o.fromTaskId, o.toTaskId)
      },
      start_task: async () => this.startTask(workspaceDir, taskId),
      resume_task: async () => this.resumeTask(workspaceDir, taskId),
      stop_task: async () => this.stopTask(workspaceDir, taskId),
      trash_task: async () => this.trashTask(workspaceDir, taskId),
      restore_task: async () => this.restoreTask(workspaceDir, taskId),
      delete_task: async () => this.deleteTask(workspaceDir, taskId),
      create_worktree: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'create_worktree' }>
        await this.createWorktree({ workspaceDir, label: o.label, baseRef: o.baseRef })
      },
      merge_worktree: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'merge_worktree' }>
        await this.mergeWorktree(workspaceDir, o.worktreeId)
      },
      resolve_merge_with_agent: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'resolve_merge_with_agent' }>
        await this.resolveMergeWithAgent(workspaceDir, o.worktreeId, o.provider ?? dp())
      },
      delete_worktree: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'delete_worktree' }>
        await this.deleteWorktree(workspaceDir, o.worktreeId)
      },
      run_shortcut: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'run_shortcut' }>
        await this.runScriptShortcut(workspaceDir, o.taskId, o.shortcutId)
      },
      create_automation: async () => {
        const o = operation as Extract<KanbanManagementOperation, { type: 'create_automation' }>
        await this.createAutomationPublic({
          workspaceDir, name: o.name, prompt: o.prompt,
          provider: o.provider ?? dp(), schedule: o.schedule, autoStart: o.autoStart,
        })
      },
    }
    const handler = handlers[operation.type]
    if (!handler) {
      throw new Error(`Unsupported management operation type: ${operation.type ?? 'unknown'}`)
    }
    await handler()
  }

  private async applyManagementOperations(
    workspaceDir: string,
    operations: KanbanManagementOperation[]
  ) {
    const applied: KanbanManagementPromptResult['applied'] = []
    for (const [index, operation] of operations.entries()) {
      try {
        await this.dispatchManagementOperation(workspaceDir, operation)
        applied.push({ index, type: operation.type, ok: true })
      } catch (error) {
        applied.push({ index, type: operation.type, ok: false, error: sanitizeError(error) })
      }
    }
    return applied
  }

  async sendManagementPrompt(
    workspaceDir: string,
    provider: KanbanProvider,
    prompt: string
  ): Promise<KanbanManagementPromptResult> {
    const normalized = path.resolve(workspaceDir)
    const session = await this.startManagementSession(normalized, provider)
    const board = await this.getBoard(normalized)
    const managementPrompt = buildKanbanManagementPrompt({
      workspaceDir: normalized,
      provider,
      prompt,
      board,
      settings: board.settings,
    })
    let nextSession = this.upsertManagementSession({
      ...session,
      status: 'running',
      transcript: [
        ...session.transcript,
        { id: randomUUID(), role: 'user', content: prompt.trim(), timestamp: Date.now() },
      ],
      updatedAt: Date.now(),
      lastError: undefined,
    })

    let rawResponse = ''
    try {
      if (provider === 'opencode') {
        await this.opencodeService.sendPrompt({
          directory: normalized,
          sessionID: session.sessionKey,
          text: managementPrompt,
          promptSource: 'user',
        })
        const messages = await this.opencodeService
          .loadMessages(normalized, session.sessionKey)
          .catch(() => [])
        rawResponse =
          summarizeSessionBundles(messages)
            .filter(item => item.role === 'assistant')
            .at(-1)?.content ?? ''
      } else if (provider === 'claude') {
        await this.claudeChatService.startTurn(session.sessionKey, normalized, managementPrompt)
        const state = await this.claudeChatService.getState(session.sessionKey)
        const messages = state.providerThreadId
          ? await this.claudeChatService
              .getSessionMessages(state.providerThreadId, normalized)
              .catch(() => [])
          : []
        rawResponse = messages.filter(item => item.role === 'assistant').at(-1)?.content ?? ''
        nextSession = this.upsertManagementSession({
          ...nextSession,
          providerThreadId: state.providerThreadId,
          updatedAt: Date.now(),
        })
      } else {
        rawResponse = await this.codexService
          .captureAssistantReply(session.sessionKey, managementPrompt, normalized)
          .catch(() => '')
      }
    } catch (error) {
      nextSession = this.upsertManagementSession({
        ...nextSession,
        status: 'error',
        lastError: sanitizeError(error),
        updatedAt: Date.now(),
      })
      return { session: nextSession, rawResponse: '', operations: [], applied: [] }
    }

    let operations: KanbanManagementOperation[] = []
    if (rawResponse.trim()) {
      try {
        operations = parseKanbanManagementResponse(rawResponse).operations
      } catch {
        operations = []
      }
    }
    const applied = await this.applyManagementOperations(normalized, operations)
    nextSession = this.upsertManagementSession({
      ...nextSession,
      status: 'idle',
      transcript: rawResponse.trim()
        ? [
            ...nextSession.transcript,
            {
              id: randomUUID(),
              role: 'assistant',
              content: rawResponse.trim(),
              timestamp: Date.now(),
            },
          ]
        : nextSession.transcript,
      updatedAt: Date.now(),
    })
    this.emitEvent({
      type: 'kanban.management',
      payload: { workspaceDir: normalized, session: nextSession },
    })
    return { session: nextSession, rawResponse, operations, applied }
  }

  private isAutomationDue(automation: KanbanAutomation, now: number) {
    if (!automation.enabled) {
      return false
    }
    if (automation.schedule.type === 'interval') {
      const intervalMs = Math.max(5, automation.schedule.intervalMinutes) * 60_000
      return !automation.lastRunAt || now - automation.lastRunAt >= intervalMs
    }
    const day = new Date(now).getDay()
    if (!automation.schedule.days.includes(day)) {
      return false
    }
    const [hoursRaw, minutesRaw] = automation.schedule.time.split(':')
    const targetMinutes = (Number(hoursRaw) || 0) * 60 + (Number(minutesRaw) || 0)
    const date = new Date(now)
    const currentMinutes = date.getHours() * 60 + date.getMinutes()
    if (currentMinutes < targetMinutes) {
      return false
    }
    if (!automation.lastRunAt) {
      return true
    }
    const last = new Date(automation.lastRunAt)
    return (
      last.getFullYear() !== date.getFullYear() ||
      last.getMonth() !== date.getMonth() ||
      last.getDate() !== date.getDate() ||
      last.getHours() * 60 + last.getMinutes() < targetMinutes
    )
  }

  private async runAutomation(automation: KanbanAutomation) {
    const task = await this.createTask({
      workspaceDir: automation.workspaceDir,
      title: automation.name,
      prompt: automation.prompt,
      description: 'Generated from automation',
      provider: automation.provider,
      columnId: automation.autoStart ? 'ready' : 'backlog',
      autoStartWhenUnblocked: false,
    })
    const updatedAutomation = { ...automation, lastRunAt: Date.now(), updatedAt: Date.now() }
    this.createAutomation(updatedAutomation)
    if (automation.autoStart) {
      const startedTask = await this.startTask(automation.workspaceDir, task.id)
      return this.listRunsInternal(automation.workspaceDir).find(
        run => run.id === startedTask.latestRunId
      )!
    }
    const run: KanbanRun = {
      id: randomUUID(),
      workspaceDir: automation.workspaceDir,
      automationId: automation.id,
      taskId: task.id,
      provider: automation.provider,
      status: 'completed',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
      logs: [
        {
          id: randomUUID(),
          kind: 'system',
          message: `Created task ${task.title} from automation`,
          timestamp: Date.now(),
        },
      ],
    }
    return this.upsertRun(run)
  }

  async runAutomationNow(workspaceDir: string, automationId: string) {
    const automation = this.listAutomationsInternal(path.resolve(workspaceDir)).find(
      candidate => candidate.id === automationId
    )
    if (!automation) {
      throw new Error('Automation not found')
    }
    return this.runAutomation(automation)
  }

  private async runSchedulerTick() {
    if (this.schedulerRunning) {
      return
    }
    this.schedulerRunning = true
    try {
      for (const workspace of this.listWorkspacesInternal()) {
        await this.refreshWorkspace(workspace.directory).catch(() => undefined)
      }
    } finally {
      this.schedulerRunning = false
    }
  }

  private async evaluateDueAutomations(workspaceDir: string) {
    const now = Date.now()
    const due = this.listAutomationsInternal(workspaceDir).filter(automation =>
      this.isAutomationDue(automation, now)
    )
    for (const automation of due) {
      await this.runAutomation(automation).catch(() => undefined)
    }
  }

  private async tryAutoStartUnblocked(workspaceDir: string) {
    const tasks = this.withBlocked(
      this.listTasks(workspaceDir),
      this.listDependencies(workspaceDir)
    )
    for (const task of tasks) {
      if (!task.blocked && task.autoStartWhenUnblocked && task.statusSummary === 'idle') {
        await this.startTask(workspaceDir, task.id).catch(() => undefined)
      }
    }
  }

  handleEvent(event: OrxaEvent) {
    // Runtime reads remain authoritative; event handling only nudges freshness.
    if (
      event.type === 'kanban.board' ||
      event.type === 'kanban.task' ||
      event.type === 'kanban.run' ||
      event.type === 'kanban.runtime' ||
      event.type === 'kanban.checkpoint' ||
      event.type === 'kanban.management'
    ) {
      return
    }
    const payload = asRecord(event.payload)
    const directory = asString(payload?.directory ?? payload?.workspaceDir).trim()
    if (directory) {
      void this.refreshWorkspace(directory)
        .then(async () => {
          const snapshot = await this.getBoard(directory)
          this.emitEvent({ type: 'kanban.board', payload: { workspaceDir: directory, snapshot } })
        })
        .catch(() => undefined)
    }
  }
}
