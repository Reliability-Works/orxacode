import type {
  OrchestrationSessionStatus,
  OrchestrationLatestTurn,
  OrchestrationLatestTurnState,
  OrchestrationProposedPlanId,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'

import { compareActivitiesByOrder } from './session-logic.activity'
import type { ChatMessage, ProposedPlan, Thread } from './types'

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

function cleanPlanStepText(step: string): string {
  return step
    .replace(/^`?\[(?:[^\]]+)\]`?\s*/i, '')
    .replace(/^`?(?:in\s+progress|in_progress|pending|completed|complete|done)`?\s*:\s*/i, '')
    .replace(
      /\s*:\s*`?(?:in\s+progress|in_progress|pending|queued|completed|complete|done)`?\s*$/i,
      ''
    )
    .replace(
      /\s+`?(?:in\s+progress|in_progress|pending|queued|completed|complete|done)`?\.?\s*$/i,
      ''
    )
    .trim()
}

function normalizePlanStepStatus(
  raw: string | null | undefined
): 'pending' | 'inProgress' | 'completed' {
  switch (raw?.trim().toLowerCase()) {
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed'
    case 'in_progress':
    case 'in-progress':
    case 'in progress':
    case 'inprogress':
    case 'active':
    case 'working':
      return 'inProgress'
    case 'queued':
    default:
      return 'pending'
  }
}

function toPausedStatus(status: ActivePlanState['steps'][number]['status']) {
  return status === 'inProgress' ? 'paused' : status
}

function findNextActionableStepIndex(steps: ReadonlyArray<ActivePlanStep>): number {
  const pendingIndex = steps.findIndex(step => step.status === 'pending')
  if (pendingIndex >= 0) {
    return pendingIndex
  }
  return -1
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

type ParsedTaskListStep = {
  step: string
  status: 'pending' | 'inProgress' | 'paused' | 'completed'
}

function parseBracketedStatusLine(line: string): ParsedTaskListStep | null {
  const match = line.match(/^(?:[-*•]|\d+\.)\s+\[(?<status>[^\]]+)\]\s+(?<step>.+)$/)
  if (!match?.groups?.step) {
    return null
  }
  return {
    step: cleanPlanStepText(match.groups.step),
    status: normalizePlanStepStatus(match.groups.status),
  }
}

function parseCheckboxStatusLine(line: string): ParsedTaskListStep | null {
  const match = line.match(/^(?:[-*•]|\d+\.)\s+\[(?<checked>[ xX])\]\s+(?<step>.+)$/)
  if (!match?.groups?.step) {
    return null
  }
  const checked = match.groups.checked ?? ''
  return {
    step: cleanPlanStepText(match.groups.step),
    status: checked.trim().length > 0 ? 'completed' : 'pending',
  }
}

function parseStatusPrefixLine(line: string): ParsedTaskListStep | null {
  const match = line.match(
    /^(?:[-*•]|\d+\.)\s+(?<status>in\s+progress|pending|queued|completed|complete|done)\s*:\s+(?<step>.+)$/i
  )
  if (!match?.groups?.step) {
    return null
  }
  return {
    step: cleanPlanStepText(match.groups.step),
    status: normalizePlanStepStatus(match.groups.status),
  }
}

function parseStatusSuffixLine(line: string): ParsedTaskListStep | null {
  const match = line.match(
    /^(?:[-*•]|\d+\.)\s+(?<step>.+?)(?::\s*|\s+)(?<status>in\s+progress|pending|queued|completed|complete|done)\.?$/i
  )
  if (!match?.groups?.step) {
    return null
  }
  return {
    step: cleanPlanStepText(match.groups.step),
    status: normalizePlanStepStatus(match.groups.status),
  }
}

function parsePlainTaskLine(line: string): ParsedTaskListStep | null {
  const match = line.match(/^(?:[-*•]|\d+\.)\s+(?<step>.+)$/)
  if (!match?.groups?.step) {
    return null
  }
  return {
    step: cleanPlanStepText(match.groups.step),
    status: 'pending',
  }
}

function parseTaskListLine(
  line: string
): { step: ParsedTaskListStep; explicitStatus: boolean } | null {
  const bracketed = parseBracketedStatusLine(line)
  if (bracketed) {
    return { step: bracketed, explicitStatus: true }
  }
  const checkbox = parseCheckboxStatusLine(line)
  if (checkbox) {
    return { step: checkbox, explicitStatus: true }
  }
  const prefixed = parseStatusPrefixLine(line)
  if (prefixed) {
    return { step: prefixed, explicitStatus: true }
  }
  const suffixed = parseStatusSuffixLine(line)
  if (suffixed) {
    return { step: suffixed, explicitStatus: true }
  }
  const plain = parsePlainTaskLine(line)
  if (plain) {
    return { step: plain, explicitStatus: false }
  }
  return null
}

function inferActiveStepIndex(text: string, stepCount: number): number {
  const match = text.match(/\b(?:i['’]?m|currently)\s+on\s+step\s+(?<step>\d+)\b/i)
  const index = match?.groups?.step ? Number.parseInt(match.groups.step, 10) - 1 : -1
  return Number.isFinite(index) && index >= 0 && index < stepCount ? index : -1
}

function applyImplicitTaskStatuses(
  steps: ParsedTaskListStep[],
  text: string
): ParsedTaskListStep[] {
  const activeStepIndex = inferActiveStepIndex(text, steps.length)
  if (activeStepIndex < 0) {
    return steps
  }
  return steps.map((step, index) => ({
    ...step,
    status:
      index === activeStepIndex ? 'inProgress' : index < activeStepIndex ? 'completed' : 'pending',
  }))
}

function collectTaskListSteps(
  lines: string[],
  headingIndex: number
): {
  steps: ParsedTaskListStep[]
  sawExplicitStatus: boolean
  endIndexExclusive: number
} {
  const steps: ParsedTaskListStep[] = []
  let sawExplicitStatus = false
  let endIndexExclusive = headingIndex + 1

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (line.length === 0) {
      if (steps.length > 0) {
        endIndexExclusive = index
        break
      }
      continue
    }

    const parsed = parseTaskListLine(line)
    if (parsed) {
      steps.push(parsed.step)
      sawExplicitStatus ||= parsed.explicitStatus
      endIndexExclusive = index + 1
      continue
    }

    if (steps.length > 0) {
      endIndexExclusive = index
      break
    }
  }

  return { steps, sawExplicitStatus, endIndexExclusive }
}

function parseTextTaskListSteps(text: string): ParsedTaskListStep[] {
  const lines = text.split(/\r?\n/)
  const headingIndex = lines.findIndex(line =>
    /^\s*(task|todo)\s+list(?:\s+update)?\s*:\s*$/i.test(line)
  )
  if (headingIndex < 0) return []

  const collected = collectTaskListSteps(lines, headingIndex)
  if (!collected.sawExplicitStatus && collected.steps.length > 0) {
    return applyImplicitTaskStatuses(collected.steps, text)
  }
  return collected.steps
}

function normalizeStrippedTaskListWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '')
}

export function stripPromotedTaskListFromMessage(text: string): string {
  const lines = text.split(/\r?\n/)
  const headingIndex = lines.findIndex(line =>
    /^\s*(task|todo)\s+list(?:\s+update)?\s*:\s*$/i.test(line)
  )
  if (headingIndex < 0) {
    return text
  }
  const collected = collectTaskListSteps(lines, headingIndex)
  if (collected.steps.length === 0) {
    return text
  }
  const strippedLines = [
    ...lines.slice(0, headingIndex),
    ...lines.slice(collected.endIndexExclusive),
  ]
  return normalizeStrippedTaskListWhitespace(strippedLines.join('\n'))
}

function findTaskListSourceMessage(params: {
  messages: ReadonlyArray<ChatMessage>
  latestTurnId: TurnId | undefined
  latestAssistantMessageId: string | null | undefined
}): ChatMessage | null {
  const assistantMessages = params.messages.filter(message => message.role === 'assistant')
  if (assistantMessages.length === 0) {
    return null
  }

  if (params.latestAssistantMessageId) {
    const exactMatch = assistantMessages.find(
      message => message.id === params.latestAssistantMessageId
    )
    if (exactMatch && parseTextTaskListSteps(exactMatch.text).length > 0) {
      return exactMatch
    }
  }

  if (params.latestTurnId) {
    const turnScopedMatch = assistantMessages
      .filter(message => message.turnId === params.latestTurnId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find(message => parseTextTaskListSteps(message.text).length > 0)
    if (turnScopedMatch) {
      return turnScopedMatch
    }
  }

  return (
    [...assistantMessages]
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
      .find(message => parseTextTaskListSteps(message.text).length > 0) ?? null
  )
}

function deriveTextualActivePlanState(params: {
  messages: ReadonlyArray<ChatMessage>
  latestTurnId: TurnId | undefined
  latestAssistantMessageId: string | null | undefined
}): ActivePlanState | null {
  const sourceMessage = findTaskListSourceMessage(params)
  if (!sourceMessage) {
    return null
  }
  const parsedSteps = parseTextTaskListSteps(sourceMessage.text)
  if (parsedSteps.length === 0) {
    return null
  }
  return {
    createdAt: sourceMessage.createdAt,
    turnId: sourceMessage.turnId ?? null,
    steps: parsedSteps,
  }
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
      if (!latestTurnId) {
        return true
      }
      return activity.turnId === latestTurnId
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
  if (isActivelyRunning) {
    return {
      ...activePlan,
      steps: inferRunningPlanSteps(activePlan.steps),
    }
  }
  return {
    ...activePlan,
    steps: inferPausedPlanSteps(activePlan.steps),
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
