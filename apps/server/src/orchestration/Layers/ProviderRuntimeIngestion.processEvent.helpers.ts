import {
  CommandId,
  MessageId,
  type OrchestrationProposedPlanId,
  type OrchestrationReadModel,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import { Effect, Option } from 'effect'

import { resolveThreadWorkspaceCwd } from '../../checkpointing/Utils.ts'
import { isGitRepository } from '../../git/Utils.ts'
import type { ProjectionTurnRepositoryShape } from '../../persistence/Services/ProjectionTurns.ts'
import type { ProviderServiceShape } from '../../provider/Services/ProviderService.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import type { OrchestrationEngineShape } from '../Services/OrchestrationEngine.ts'
import {
  normalizeProposedPlanMarkdown,
  providerCommandId,
  sameId,
} from './ProviderRuntimeIngestion.helpers.ts'
import type { ProviderRuntimeIngestionStateOps } from './ProviderRuntimeIngestion.state.ts'

export type ReadModelThread = OrchestrationReadModel['threads'][number]
type ReadModelProposedPlan = ReadModelThread['proposedPlans'][number]

export interface ProcessRuntimeEventDeps {
  readonly orchestrationEngine: OrchestrationEngineShape
  readonly providerService: ProviderServiceShape
  readonly projectionTurnRepository: ProjectionTurnRepositoryShape
  readonly serverSettingsService: ServerSettingsShape
  readonly stateOps: ProviderRuntimeIngestionStateOps
}

export const isGitRepoForThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fnUntraced(function* (threadId: ThreadId) {
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    const thread = readModel.threads.find(entry => entry.id === threadId)
    if (!thread) {
      return false
    }
    const workspaceCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: readModel.projects,
    })
    if (!workspaceCwd) {
      return false
    }
    return isGitRepository(workspaceCwd)
  })

export const finalizeAssistantMessage = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('finalizeAssistantMessage')(function* (input: {
    event: ProviderRuntimeEvent
    threadId: ThreadId
    messageId: MessageId
    turnId?: TurnId
    createdAt: string
    commandTag: string
    finalDeltaCommandTag: string
    fallbackText?: string
  }) {
    const bufferedText = yield* deps.stateOps.takeBufferedAssistantText(input.messageId)
    const text =
      bufferedText.length > 0
        ? bufferedText
        : (input.fallbackText?.trim().length ?? 0) > 0
          ? input.fallbackText!
          : ''

    if (text.length > 0) {
      yield* deps.orchestrationEngine.dispatch({
        type: 'thread.message.assistant.delta',
        commandId: providerCommandId(input.event, input.finalDeltaCommandTag),
        threadId: input.threadId,
        messageId: input.messageId,
        delta: text,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      })
    }

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.message.assistant.complete',
      commandId: providerCommandId(input.event, input.commandTag),
      threadId: input.threadId,
      messageId: input.messageId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      createdAt: input.createdAt,
    })
    yield* deps.stateOps.clearAssistantMessageState(input.messageId)
  })

type ProposedPlanInputBase = {
  event: ProviderRuntimeEvent
  threadId: ThreadId
  threadProposedPlans: ReadonlyArray<{
    id: string
    createdAt: string
    implementedAt: string | null
    implementationThreadId: ThreadId | null
  }>
  planId: string
  turnId?: TurnId
  updatedAt: string
}

const upsertProposedPlan = (deps: ProcessRuntimeEventDeps) =>
  Effect.fn('upsertProposedPlan')(function* (
    input: ProposedPlanInputBase & {
      planMarkdown: string | undefined
      createdAt: string
    }
  ) {
    const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown)
    if (!planMarkdown) {
      return
    }

    const existingPlan = input.threadProposedPlans.find(entry => entry.id === input.planId)
    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.proposed-plan.upsert',
      commandId: providerCommandId(input.event, 'proposed-plan-upsert'),
      threadId: input.threadId,
      proposedPlan: {
        id: input.planId,
        turnId: input.turnId ?? null,
        planMarkdown,
        implementedAt: existingPlan?.implementedAt ?? null,
        implementationThreadId: existingPlan?.implementationThreadId ?? null,
        createdAt: existingPlan?.createdAt ?? input.createdAt,
        updatedAt: input.updatedAt,
      },
      createdAt: input.updatedAt,
    })
  })

export const finalizeBufferedProposedPlan = (deps: ProcessRuntimeEventDeps) => {
  const upsert = upsertProposedPlan(deps)
  return Effect.fn('finalizeBufferedProposedPlan')(function* (
    input: ProposedPlanInputBase & {
      fallbackMarkdown?: string
    }
  ) {
    const bufferedPlan = yield* deps.stateOps.takeBufferedProposedPlan(input.planId)
    const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text)
    const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown)
    const planMarkdown = bufferedMarkdown ?? fallbackMarkdown
    if (!planMarkdown) {
      return
    }

    yield* upsert({
      event: input.event,
      threadId: input.threadId,
      threadProposedPlans: input.threadProposedPlans,
      planId: input.planId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      planMarkdown,
      createdAt:
        bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
          ? bufferedPlan.createdAt
          : input.updatedAt,
      updatedAt: input.updatedAt,
    })
    yield* deps.stateOps.clearBufferedProposedPlan(input.planId)
  })
}

const getSourceProposedPlanReferenceForPendingTurnStart = (deps: ProcessRuntimeEventDeps) =>
  Effect.fnUntraced(function* (threadId: ThreadId) {
    const pendingTurnStart = yield* deps.projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    })
    if (Option.isNone(pendingTurnStart)) {
      return null
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId
    if (sourceThreadId === null || sourcePlanId === null) {
      return null
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const
  })

const getExpectedProviderTurnIdForThread = (deps: ProcessRuntimeEventDeps) =>
  Effect.fnUntraced(function* (threadId: ThreadId) {
    const sessions = yield* deps.providerService.listSessions()
    const session = sessions.find(entry => entry.threadId === threadId)
    return session?.activeTurnId
  })

export const getSourceProposedPlanReferenceForAcceptedTurnStart = (
  deps: ProcessRuntimeEventDeps
) => {
  const expected = getExpectedProviderTurnIdForThread(deps)
  const pending = getSourceProposedPlanReferenceForPendingTurnStart(deps)
  return Effect.fnUntraced(function* (threadId: ThreadId, eventTurnId: TurnId | undefined) {
    if (eventTurnId === undefined) {
      return null
    }
    const expectedTurnId = yield* expected(threadId)
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null
    }
    return yield* pending(threadId)
  })
}

export const markSourceProposedPlanImplemented = (deps: ProcessRuntimeEventDeps) =>
  Effect.fnUntraced(function* (
    sourceThreadId: ThreadId,
    sourcePlanId: OrchestrationProposedPlanId,
    implementationThreadId: ThreadId,
    implementedAt: string
  ) {
    const readModel = yield* deps.orchestrationEngine.getReadModel()
    const sourceThread = readModel.threads.find(entry => entry.id === sourceThreadId)
    const sourcePlan = sourceThread?.proposedPlans.find(
      (entry: ReadModelProposedPlan) => entry.id === sourcePlanId
    )
    if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
      return
    }

    yield* deps.orchestrationEngine.dispatch({
      type: 'thread.proposed-plan.upsert',
      commandId: CommandId.makeUnsafe(
        `provider:source-proposed-plan-implemented:${implementationThreadId}:${crypto.randomUUID()}`
      ),
      threadId: sourceThread.id,
      proposedPlan: {
        ...sourcePlan,
        implementedAt,
        implementationThreadId,
        updatedAt: implementedAt,
      },
      createdAt: implementedAt,
    })
  })
