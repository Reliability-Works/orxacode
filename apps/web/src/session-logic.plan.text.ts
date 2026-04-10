import type { TurnId } from '@orxa-code/contracts'

import type { ChatMessage } from './types'

export type ParsedTaskListStep = {
  step: string
  status: 'pending' | 'inProgress' | 'paused' | 'completed'
}

export interface TextualActivePlanState {
  createdAt: string
  turnId: TurnId | null
  steps: ParsedTaskListStep[]
}

export function cleanPlanStepText(step: string): string {
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

export function normalizePlanStepStatus(
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

export function parseTextTaskListSteps(text: string): ParsedTaskListStep[] {
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

export function deriveTextualActivePlanState(params: {
  messages: ReadonlyArray<ChatMessage>
  latestTurnId: TurnId | undefined
  latestAssistantMessageId: string | null | undefined
}): TextualActivePlanState | null {
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
