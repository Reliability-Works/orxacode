import type {
  KanbanAutomation,
  KanbanBoardSnapshot,
  KanbanManagementOperation,
  KanbanProvider,
  KanbanSettings,
  KanbanTask,
  KanbanWorktree,
} from '../../shared/ipc'

function sanitizeForPrompt(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function boardTaskSummary(task: KanbanTask) {
  return {
    id: task.id,
    title: task.title,
    provider: task.provider,
    columnId: task.columnId,
    blocked: task.blocked,
    status: task.statusSummary,
    autoStartWhenUnblocked: task.autoStartWhenUnblocked,
  }
}

function automationSummary(automation: KanbanAutomation) {
  return {
    id: automation.id,
    name: automation.name,
    provider: automation.provider,
    schedule: automation.schedule,
    enabled: automation.enabled,
  }
}

function worktreeSummary(worktree: KanbanWorktree) {
  return {
    id: worktree.id,
    label: worktree.label,
    branch: worktree.branch,
    baseRef: worktree.baseRef,
    status: worktree.status,
    mergeStatus: worktree.mergeStatus,
    taskId: worktree.taskId,
  }
}

export function buildKanbanManagementPrompt(input: {
  workspaceDir: string
  provider: KanbanProvider
  prompt: string
  board: KanbanBoardSnapshot
  settings: KanbanSettings
}) {
  const payload = {
    workspaceDir: input.workspaceDir,
    provider: input.provider,
    settings: {
      autoCommit: input.settings.autoCommit,
      autoPr: input.settings.autoPr,
      defaultProvider: input.settings.defaultProvider,
      scriptShortcuts: input.settings.scriptShortcuts,
      worktreeInclude: input.settings.worktreeInclude,
    },
    tasks: input.board.tasks.map(boardTaskSummary),
    trashedTasks: input.board.trashedTasks.map(boardTaskSummary),
    dependencies: input.board.dependencies,
    automations: input.board.automations.map(automationSummary),
    worktrees: input.board.worktrees.map(worktreeSummary),
  }

  return [
    'You are an orchestration agent managing an Orxa Kanban board.',
    'Return JSON only with this shape:',
    '{"reply":"short human summary","operations":[...]}',
    'Allowed operations:',
    '- {"type":"create_task","title":"...","prompt":"...","description":"...","provider":"opencode|codex|claude","columnId":"backlog|ready|in_progress|review|done","autoStartWhenUnblocked":true|false}',
    '- {"type":"update_task","taskId":"...","title":"...","prompt":"...","description":"...","provider":"opencode|codex|claude","autoStartWhenUnblocked":true|false}',
    '- {"type":"link_tasks","fromTaskId":"...","toTaskId":"..."}',
    '- {"type":"unlink_tasks","fromTaskId":"...","toTaskId":"..."}',
    '- {"type":"start_task","taskId":"..."}',
    '- {"type":"resume_task","taskId":"..."}',
    '- {"type":"stop_task","taskId":"..."}',
    '- {"type":"trash_task","taskId":"..."}',
    '- {"type":"restore_task","taskId":"..."}',
    '- {"type":"delete_task","taskId":"..."}',
    '- {"type":"create_worktree","label":"...","baseRef":"optional"}',
    '- {"type":"merge_worktree","worktreeId":"..."}',
    '- {"type":"resolve_merge_with_agent","worktreeId":"...","provider":"opencode|codex|claude"}',
    '- {"type":"delete_worktree","worktreeId":"..."}',
    '- {"type":"run_shortcut","taskId":"...","shortcutId":"..."}',
    '- {"type":"create_automation","name":"...","prompt":"...","provider":"opencode|codex|claude","schedule":{"type":"daily","time":"09:00","days":[1,2,3,4,5]},"autoStart":true|false}',
    'Do not include any prose outside the JSON.',
    '',
    'Current board:',
    JSON.stringify(payload, null, 2),
    '',
    `User request: ${sanitizeForPrompt(input.prompt)}`,
  ].join('\n')
}

export function parseKanbanManagementResponse(raw: string): {
  reply: string
  operations: KanbanManagementOperation[]
} {
  const trimmed = raw.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1]?.trim() || trimmed
  const parsed = JSON.parse(candidate) as { reply?: unknown; operations?: unknown }
  const operations = Array.isArray(parsed.operations) ? parsed.operations : []
  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    operations: operations.filter(
      (entry): entry is KanbanManagementOperation => Boolean(entry) && typeof entry === 'object'
    ),
  }
}
