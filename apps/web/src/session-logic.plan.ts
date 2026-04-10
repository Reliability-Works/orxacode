import type {
  OrchestrationLatestTurn,
  OrchestrationLatestTurnState,
  OrchestrationProposedPlanId,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'

import { compareActivitiesByOrder } from './session-logic.activity'
import { deriveActivePlanFromTodoToolActivity } from './session-logic.plan.todos'
import {
  cleanPlanStepText,
  deriveTextualActivePlanState,
  normalizePlanStepStatus,
  stripPromotedTaskListFromMessage,
} from './session-logic.plan.text'
import type { ChatMessage, ProposedPlan, Thread } from './types'

export { stripPromotedTaskListFromMessage }

export type ActivePlanStep = {
  step: string
  status: 'pending' | 'inProgress' | 'paused' | 'completed'
}

export interface ActivePlanState {
  createdAt: string
  turnId: TurnId | null
  explanation?: string | null
  steps: ActivePlanStep[]
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId
  createdAt: string
  updatedAt: string
  turnId: TurnId | null
  planMarkdown: string
  implementedAt: string | null
  implementationThreadId: ThreadId | null
}

function toPausedStatus(status: ActivePlanState['steps'][number]['status']) {
  return status === 'inProgress' ? 'paused' : status
}

function findNextActionableStepIndex(steps: ReadonlyArray<ActivePlanStep>): number {
  const pendingIndex = steps.findIndex(step => step.status === 'pending')
  return pendingIndex >= 0 ? pendingIndex : -1
}

function inferRunningPlanSteps(steps: ReadonlyArray<ActivePlanStep>): ActivePlanStep[] {
  if (steps.some(step => step.status === 'inProgress' || step.status === 'paused')) {
    return [...steps]
  }
  const nextActionableStepIndex = findNextActionableStepIndex(steps)
  if (nextActionableStepIndex < 0) {
    return [...steps]
  }
  return steps.map((step, index) => ({
    ...step,
    status: index === nextActionableStepIndex ? 'inProgress' : step.status,
  }))
}

function inferPausedPlanSteps(steps: ReadonlyArray<ActivePlanStep>): ActivePlanStep[] {
  if (steps.some(step => step.status === 'inProgress')) {
    return steps.map(step => ({
      ...step,
      status: toPausedStatus(step.status),
    }))
  }
  const nextActionableStepIndex = findNextActionableStepIndex(steps)
  if (nextActionableStepIndex < 0) {
    return [...steps]
  }
  return steps.map((step, index) => ({
    ...step,
    status: index === nextActionableStepIndex ? 'paused' : step.status,
  }))
}

function parseStructuredPlanSteps(payload: Record<string, unknown> | null): ActivePlanStep[] {
  const rawPlan = payload?.plan
  if (!Array.isArray(rawPlan)) {
    return []
  }
  return rawPlan
    .map<ActivePlanStep | null>(entry => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      if (typeof record.step !== 'string') {
        return null
      }
      return {
        step: cleanPlanStepText(record.step),
        status: normalizePlanStepStatus(
          typeof record.status === 'string' ? record.status : undefined
        ),
      }
    })
    .filter((step): step is ActivePlanStep => step !== null)
}

function toPlanPayloadRecord(
  activity: OrchestrationThreadActivity
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === 'object'
    ? (activity.payload as Record<string, unknown>)
    : null
}

function toActivePlanFromPlanActivity(
  activity: OrchestrationThreadActivity | undefined
): ActivePlanState | null {
  if (!activity || activity.kind !== 'turn.plan.updated') {
    return null
  }
  const payload = toPlanPayloadRecord(activity)
  const steps = parseStructuredPlanSteps(payload)
  if (steps.length === 0) {
    return null
  }
  return {
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    ...(payload && 'explanation' in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
  }
}

function findLatestPlanActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): OrchestrationThreadActivity | undefined {
  const ordered = [...activities].toSorted(compareActivitiesByOrder)
  const latestForTurn = ordered
    .filter(activity => {
      if (activity.kind !== 'turn.plan.updated') {
        return false
      }
      return latestTurnId ? activity.turnId === latestTurnId : true
    })
    .at(-1)
  if (latestForTurn) {
    return latestForTurn
  }
  return [...ordered].reverse().find(activity => activity.kind === 'turn.plan.updated')
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined,
  messages: ReadonlyArray<ChatMessage> = [],
  latestAssistantMessageId?: string | null
): ActivePlanState | null {
  const planFromActivity = toActivePlanFromPlanActivity(
    findLatestPlanActivity(activities, latestTurnId)
  )
  if (planFromActivity) {
    return planFromActivity
  }
  const planFromTodoToolActivity = deriveActivePlanFromTodoToolActivity(activities, latestTurnId)
  if (planFromTodoToolActivity) {
    return planFromTodoToolActivity
  }
  return deriveTextualActivePlanState({
    messages,
    latestTurnId,
    latestAssistantMessageId,
  })
}

export function deriveDisplayActivePlanState(
  activePlan: ActivePlanState | null,
  input: {
    orchestrationStatus: OrchestrationSessionStatus | null | undefined
    latestTurnState: OrchestrationLatestTurnState | null | undefined
  }
): ActivePlanState | null {
  if (!activePlan) {
    return null
  }
  const isActivelyRunning =
    input.orchestrationStatus === 'running' || input.latestTurnState === 'running'
  return {
    ...activePlan,
    steps: isActivelyRunning
      ? inferRunningPlanSteps(activePlan.steps)
      : inferPausedPlanSteps(activePlan.steps),
  }
}

export function findLatestProposedPlan(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  latestTurnId: TurnId | string | null | undefined
): LatestProposedPlanState | null {
  if (latestTurnId) {
    const matchingTurnPlan = [...proposedPlans]
      .filter(proposedPlan => proposedPlan.turnId === latestTurnId)
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
      )
      .at(-1)
    if (matchingTurnPlan) {
      return toLatestProposedPlanState(matchingTurnPlan)
    }
  }

  const latestPlan = [...proposedPlans]
    .toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)
    )
    .at(-1)
  return latestPlan ? toLatestProposedPlanState(latestPlan) : null
}

export function findSidebarProposedPlan(input: {
  threads: ReadonlyArray<Pick<Thread, 'id' | 'proposedPlans'>>
  latestTurn: Pick<OrchestrationLatestTurn, 'turnId' | 'sourceProposedPlan'> | null
  latestTurnSettled: boolean
  threadId: ThreadId | string | null | undefined
}): LatestProposedPlanState | null {
  const activeThreadPlans =
    input.threads.find(thread => thread.id === input.threadId)?.proposedPlans ?? []

  if (!input.latestTurnSettled) {
    const sourceProposedPlan = input.latestTurn?.sourceProposedPlan
    if (sourceProposedPlan) {
      const sourcePlan = input.threads
        .find(thread => thread.id === sourceProposedPlan.threadId)
        ?.proposedPlans.find(plan => plan.id === sourceProposedPlan.planId)
      if (sourcePlan) {
        return toLatestProposedPlanState(sourcePlan)
      }
    }
  }

  return findLatestProposedPlan(activeThreadPlans, input.latestTurn?.turnId ?? null)
}

export function hasActionableProposedPlan(
  proposedPlan: LatestProposedPlanState | Pick<ProposedPlan, 'implementedAt'> | null
): boolean {
  return proposedPlan !== null && proposedPlan.implementedAt === null
}

function toLatestProposedPlanState(proposedPlan: ProposedPlan): LatestProposedPlanState {
  return {
    id: proposedPlan.id,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
  }
}
