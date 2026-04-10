import { Effect } from 'effect'
import type { ModelSelection, ProviderRuntimeEvent, ThreadId } from '@orxa-code/contracts'
import { MessageId } from '@orxa-code/contracts'
import { DEFAULT_MODEL_BY_PROVIDER } from '@orxa-code/contracts'
import { resolveModelSlugForProvider } from '@orxa-code/shared/model'

import { type ClaudeChildThreadDescriptor } from '../../claudeChildThreads.ts'
import { findDiscoveredClaudeAgentById } from '../../provider/claudeAgents.ts'
import { providerCommandId } from './ProviderRuntimeIngestion.helpers.ts'
import type {
  ProcessRuntimeEventDeps,
  ReadModelThread,
} from './ProviderRuntimeIngestion.processEvent.handlers.ts'

function buildBaseSubagentThreadTitle(agentLabel: string | null): string {
  const trimmed = agentLabel?.trim()
  if (!trimmed) {
    return 'Claude Subagent'
  }
  return trimmed
    .split(/[\s_-]+/)
    .filter(part => part.length > 0)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function buildClaudeSeedMessageText(descriptor: ClaudeChildThreadDescriptor): string {
  const prompt = descriptor.prompt?.trim() ?? descriptor.description?.trim() ?? ''
  if (prompt.length > 0) {
    return prompt
  }
  return 'Delegated task from parent thread. Exact provider prompt was not exposed.'
}

function claudeSeedMessageId(childThreadId: ThreadId): MessageId {
  return MessageId.makeUnsafe(`seed:${childThreadId}:delegated-prompt`)
}

function resolveClaudeSubagentModelSelection(input: {
  readonly descriptor: ClaudeChildThreadDescriptor
  readonly parentThread: ReadModelThread
  readonly discoveredModel: string | null
}): ModelSelection {
  const envOverride = process.env.CLAUDE_CODE_SUBAGENT_MODEL?.trim() || null
  const rawModel = envOverride ?? input.descriptor.model ?? input.discoveredModel
  if (!rawModel || rawModel.toLowerCase() === 'inherit') {
    return input.parentThread.modelSelection.provider === 'claudeAgent'
      ? input.parentThread.modelSelection
      : {
          provider: 'claudeAgent',
          model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
        }
  }
  return {
    provider: 'claudeAgent',
    model: resolveModelSlugForProvider('claudeAgent', rawModel),
  }
}

const enrichClaudeDescriptor = Effect.fn('enrichClaudeDescriptor')(function* (
  descriptor: ClaudeChildThreadDescriptor,
  projectRoot: string | null
): Effect.fn.Return<ClaudeChildThreadDescriptor> {
  const rawAgentId = descriptor.agentLabel?.trim() || null
  if (!rawAgentId) {
    return descriptor
  }
  const discoveredAgent = yield* Effect.promise(() =>
    findDiscoveredClaudeAgentById(rawAgentId, projectRoot ? { projectRoot } : undefined)
  ).pipe(Effect.orElseSucceed(() => null))
  return {
    ...descriptor,
    agentLabel: discoveredAgent?.name ?? buildBaseSubagentThreadTitle(rawAgentId),
    model: descriptor.model ?? discoveredAgent?.model ?? null,
  }
})

function nextClaudeSubagentSessionStatus(
  event: ProviderRuntimeEvent
): 'running' | 'ready' | 'interrupted' | 'error' | null {
  if (event.type === 'task.completed') {
    if (event.payload.status === 'failed') {
      return 'error'
    }
    if (event.payload.status === 'stopped') {
      return 'interrupted'
    }
    return 'ready'
  }

  switch (event.type) {
    case 'content.delta':
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
    case 'task.started':
    case 'task.progress':
    case 'tool.progress':
    case 'tool.summary':
      return 'running'
    default:
      return null
  }
}

function isClaudeSubagentThread(thread: ReadModelThread): boolean {
  return (
    thread.parentLink?.relationKind === 'subagent' && thread.parentLink.provider === 'claudeAgent'
  )
}

function claudeSubagentLastError(
  nextStatus: 'running' | 'ready' | 'interrupted' | 'error',
  existingLastError: string | null | undefined
): string | null {
  if (nextStatus === 'error') {
    return existingLastError ?? 'Claude subagent failed'
  }
  if (nextStatus === 'ready') {
    return null
  }
  return existingLastError ?? null
}

function buildClaudeSubagentSessionSnapshot(input: {
  readonly thread: ReadModelThread
  readonly parentThread: ReadModelThread
  readonly event: ProviderRuntimeEvent
  readonly nextStatus: 'running' | 'ready' | 'interrupted' | 'error'
}) {
  const existingSession = input.thread.session
  return {
    threadId: input.thread.id,
    status: input.nextStatus,
    providerName: input.event.provider,
    providerSessionId:
      existingSession?.providerSessionId ?? input.parentThread.session?.providerSessionId ?? null,
    providerThreadId:
      existingSession?.providerThreadId ?? input.thread.parentLink?.providerChildThreadId ?? null,
    runtimeMode: existingSession?.runtimeMode ?? input.parentThread.runtimeMode,
    activeTurnId: null,
    lastError: claudeSubagentLastError(input.nextStatus, existingSession?.lastError),
    updatedAt: input.event.createdAt,
  }
}

export const createClaudeSubagentThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('createClaudeSubagentThread')(function* (
    event: ProviderRuntimeEvent,
    parentThread: ReadModelThread,
    descriptor: ClaudeChildThreadDescriptor,
    projectRoot: string | null
  ) {
    const enrichedDescriptor = yield* enrichClaudeDescriptor(descriptor, projectRoot)
    const modelSelection = resolveClaudeSubagentModelSelection({
      descriptor: enrichedDescriptor,
      parentThread,
      discoveredModel: enrichedDescriptor.model,
    })

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.create',
      commandId: providerCommandId(
        event,
        `subagent-thread-create:${descriptor.providerChildThreadId}`
      ),
      threadId: descriptor.childThreadId,
      projectId: parentThread.projectId,
      title: buildBaseSubagentThreadTitle(enrichedDescriptor.agentLabel),
      modelSelection,
      runtimeMode: parentThread.runtimeMode,
      interactionMode: parentThread.interactionMode,
      branch: parentThread.branch,
      worktreePath: parentThread.worktreePath,
      parentLink: {
        parentThreadId: parentThread.id,
        relationKind: 'subagent',
        parentTurnId: event.turnId ?? null,
        provider: event.provider,
        providerTaskId: null,
        providerChildThreadId: descriptor.providerChildThreadId,
        agentLabel: enrichedDescriptor.agentLabel,
        createdAt: event.createdAt,
        completedAt: null,
      },
      createdAt: event.createdAt,
    })

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.session.set',
      commandId: providerCommandId(
        event,
        `subagent-thread-session-set:${descriptor.providerChildThreadId}`
      ),
      threadId: descriptor.childThreadId,
      session: {
        threadId: descriptor.childThreadId,
        status: 'running',
        providerName: event.provider,
        providerSessionId: parentThread.session?.providerSessionId ?? null,
        providerThreadId: descriptor.providerChildThreadId,
        runtimeMode: parentThread.runtimeMode,
        activeTurnId: null,
        lastError: null,
        updatedAt: event.createdAt,
      },
      createdAt: event.createdAt,
    })

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.message.seed',
      commandId: providerCommandId(
        event,
        `subagent-thread-seed:${descriptor.providerChildThreadId}`
      ),
      threadId: descriptor.childThreadId,
      messageId: claudeSeedMessageId(descriptor.childThreadId),
      role: 'user',
      text: buildClaudeSeedMessageText(enrichedDescriptor),
      turnId: null,
      createdAt: event.createdAt,
    })
  })

export const syncClaudeSubagentThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('syncClaudeSubagentThread')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    parentThread: ReadModelThread,
    descriptor: ClaudeChildThreadDescriptor,
    projectRoot: string | null
  ) {
    const enrichedDescriptor = yield* enrichClaudeDescriptor(descriptor, projectRoot)
    const nextTitle = buildBaseSubagentThreadTitle(enrichedDescriptor.agentLabel)
    const modelSelection = resolveClaudeSubagentModelSelection({
      descriptor: enrichedDescriptor,
      parentThread,
      discoveredModel: enrichedDescriptor.model,
    })
    if (
      thread.title !== nextTitle ||
      JSON.stringify(thread.modelSelection) !== JSON.stringify(modelSelection) ||
      thread.parentLink?.agentLabel !== enrichedDescriptor.agentLabel
    ) {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.meta.update',
        commandId: providerCommandId(
          event,
          `subagent-thread-meta-update:${descriptor.providerChildThreadId}`
        ),
        threadId: thread.id,
        title: nextTitle,
        modelSelection,
      })
    }

    const seedMessage = thread.messages.find(
      message => message.id === claudeSeedMessageId(thread.id)
    )
    const nextSeedText = buildClaudeSeedMessageText(enrichedDescriptor)
    if (!seedMessage || seedMessage.text !== nextSeedText) {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.message.seed',
        commandId: providerCommandId(
          event,
          `subagent-thread-seed:${descriptor.providerChildThreadId}`
        ),
        threadId: thread.id,
        messageId: claudeSeedMessageId(thread.id),
        role: 'user',
        text: nextSeedText,
        turnId: null,
        createdAt: event.createdAt,
      })
    }
  })

export const syncClaudeSubagentThreadSessionForEvent = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('syncClaudeSubagentThreadSessionForEvent')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    parentThread: ReadModelThread
  ) {
    if (!isClaudeSubagentThread(thread)) {
      return
    }

    const nextStatus = nextClaudeSubagentSessionStatus(event)
    if (!nextStatus) {
      return
    }

    const existingSession = thread.session
    if (existingSession?.status === nextStatus && existingSession.updatedAt === event.createdAt) {
      return
    }
    const providerChildThreadId = thread.parentLink?.providerChildThreadId ?? String(thread.id)

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.session.set',
      commandId: providerCommandId(event, `subagent-thread-session-sync:${providerChildThreadId}`),
      threadId: thread.id,
      session: buildClaudeSubagentSessionSnapshot({
        thread,
        parentThread,
        event,
        nextStatus,
      }),
      createdAt: event.createdAt,
    })
  })
