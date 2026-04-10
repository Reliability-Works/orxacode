import {
  MessageId,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect } from 'effect'
import { readCodexChildThreadDescriptors } from '../../codexChildThreads.ts'
import { readOpencodeChildThreadDescriptor } from '../../opencodeChildThreads.ts'
import { syncClaudeSubagentThreadSessionForEvent } from './ProviderRuntimeIngestion.claudeSubagents.ts'
import {
  ensureClaudeChildThreadsForEvent,
  resolveClaudeTargetThread,
} from './ProviderRuntimeIngestion.claudeRouting.ts'
import {
  createOpencodeSubagentThread,
  fillOpencodeDescriptorFromParentActivities,
  syncOpencodeSubagentThread,
} from './ProviderRuntimeIngestion.opencodeSubagents.ts'
import {
  proposedPlanIdFromEvent,
  providerCommandId,
  sameId,
  toTurnId,
} from './ProviderRuntimeIngestion.helpers.ts'
import {
  type LifecycleContext,
  type ProcessRuntimeEventDeps,
  type ReadModelThread,
  type RuntimeEventDispatchers,
  isLifecycleEvent,
  makeRuntimeEventDispatchers,
  shouldApplyThreadLifecycle,
} from './ProviderRuntimeIngestion.processEvent.handlers.ts'
export type { ProcessRuntimeEventDeps } from './ProviderRuntimeIngestion.processEvent.handlers.ts'
function buildSubagentThreadTitle(agentLabel: string | null): string {
  const trimmed = agentLabel?.trim()
  if (!trimmed) {
    return 'Codex Subagent'
  }
  return trimmed
    .split(/[\s_-]+/)
    .filter(part => part.length > 0)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
function buildSeedMessageText(
  descriptor: ReturnType<typeof readCodexChildThreadDescriptors>[number],
  event: Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.completed' }>
): string {
  const prompt =
    descriptor.prompt?.trim() ??
    (typeof event.payload.detail === 'string' ? event.payload.detail.trim() : '')
  if (prompt.length > 0) {
    return prompt
  }
  return 'Delegated task from parent thread. Exact provider prompt was not exposed.'
}
function isCodexCollabLifecycleEvent(
  event: ProviderRuntimeEvent
): event is Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.completed' }> {
  return (
    event.provider === 'codex' &&
    (event.type === 'item.started' || event.type === 'item.completed') &&
    event.payload.itemType === 'collab_agent_tool_call'
  )
}
function buildSubagentParentLink(
  thread: ReadModelThread,
  descriptor: ReturnType<typeof readCodexChildThreadDescriptors>[number],
  event: Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.completed' }>
) {
  return {
    parentThreadId: thread.id,
    relationKind: 'subagent' as const,
    parentTurnId: toTurnId(event.turnId) ?? null,
    provider: event.provider,
    providerTaskId: null,
    providerChildThreadId: descriptor.providerChildThreadId,
    agentLabel: descriptor.agentLabel,
    createdAt: event.createdAt,
    completedAt: null,
  }
}

const createCodexSubagentThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('createCodexSubagentThread')(function* (
    event: Extract<ProviderRuntimeEvent, { type: 'item.started' | 'item.completed' }>,
    thread: ReadModelThread,
    descriptor: ReturnType<typeof readCodexChildThreadDescriptors>[number]
  ) {
    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.create',
      commandId: providerCommandId(
        event,
        `subagent-thread-create:${descriptor.providerChildThreadId}`
      ),
      threadId: descriptor.childThreadId,
      projectId: thread.projectId,
      title: buildSubagentThreadTitle(descriptor.agentLabel),
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      parentLink: buildSubagentParentLink(thread, descriptor, event),
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
        providerSessionId: thread.session?.providerSessionId ?? null,
        providerThreadId: descriptor.providerChildThreadId,
        runtimeMode: thread.runtimeMode,
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
      messageId: MessageId.makeUnsafe(`seed:${descriptor.childThreadId}:delegated-prompt`),
      role: 'user',
      text: buildSeedMessageText(descriptor, event),
      turnId: null,
      createdAt: event.createdAt,
    })
  })

function resolveThreadForProviderSessionId(
  readModel: OrchestrationReadModel,
  providerSessionId: string
): ReadModelThread | undefined {
  return readModel.threads.find(
    entry =>
      entry.session?.providerSessionId === providerSessionId ||
      entry.parentLink?.providerChildThreadId === providerSessionId
  )
}

function extractOpencodeEventSessionId(event: ProviderRuntimeEvent): string | null {
  if (event.provider !== 'opencode' || event.raw?.source !== 'opencode.sdk.event') {
    return null
  }
  const payload =
    event.raw.payload && typeof event.raw.payload === 'object'
      ? (event.raw.payload as Record<string, unknown>)
      : null
  if (!payload) {
    return null
  }
  const info =
    payload.info && typeof payload.info === 'object'
      ? (payload.info as { id?: unknown })
      : undefined
  const sessionID =
    typeof payload.sessionID === 'string'
      ? payload.sessionID
      : typeof info?.id === 'string'
        ? info.id
        : null
  return sessionID
}

function isOpencodeSdkEvent(event: ProviderRuntimeEvent): boolean {
  return event.provider === 'opencode' && event.raw?.source === 'opencode.sdk.event'
}

const ensureCodexChildThreadsForEvent = (deps: ProcessRuntimeEventDeps) => {
  const createSubagentThread = createCodexSubagentThread(deps)
  return Effect.fn('ensureCodexChildThreadsForEvent')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    readModel: OrchestrationReadModel
  ) {
    if (!isCodexCollabLifecycleEvent(event)) {
      return
    }

    const childDescriptors = readCodexChildThreadDescriptors(
      thread.id,
      event.payload.data ?? event.raw?.payload
    )
    for (const descriptor of childDescriptors) {
      if (readModel.threads.some(entry => entry.id === descriptor.childThreadId)) {
        continue
      }
      yield* createSubagentThread(event, thread, descriptor)
    }
  })
}

function existingOpencodeChildThreadForSession(
  readModel: OrchestrationReadModel,
  providerSessionId: string | null
): ReadModelThread | undefined {
  if (!providerSessionId) {
    return undefined
  }
  return readModel.threads.find(
    entry =>
      entry.parentLink?.relationKind === 'subagent' &&
      (entry.parentLink.providerChildThreadId === providerSessionId ||
        entry.session?.providerSessionId === providerSessionId)
  )
}

function resolveThreadProjectRoot(
  readModel: OrchestrationReadModel,
  thread: ReadModelThread
): string | null {
  return (
    thread.worktreePath ??
    readModel.projects.find(project => project.id === thread.projectId)?.workspaceRoot ??
    null
  )
}

const syncExistingOpencodeChildThreadForEvent = (deps: ProcessRuntimeEventDeps) => {
  const syncSubagentThread = syncOpencodeSubagentThread(deps)
  return Effect.fn('syncExistingOpencodeChildThreadForEvent')(function* (
    event: ProviderRuntimeEvent,
    readModel: OrchestrationReadModel,
    existingThreadBySession: ReadModelThread,
    providerSessionId: string | null
  ) {
    if (!existingThreadBySession.parentLink?.parentThreadId) {
      return
    }
    const parentThread = readModel.threads.find(
      entry => entry.id === existingThreadBySession.parentLink?.parentThreadId
    )
    if (!parentThread) {
      return
    }
    const projectRoot = resolveThreadProjectRoot(readModel, parentThread)
    const resolvedDescriptor = fillOpencodeDescriptorFromParentActivities(parentThread, {
      providerParentSessionId:
        parentThread.session?.providerSessionId ??
        existingThreadBySession.parentLink.providerChildThreadId ??
        existingThreadBySession.session?.providerSessionId ??
        providerSessionId ??
        existingThreadBySession.id,
      providerChildThreadId:
        existingThreadBySession.parentLink.providerChildThreadId ??
        existingThreadBySession.session?.providerSessionId ??
        providerSessionId ??
        '',
      childThreadId: existingThreadBySession.id,
      title: existingThreadBySession.title,
      agentLabel: existingThreadBySession.parentLink.agentLabel ?? null,
      prompt: null,
      description: null,
      modelSelection:
        existingThreadBySession.modelSelection.provider === 'opencode'
          ? existingThreadBySession.modelSelection
          : null,
    })
    yield* syncSubagentThread(event, existingThreadBySession, resolvedDescriptor, projectRoot)
  })
}

const ensureOpencodeChildThreadsForEvent = (deps: ProcessRuntimeEventDeps) => {
  const createSubagentThread = createOpencodeSubagentThread(deps)
  const syncSubagentThread = syncOpencodeSubagentThread(deps)
  const syncExistingChildThread = syncExistingOpencodeChildThreadForEvent(deps)
  return Effect.fn('ensureOpencodeChildThreadsForEvent')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    readModel: OrchestrationReadModel
  ) {
    if (!isOpencodeSdkEvent(event)) {
      return
    }

    const providerSessionId = extractOpencodeEventSessionId(event)
    const existingThreadBySession = existingOpencodeChildThreadForSession(
      readModel,
      providerSessionId
    )

    if (
      event.raw?.messageType !== 'session.created' &&
      event.raw?.messageType !== 'session.updated'
    ) {
      if (!existingThreadBySession) {
        return
      }
      yield* syncExistingChildThread(event, readModel, existingThreadBySession, providerSessionId)
      return
    }

    const descriptor = readOpencodeChildThreadDescriptor(thread.id, event.raw?.payload)
    if (!descriptor) {
      return
    }

    const parentThread =
      resolveThreadForProviderSessionId(readModel, descriptor.providerParentSessionId) ?? thread
    const rawResolvedDescriptor = readOpencodeChildThreadDescriptor(
      parentThread.id,
      event.raw?.payload
    )
    if (!rawResolvedDescriptor) {
      return
    }
    const resolvedDescriptor = fillOpencodeDescriptorFromParentActivities(
      parentThread,
      rawResolvedDescriptor
    )
    const projectRoot = resolveThreadProjectRoot(readModel, parentThread)
    const existingThread = readModel.threads.find(
      entry => entry.id === resolvedDescriptor.childThreadId
    )
    if (existingThread) {
      yield* syncSubagentThread(event, existingThread, resolvedDescriptor, projectRoot)
      return
    }
    yield* createSubagentThread(event, parentThread, resolvedDescriptor, projectRoot)
  })
}

function resolveTargetThread(
  readModel: OrchestrationReadModel,
  event: ProviderRuntimeEvent
): ReadModelThread | undefined {
  const claudeThread = resolveClaudeTargetThread(readModel, event)
  if (claudeThread) {
    return claudeThread
  }

  const providerSessionId = extractOpencodeEventSessionId(event)
  if (providerSessionId) {
    const routedThread = resolveThreadForProviderSessionId(readModel, providerSessionId)
    if (routedThread) {
      return routedThread
    }
  }
  return readModel.threads.find(entry => entry.id === event.threadId)
}

function buildLifecycleContext(
  event: ProviderRuntimeEvent,
  thread: ReadModelThread
): LifecycleContext {
  const eventTurnId = toTurnId(event.turnId)
  const activeTurnId = thread.session?.activeTurnId ?? null
  const conflictsWithActiveTurn =
    activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId)
  const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined
  return {
    event,
    thread,
    now: event.createdAt,
    eventTurnId,
    activeTurnId,
    conflictsWithActiveTurn,
    missingTurnForActiveTurn,
  }
}

function extractAssistantDelta(event: ProviderRuntimeEvent): string | undefined {
  return event.type === 'content.delta' && event.payload.streamKind === 'assistant_text'
    ? event.payload.delta
    : undefined
}

function extractProposedPlanDelta(event: ProviderRuntimeEvent): string | undefined {
  return event.type === 'turn.proposed.delta' ? event.payload.delta : undefined
}

function extractAssistantCompletion(
  event: ProviderRuntimeEvent
): { messageId: MessageId; fallbackText: string | undefined } | undefined {
  if (event.type === 'item.completed' && event.payload.itemType === 'assistant_message') {
    return {
      messageId: MessageId.makeUnsafe(`assistant:${event.itemId ?? event.turnId ?? event.eventId}`),
      fallbackText: event.payload.detail,
    }
  }
  return undefined
}

function extractProposedPlanCompletion(
  event: ProviderRuntimeEvent,
  threadId: ThreadId
): { planId: string; turnId: TurnId | undefined; planMarkdown: string | undefined } | undefined {
  if (event.type !== 'turn.proposed.completed') {
    return undefined
  }
  return {
    planId: proposedPlanIdFromEvent(event, threadId),
    turnId: toTurnId(event.turnId),
    planMarkdown: event.payload.planMarkdown,
  }
}

const runLifecycleStep = (dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runLifecycleStep')(function* (ctx: LifecycleContext) {
    const apply = shouldApplyThreadLifecycle(ctx)
    const acceptedTurnStartedSourcePlan =
      ctx.event.type === 'turn.started' && apply
        ? yield* dispatchers.resolveAcceptedSourcePlan(ctx.thread.id, ctx.eventTurnId)
        : null

    if (isLifecycleEvent(ctx.event) && apply) {
      yield* dispatchers.handleLifecycle(ctx, acceptedTurnStartedSourcePlan)
    }
  })

const runAssistantCompletionSteps = (dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runAssistantCompletionSteps')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string
  ) {
    const assistantCompletion = extractAssistantCompletion(event)
    if (assistantCompletion) {
      yield* dispatchers.handleAssistantCompleted(event, thread, now, assistantCompletion)
    }

    const proposedPlanCompletion = extractProposedPlanCompletion(event, thread.id)
    if (proposedPlanCompletion) {
      yield* dispatchers.finalizePlan({
        event,
        threadId: thread.id,
        threadProposedPlans: thread.proposedPlans,
        planId: proposedPlanCompletion.planId,
        ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
        ...(proposedPlanCompletion.planMarkdown !== undefined
          ? { fallbackMarkdown: proposedPlanCompletion.planMarkdown }
          : {}),
        updatedAt: now,
      })
    }
  })

const runTerminalSteps = (deps: ProcessRuntimeEventDeps, dispatchers: RuntimeEventDispatchers) =>
  Effect.fn('runTerminalSteps')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    now: string,
    activeTurnId: TurnId | null,
    eventTurnId: TurnId | undefined
  ) {
    if (event.type === 'turn.completed') {
      yield* dispatchers.handleTurnCompleted(event, thread, now)
    }

    if (event.type === 'session.exited') {
      yield* deps.stateOps.clearTurnStateForSession(thread.id)
    }

    if (event.type === 'runtime.error') {
      yield* dispatchers.handleErrorEvent(event, thread, now, activeTurnId, eventTurnId)
    }

    if (event.type === 'thread.metadata.updated' && event.payload.name) {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.meta.update',
        commandId: providerCommandId(event, 'thread-meta-update'),
        threadId: thread.id,
        title: event.payload.name,
      })
    }

    if (event.type === 'turn.diff.updated') {
      yield* dispatchers.handleDiffUpdated(event, thread, now)
    }

    yield* dispatchers.dispatchActivitiesEffect(event, thread)
  })

export const createProcessRuntimeEvent = (deps: ProcessRuntimeEventDeps) => {
  const dispatchers = makeRuntimeEventDispatchers(deps)
  const ensureCodexChildThreads = ensureCodexChildThreadsForEvent(deps)
  const ensureClaudeChildThreads = ensureClaudeChildThreadsForEvent(deps, resolveThreadProjectRoot)
  const ensureOpencodeChildThreads = ensureOpencodeChildThreadsForEvent(deps)
  const syncClaudeSubagentSession = syncClaudeSubagentThreadSessionForEvent(deps)
  const lifecycleStep = runLifecycleStep(dispatchers)
  const assistantCompletionSteps = runAssistantCompletionSteps(dispatchers)
  const terminalSteps = runTerminalSteps(deps, dispatchers)

  return Effect.fn('processRuntimeEvent')(function* (event: ProviderRuntimeEvent) {
    const initialReadModel = yield* deps.orchestrationEngine.getReadModel()
    const initialThread = initialReadModel.threads.find(entry => entry.id === event.threadId)
    if (!initialThread) return

    yield* ensureCodexChildThreads(event, initialThread, initialReadModel)
    yield* ensureClaudeChildThreads(event, initialThread, initialReadModel)
    yield* ensureOpencodeChildThreads(event, initialThread, initialReadModel)

    const readModel = yield* deps.orchestrationEngine.getReadModel()
    const thread = resolveTargetThread(readModel, event)
    if (!thread) return

    if (thread.parentLink?.relationKind === 'subagent' && thread.parentLink.parentThreadId) {
      const parentThread = readModel.threads.find(
        entry => entry.id === thread.parentLink?.parentThreadId
      )
      if (parentThread) {
        yield* syncClaudeSubagentSession(event, thread, parentThread)
      }
    }

    const ctx = buildLifecycleContext(event, thread)

    yield* lifecycleStep(ctx)

    const assistantDelta = extractAssistantDelta(event)
    if (assistantDelta && assistantDelta.length > 0) {
      yield* dispatchers.handleDelta(event, thread, ctx.now, assistantDelta)
    }

    const proposedPlanDelta = extractProposedPlanDelta(event)
    if (proposedPlanDelta && proposedPlanDelta.length > 0) {
      const planId = proposedPlanIdFromEvent(event, thread.id)
      yield* deps.stateOps.appendBufferedProposedPlan(planId, proposedPlanDelta, ctx.now)
    }

    yield* assistantCompletionSteps(event, thread, ctx.now)
    yield* terminalSteps(event, thread, ctx.now, ctx.activeTurnId, ctx.eventTurnId)
  })
}
