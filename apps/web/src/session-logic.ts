import {
  ApprovalRequestId,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type OrchestrationProposedPlanId,
  type ProviderKind,
  type UserInputQuestion,
  type ThreadId,
  type TurnId,
} from '@orxa-code/contracts'

import type { ProposedPlan, SessionPhase, Thread, ThreadSession } from './types'
import { compareActivitiesByOrder } from './session-logic.activity'
export {
  deriveCompletionDividerBeforeEntryId,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  inferCheckpointTurnCountByTurnId,
} from './session-logic.activity'
export type { TimelineEntry, WorkLogEntry } from './session-logic.activity'

export type ProviderPickerKind = ProviderKind | 'cursor'

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind
  label: string
  available: boolean
}> = [
  { value: 'codex', label: 'Codex', available: true },
  { value: 'claudeAgent', label: 'Claude', available: true },
  { value: 'opencode', label: 'Opencode', available: true },
  { value: 'cursor', label: 'Cursor', available: false },
]

export interface PendingApproval {
  requestId: ApprovalRequestId
  requestKind: 'command' | 'file-read' | 'file-change'
  createdAt: string
  detail?: string
}

export interface PendingUserInput {
  requestId: ApprovalRequestId
  createdAt: string
  questions: ReadonlyArray<UserInputQuestion>
}

export interface ActivePlanState {
  createdAt: string
  turnId: TurnId | null
  explanation?: string | null
  steps: Array<{
    step: string
    status: 'pending' | 'inProgress' | 'completed'
  }>
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

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0ms'
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)}s`
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1_000)
  if (seconds === 0) return `${minutes}m`
  if (seconds === 60) return `${minutes + 1}m`
  return `${minutes}m ${seconds}s`
}

export function formatElapsed(startIso: string, endIso: string | undefined): string | null {
  if (!endIso) return null
  const startedAt = Date.parse(startIso)
  const endedAt = Date.parse(endIso)
  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    return null
  }
  return formatDuration(endedAt - startedAt)
}

type LatestTurnTiming = Pick<OrchestrationLatestTurn, 'turnId' | 'startedAt' | 'completedAt'>
type SessionActivityState = Pick<ThreadSession, 'orchestrationStatus' | 'activeTurnId'>

export function isLatestTurnSettled(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null
): boolean {
  if (!latestTurn) return true
  if (!latestTurn?.startedAt) return false
  if (!latestTurn.completedAt) return false
  if (!session) return true
  if (session.orchestrationStatus === 'running') return false
  return true
}

export function deriveActiveWorkStartedAt(
  latestTurn: LatestTurnTiming | null,
  session: SessionActivityState | null,
  sendStartedAt: string | null
): string | null {
  if (!isLatestTurnSettled(latestTurn, session)) {
    return latestTurn?.startedAt ?? sendStartedAt
  }
  return sendStartedAt
}

function requestKindFromRequestType(requestType: unknown): PendingApproval['requestKind'] | null {
  switch (requestType) {
    case 'command_execution_approval':
    case 'exec_command_approval':
      return 'command'
    case 'file_read_approval':
      return 'file-read'
    case 'file_change_approval':
    case 'apply_patch_approval':
      return 'file-change'
    default:
      return null
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase()
  if (!normalized) {
    return false
  }
  return (
    normalized.includes('stale pending approval request') ||
    normalized.includes('stale pending user-input request') ||
    normalized.includes('unknown pending approval request') ||
    normalized.includes('unknown pending permission request') ||
    normalized.includes('unknown pending user-input request')
  )
}

function activityPayloadRecord(
  activity: OrchestrationThreadActivity
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === 'object'
    ? (activity.payload as Record<string, unknown>)
    : null
}

function approvalRequestIdFromPayload(
  payload: Record<string, unknown> | null
): ApprovalRequestId | null {
  return payload && typeof payload.requestId === 'string'
    ? ApprovalRequestId.makeUnsafe(payload.requestId)
    : null
}

function approvalRequestKindFromPayload(
  payload: Record<string, unknown> | null
): PendingApproval['requestKind'] | null {
  if (
    payload?.requestKind === 'command' ||
    payload?.requestKind === 'file-read' ||
    payload?.requestKind === 'file-change'
  ) {
    return payload.requestKind
  }
  return requestKindFromRequestType(payload?.requestType)
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>
): PendingApproval[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>()
  const ordered = [...activities].toSorted(compareActivitiesByOrder)

  for (const activity of ordered) {
    const payload = activityPayloadRecord(activity)
    const requestId = approvalRequestIdFromPayload(payload)
    const requestKind = approvalRequestKindFromPayload(payload)
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : undefined

    if (activity.kind === 'approval.requested' && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      })
      continue
    }

    if (activity.kind === 'approval.resolved' && requestId) {
      openByRequestId.delete(requestId)
      continue
    }

    if (
      activity.kind === 'provider.approval.respond.failed' &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId)
      continue
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions
  if (!Array.isArray(questions)) {
    return null
  }
  const parsed = questions
    .map<UserInputQuestion | null>(entry => {
      if (!entry || typeof entry !== 'object') return null
      const question = entry as Record<string, unknown>
      if (
        typeof question.id !== 'string' ||
        typeof question.header !== 'string' ||
        typeof question.question !== 'string' ||
        !Array.isArray(question.options)
      ) {
        return null
      }
      const options = question.options
        .map<UserInputQuestion['options'][number] | null>(option => {
          if (!option || typeof option !== 'object') return null
          const optionRecord = option as Record<string, unknown>
          if (
            typeof optionRecord.label !== 'string' ||
            typeof optionRecord.description !== 'string'
          ) {
            return null
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          }
        })
        .filter((option): option is UserInputQuestion['options'][number] => option !== null)
      if (options.length === 0) {
        return null
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
      }
    })
    .filter((question): question is UserInputQuestion => question !== null)
  return parsed.length > 0 ? parsed : null
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>
): PendingUserInput[] {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>()
  const ordered = [...activities].toSorted(compareActivitiesByOrder)

  for (const activity of ordered) {
    const payload = activityPayloadRecord(activity)
    const requestId = approvalRequestIdFromPayload(payload)
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : undefined

    if (activity.kind === 'user-input.requested' && requestId) {
      const questions = parseUserInputQuestions(payload)
      if (!questions) {
        continue
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      })
      continue
    }

    if (activity.kind === 'user-input.resolved' && requestId) {
      openByRequestId.delete(requestId)
      continue
    }

    if (
      activity.kind === 'provider.user-input.respond.failed' &&
      requestId &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId)
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )
}

export function deriveActivePlanState(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): ActivePlanState | null {
  const ordered = [...activities].toSorted(compareActivitiesByOrder)
  const candidates = ordered.filter(activity => {
    if (activity.kind !== 'turn.plan.updated') {
      return false
    }
    if (!latestTurnId) {
      return true
    }
    return activity.turnId === latestTurnId
  })
  const latest = candidates.at(-1)
  if (!latest) {
    return null
  }
  const payload =
    latest.payload && typeof latest.payload === 'object'
      ? (latest.payload as Record<string, unknown>)
      : null
  const rawPlan = payload?.plan
  if (!Array.isArray(rawPlan)) {
    return null
  }
  const steps = rawPlan
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      if (typeof record.step !== 'string') {
        return null
      }
      const status =
        record.status === 'completed' || record.status === 'inProgress' ? record.status : 'pending'
      return {
        step: record.step,
        status,
      }
    })
    .filter(
      (
        step
      ): step is {
        step: string
        status: 'pending' | 'inProgress' | 'completed'
      } => step !== null
    )
  if (steps.length === 0) {
    return null
  }
  return {
    createdAt: latest.createdAt,
    turnId: latest.turnId,
    ...(payload && 'explanation' in payload
      ? { explanation: payload.explanation as string | null }
      : {}),
    steps,
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
  if (!latestPlan) {
    return null
  }

  return toLatestProposedPlanState(latestPlan)
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

export function hasToolActivityForTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined
): boolean {
  if (!turnId) return false
  return activities.some(activity => activity.turnId === turnId && activity.tone === 'tool')
}

export function derivePhase(session: ThreadSession | null): SessionPhase {
  if (!session || session.status === 'closed') return 'disconnected'
  if (session.status === 'connecting') return 'connecting'
  if (session.status === 'running') return 'running'
  return 'ready'
}
