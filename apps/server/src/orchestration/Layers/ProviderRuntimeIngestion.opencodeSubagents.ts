import { Effect } from 'effect'
import {
  MessageId,
  type ModelSelection,
  type ProviderRuntimeEvent,
  type ThreadId,
} from '@orxa-code/contracts'
import {
  opencodeChildTurnId,
  readOpencodeDelegationFieldsFromActivityData,
  type OpencodeChildThreadDescriptor,
} from '../../opencodeChildThreads.ts'
import { findDiscoveredOpencodeAgentById } from '../../provider/opencodeAgents.ts'
import { providerCommandId } from './ProviderRuntimeIngestion.helpers.ts'
import { buildDelegatedPromptSeedText, buildSubagentThreadTitle } from '@orxa-code/shared/subagent'
import type {
  ProcessRuntimeEventDeps,
  ReadModelThread,
} from './ProviderRuntimeIngestion.processEvent.handlers.ts'
import {
  dispatchRunningSubagentSession,
  dispatchSubagentSeedMessage,
} from './ProviderRuntimeIngestion.subagents.shared.ts'

export function buildOpencodeSubagentThreadTitle(
  title: string | null,
  agentLabel: string | null
): string {
  const trimmedAgentLabel = agentLabel?.trim()
  if (trimmedAgentLabel) {
    return buildSubagentThreadTitle(trimmedAgentLabel, 'Opencode Subagent')
  }
  const trimmedTitle = title?.trim()
  if (trimmedTitle) {
    return trimmedTitle
  }
  return buildSubagentThreadTitle(agentLabel, 'Opencode Subagent')
}

export function opencodeSeedMessageId(childThreadId: ThreadId): MessageId {
  return MessageId.makeUnsafe(`seed:${childThreadId}:delegated-prompt`)
}

export function buildOpencodeSeedMessageText(
  descriptor: OpencodeChildThreadDescriptor | null
): string {
  if (!descriptor) {
    return buildDelegatedPromptSeedText()
  }
  return buildDelegatedPromptSeedText(descriptor.prompt, descriptor.description)
}

function readOpencodeActivityDelegation(payload: unknown) {
  const activityPayload =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (activityPayload?.itemType !== 'collab_agent_tool_call') {
    return null
  }
  const data =
    activityPayload.data && typeof activityPayload.data === 'object'
      ? (activityPayload.data as Record<string, unknown>)
      : null
  return readOpencodeDelegationFieldsFromActivityData(data?.item ?? data)
}

function scoreOpencodeDelegationCandidate(
  descriptor: OpencodeChildThreadDescriptor,
  candidate: NonNullable<ReturnType<typeof readOpencodeActivityDelegation>>
): number {
  let score = 0
  if (descriptor.agentLabel && descriptor.agentLabel === candidate.agentLabel) {
    score += 4
  }
  if (descriptor.description && descriptor.description === candidate.description) {
    score += 3
  }
  if (
    descriptor.title &&
    (descriptor.title === candidate.description || descriptor.title === candidate.prompt)
  ) {
    score += 2
  }
  if (
    descriptor.modelSelection?.model &&
    descriptor.modelSelection.model === candidate.modelSelection?.model
  ) {
    score += 1
  }
  return score
}

export function fillOpencodeDescriptorFromParentActivities(
  parentThread: ReadModelThread,
  descriptor: OpencodeChildThreadDescriptor
): OpencodeChildThreadDescriptor {
  const candidates = [...parentThread.activities]
    .reverse()
    .map(activity => readOpencodeActivityDelegation(activity.payload))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
  if (candidates.length === 0) {
    return descriptor
  }

  const bestCandidate =
    candidates
      .map(candidate => ({
        candidate,
        score: scoreOpencodeDelegationCandidate(descriptor, candidate),
      }))
      .sort((left, right) => right.score - left.score)[0]?.candidate ??
    (candidates.length === 1 ? candidates[0] : null)

  if (!bestCandidate) {
    return descriptor
  }

  return {
    ...descriptor,
    agentLabel: descriptor.agentLabel ?? bestCandidate.agentLabel,
    prompt: descriptor.prompt ?? bestCandidate.prompt,
    description: descriptor.description ?? bestCandidate.description,
    modelSelection: descriptor.modelSelection ?? bestCandidate.modelSelection,
  }
}

const enrichOpencodeDescriptorFromAgentCatalog = Effect.fn(
  'enrichOpencodeDescriptorFromAgentCatalog'
)(function* (descriptor: OpencodeChildThreadDescriptor, projectRoot: string | null) {
  const agentId = descriptor.agentLabel?.trim()
  if (!agentId) {
    return descriptor
  }
  const agent = yield* Effect.tryPromise({
    try: () => findDiscoveredOpencodeAgentById(agentId, projectRoot ? { projectRoot } : undefined),
    catch: () => null,
  })
  if (!agent) {
    return descriptor
  }
  return {
    ...descriptor,
    agentLabel: agent.name || agent.id,
    modelSelection: agent.model
      ? {
          provider: 'opencode',
          model: agent.model,
          agentId: agent.id,
          ...(descriptor.modelSelection?.options
            ? { options: descriptor.modelSelection.options }
            : {}),
          ...(descriptor.modelSelection?.variant
            ? { variant: descriptor.modelSelection.variant }
            : {}),
        }
      : (descriptor.modelSelection ?? null),
  } satisfies OpencodeChildThreadDescriptor
})

export const createOpencodeSubagentThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('createOpencodeSubagentThread')(function* (
    event: ProviderRuntimeEvent,
    parentThread: ReadModelThread,
    descriptor: OpencodeChildThreadDescriptor,
    projectRoot: string | null
  ) {
    const enrichedDescriptor = yield* enrichOpencodeDescriptorFromAgentCatalog(
      descriptor,
      projectRoot
    )
    const modelSelection: ModelSelection =
      enrichedDescriptor.modelSelection ?? parentThread.modelSelection
    yield* dispatchCreatedThread(deps, event, parentThread, enrichedDescriptor, modelSelection)
    yield* dispatchCreatedThreadSession(deps, event, parentThread, enrichedDescriptor)
    yield* dispatchSeededPrompt(
      deps,
      event,
      enrichedDescriptor.childThreadId,
      enrichedDescriptor.providerChildThreadId,
      buildOpencodeSeedMessageText(enrichedDescriptor)
    )
  })

export const syncOpencodeSubagentThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('syncOpencodeSubagentThread')(function* (
    event: ProviderRuntimeEvent,
    thread: ReadModelThread,
    descriptor: OpencodeChildThreadDescriptor,
    projectRoot: string | null
  ) {
    const enrichedDescriptor = yield* enrichOpencodeDescriptorFromAgentCatalog(
      descriptor,
      projectRoot
    )
    const nextTitle = buildOpencodeSubagentThreadTitle(
      enrichedDescriptor.title,
      enrichedDescriptor.agentLabel
    )
    const modelSelection = enrichedDescriptor.modelSelection ?? thread.modelSelection
    yield* maybeDispatchThreadMetaUpdate(
      deps,
      event,
      thread,
      enrichedDescriptor.providerChildThreadId,
      nextTitle,
      modelSelection
    )
    const nextSeedText = buildOpencodeSeedMessageText(enrichedDescriptor)
    const seedMessage = thread.messages.find(
      message => message.id === opencodeSeedMessageId(thread.id)
    )
    if (!seedMessage || seedMessage.text !== nextSeedText) {
      yield* dispatchSeededPrompt(
        deps,
        event,
        thread.id,
        enrichedDescriptor.providerChildThreadId,
        nextSeedText
      )
    }
  })

const dispatchCreatedThread = (
  deps: ProcessRuntimeEventDeps,
  event: ProviderRuntimeEvent,
  parentThread: ReadModelThread,
  descriptor: OpencodeChildThreadDescriptor,
  modelSelection: ModelSelection
) =>
  deps.orchestrationEngine.dispatch({
    type: 'thread.create',
    commandId: providerCommandId(
      event,
      `subagent-thread-create:${descriptor.providerChildThreadId}`
    ),
    threadId: descriptor.childThreadId,
    projectId: parentThread.projectId,
    title: buildOpencodeSubagentThreadTitle(descriptor.title, descriptor.agentLabel),
    modelSelection,
    runtimeMode: parentThread.runtimeMode,
    interactionMode: parentThread.interactionMode,
    branch: parentThread.branch,
    worktreePath: parentThread.worktreePath,
    gitRoot: parentThread.gitRoot,
    parentLink: {
      parentThreadId: parentThread.id,
      relationKind: 'subagent',
      parentTurnId: null,
      provider: event.provider,
      providerTaskId: null,
      providerChildThreadId: descriptor.providerChildThreadId,
      agentLabel: descriptor.agentLabel,
      createdAt: event.createdAt,
      completedAt: null,
    },
    createdAt: event.createdAt,
  })

const dispatchCreatedThreadSession = (
  deps: ProcessRuntimeEventDeps,
  event: ProviderRuntimeEvent,
  parentThread: ReadModelThread,
  descriptor: OpencodeChildThreadDescriptor
) =>
  dispatchRunningSubagentSession({
    deps,
    event,
    threadId: descriptor.childThreadId,
    providerChildThreadId: descriptor.providerChildThreadId,
    providerSessionId: descriptor.providerChildThreadId,
    runtimeMode: parentThread.runtimeMode,
    activeTurnId: opencodeChildTurnId(descriptor.providerChildThreadId),
  })

const dispatchSeededPrompt = (
  deps: ProcessRuntimeEventDeps,
  event: ProviderRuntimeEvent,
  threadId: ThreadId,
  providerChildThreadId: string,
  text: string
) =>
  dispatchSubagentSeedMessage({
    deps,
    event,
    threadId,
    providerChildThreadId,
    messageId: opencodeSeedMessageId(threadId),
    text,
  })

const maybeDispatchThreadMetaUpdate = (
  deps: ProcessRuntimeEventDeps,
  event: ProviderRuntimeEvent,
  thread: ReadModelThread,
  providerChildThreadId: string,
  nextTitle: string,
  modelSelection: ModelSelection
) => {
  const shouldUpdateMeta =
    thread.title !== nextTitle ||
    JSON.stringify(thread.modelSelection) !== JSON.stringify(modelSelection)
  if (!shouldUpdateMeta) {
    return Effect.void
  }
  return deps.orchestrationEngine.dispatch({
    type: 'thread.meta.update',
    commandId: providerCommandId(event, `subagent-thread-meta-update:${providerChildThreadId}`),
    threadId: thread.id,
    title: nextTitle,
    modelSelection,
  })
}
