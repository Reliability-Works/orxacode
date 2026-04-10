import type { OrchestrationThreadActivity, TurnId } from '@orxa-code/contracts'

import { compareActivitiesByOrder } from './session-logic.activity'
import type { ActivePlanState } from './session-logic.plan'

type ParsedTaskListStep = ActivePlanState['steps'][number]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

function normalizePlanStepStatus(raw: string | null | undefined): ParsedTaskListStep['status'] {
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
    default:
      return 'pending'
  }
}

function parseToolTodoStatus(value: unknown): ParsedTaskListStep['status'] {
  if (value === true) {
    return 'completed'
  }
  if (value === false || value === null || value === undefined) {
    return 'pending'
  }
  return normalizePlanStepStatus(typeof value === 'string' ? value : undefined)
}

function parseToolTodoStep(todo: unknown): ParsedTaskListStep | null {
  if (typeof todo === 'string') {
    const step = cleanPlanStepText(todo)
    return step.length > 0 ? { step, status: 'pending' } : null
  }

  const record = asRecord(todo)
  if (!record) {
    return null
  }

  const step =
    asTrimmedString(record.content) ??
    asTrimmedString(record.text) ??
    asTrimmedString(record.task) ??
    asTrimmedString(record.step) ??
    asTrimmedString(record.title) ??
    asTrimmedString(record.description)

  if (!step) {
    return null
  }

  return {
    step: cleanPlanStepText(step),
    status: parseToolTodoStatus(
      record.status ?? record.state ?? record.completed ?? record.checked
    ),
  }
}

function toPlanPayloadRecord(
  activity: OrchestrationThreadActivity
): Record<string, unknown> | null {
  return activity.payload && typeof activity.payload === 'object'
    ? (activity.payload as Record<string, unknown>)
    : null
}

function readToolTodoEntriesFromPayload(payload: Record<string, unknown> | null): unknown[] {
  const data = asRecord(payload?.data)
  const candidateContainers = [
    asRecord(data?.input),
    asRecord(data?.item),
    asRecord(data?.result),
    data,
  ].filter((value): value is Record<string, unknown> => value !== null)

  for (const container of candidateContainers) {
    if (Array.isArray(container.todos)) {
      return container.todos
    }
  }

  return []
}

function parseToolTodoSteps(payload: Record<string, unknown> | null): ParsedTaskListStep[] {
  return readToolTodoEntriesFromPayload(payload)
    .map(entry => parseToolTodoStep(entry))
    .filter((step): step is ParsedTaskListStep => step !== null)
}

function isTodoToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (
    activity.kind !== 'tool.started' &&
    activity.kind !== 'tool.updated' &&
    activity.kind !== 'tool.completed'
  ) {
    return false
  }
  return parseToolTodoSteps(toPlanPayloadRecord(activity)).length > 0
}

function findLatestTodoToolActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): OrchestrationThreadActivity | undefined {
  const ordered = [...activities].toSorted(compareActivitiesByOrder)
  const latestForTurn = ordered
    .filter(
      activity =>
        (!latestTurnId || activity.turnId === latestTurnId) && isTodoToolActivity(activity)
    )
    .at(-1)

  if (latestForTurn) {
    return latestForTurn
  }

  return [...ordered].reverse().find(activity => isTodoToolActivity(activity))
}

export function deriveActivePlanFromTodoToolActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): ActivePlanState | null {
  const activity = findLatestTodoToolActivity(activities, latestTurnId)
  if (!activity) {
    return null
  }
  const steps = parseToolTodoSteps(toPlanPayloadRecord(activity))
  if (steps.length === 0) {
    return null
  }
  return {
    createdAt: activity.createdAt,
    turnId: activity.turnId,
    steps,
  }
}
