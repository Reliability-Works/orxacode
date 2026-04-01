import type {
  KanbanTask,
  KanbanTaskActivityKind,
  KanbanTaskStatusSummary,
} from '../../shared/ipc'
import type { OpencodeService } from './opencode-service'
import type { CodexService } from './codex-service'
import type { ClaudeChatService } from './claude-chat-service'
import { asRecord, asString } from './kanban-parsers'

export type RefreshResult = {
  statusSummary: KanbanTaskStatusSummary
  lastEventSummary: string
  latestPreview: string
  latestActivityKind: KanbanTaskActivityKind | undefined
  providerThreadId?: string
}

export async function refreshOpencodeTaskStatus(
  task: KanbanTask,
  opencodeService: OpencodeService
): Promise<RefreshResult> {
  const runtime = await opencodeService.getSessionRuntime(
    task.worktreePath!,
    task.providerThreadId!
  )
  const sessionStatusType = asString(
    (runtime.sessionStatus as Record<string, unknown> | undefined)?.type
  ).toLowerCase()

  const lastEventSummary =
    runtime.commands
      .map(entry => asString((entry as Record<string, unknown>).command))
      .find(Boolean) ??
    runtime.questions
      .map(entry => asString((entry as Record<string, unknown>).message))
      .find(Boolean) ??
    runtime.permissions
      .map(entry => asString(asRecord((entry as Record<string, unknown>).call)?.command))
      .find(Boolean) ??
    ''

  const latestPreview =
    runtime.messages
      .at(-1)
      ?.parts.map(part => {
        const record = part as Record<string, unknown>
        return asString(record.text ?? record.content).trim()
      })
      .filter(Boolean)
      .join('\n\n') || lastEventSummary

  const latestActivityKind: KanbanTaskActivityKind =
    runtime.commands.length > 0
      ? 'tool'
      : runtime.questions.length > 0
        ? 'question'
        : runtime.permissions.length > 0
          ? 'permission'
          : 'assistant'

  const statusSummary: KanbanTaskStatusSummary =
    runtime.questions.length > 0 || runtime.permissions.length > 0
      ? 'awaiting_input'
      : sessionStatusType.includes('complete')
        ? 'completed'
        : sessionStatusType.includes('error')
          ? 'failed'
          : sessionStatusType.includes('idle')
            ? 'idle'
            : 'running'

  return { statusSummary, lastEventSummary, latestPreview, latestActivityKind }
}

export async function refreshCodexTaskStatus(
  task: KanbanTask,
  codexService: CodexService
): Promise<RefreshResult> {
  const runtime = await codexService.getThreadRuntime(task.providerThreadId!)
  const statusType = asString(asRecord(asRecord(runtime.thread)?.status)?.type).toLowerCase()
  const lastEventSummary = asString(asRecord(runtime.thread)?.preview)

  const statusSummary: KanbanTaskStatusSummary = statusType.includes('await')
    ? 'awaiting_input'
    : statusType.includes('error')
      ? 'failed'
      : statusType.includes('done') || statusType.includes('completed')
        ? 'completed'
        : runtime.thread
          ? 'running'
          : 'stopped'

  return {
    statusSummary,
    lastEventSummary,
    latestPreview: lastEventSummary,
    latestActivityKind: 'assistant',
  }
}

export async function refreshClaudeTaskStatus(
  task: KanbanTask,
  claudeChatService: ClaudeChatService
): Promise<RefreshResult> {
  const state = claudeChatService.getState(task.providerSessionKey!)

  const statusSummary: KanbanTaskStatusSummary =
    state.status === 'error'
      ? 'failed'
      : state.status === 'disconnected'
        ? 'stopped'
        : state.activeTurnId
          ? 'running'
          : 'idle'

  return {
    statusSummary,
    lastEventSummary: state.lastError ?? '',
    latestPreview: state.lastError ?? task.latestPreview ?? '',
    latestActivityKind: state.activeTurnId ? 'assistant' : task.latestActivityKind,
    providerThreadId: state.providerThreadId,
  }
}

export type StartProviderSessionResult = {
  sessionKey: string
  providerThreadId?: string
}

export async function startOpencodeProviderSession(
  task: KanbanTask,
  worktreePath: string,
  opencodeService: OpencodeService
): Promise<StartProviderSessionResult> {
  const session = await opencodeService.createSession(worktreePath, task.title)
  await opencodeService.sendPrompt({
    directory: worktreePath,
    sessionID: session.id,
    text: task.prompt,
    promptSource: 'job',
    agent: task.providerConfig?.opencode?.agent,
    model: task.providerConfig?.opencode?.model,
    variant: task.providerConfig?.opencode?.variant,
  })
  return { sessionKey: session.id, providerThreadId: session.id }
}

export async function startCodexProviderSession(
  task: KanbanTask,
  worktreePath: string,
  codexService: CodexService
): Promise<StartProviderSessionResult> {
  const thread = await codexService.startThread({ cwd: worktreePath, title: task.title })
  await codexService.startTurn({
    threadId: thread.id,
    prompt: task.prompt,
    cwd: worktreePath,
    model: task.providerConfig?.codex?.model,
    effort: task.providerConfig?.codex?.reasoningEffort ?? undefined,
  })
  return { sessionKey: thread.id, providerThreadId: thread.id }
}

export async function startClaudeProviderSession(
  task: KanbanTask,
  worktreePath: string,
  claudeChatService: ClaudeChatService
): Promise<StartProviderSessionResult> {
  const sessionKey = task.providerSessionKey || `kanban:claude:${task.id}`
  await claudeChatService.startTurn(sessionKey, worktreePath, task.prompt, {
    model: task.providerConfig?.claude?.model,
    effort: task.providerConfig?.claude?.effort,
  })
  const state = claudeChatService.getState(sessionKey)
  return { sessionKey, providerThreadId: state.providerThreadId }
}
