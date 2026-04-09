import {
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type ToolLifecycleItemType,
  type TurnId,
} from '@orxa-code/contracts'

import { isOpencodeStartupTelemetryActivity } from './opencodeStartupTelemetry'
import type { ChatMessage, ProposedPlan, TurnDiffSummary } from './types'

export interface WorkLogEntry {
  id: string
  createdAt: string
  label: string
  detail?: string
  command?: string
  changedFiles?: ReadonlyArray<string>
  tone: 'thinking' | 'tool' | 'info' | 'error'
  toolTitle?: string
  itemType?: ToolLifecycleItemType
  requestKind?: 'command' | 'file-read' | 'file-change'
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity['kind']
  collapseKey?: string
}

export type TimelineEntry =
  | {
      id: string
      kind: 'message'
      createdAt: string
      message: ChatMessage
    }
  | {
      id: string
      kind: 'proposed-plan'
      createdAt: string
      proposedPlan: ProposedPlan
    }
  | {
      id: string
      kind: 'work'
      createdAt: string
      entry: WorkLogEntry
    }

function toWorkLogEntry(entry: DerivedWorkLogEntry): WorkLogEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    label: entry.label,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    ...(entry.command !== undefined ? { command: entry.command } : {}),
    ...(entry.changedFiles !== undefined ? { changedFiles: entry.changedFiles } : {}),
    tone: entry.tone,
    ...(entry.toolTitle !== undefined ? { toolTitle: entry.toolTitle } : {}),
    ...(entry.itemType !== undefined ? { itemType: entry.itemType } : {}),
    ...(entry.requestKind !== undefined ? { requestKind: entry.requestKind } : {}),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCommandValue(value: unknown): string | null {
  const direct = asTrimmedString(value)
  if (direct) {
    return direct
  }
  if (!Array.isArray(value)) {
    return null
  }
  const parts = value
    .map(entry => asTrimmedString(entry))
    .filter((entry): entry is string => entry !== null)
  return parts.length > 0 ? parts.join(' ') : null
}

function requestKindFromRequestType(requestType: unknown): WorkLogEntry['requestKind'] | undefined {
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
      return undefined
  }
}

function extractToolCommand(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data)
  const item = asRecord(data?.item)
  const itemResult = asRecord(item?.result)
  const itemInput = asRecord(item?.input)
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(data?.command),
  ]
  return candidates.find(candidate => candidate !== null) ?? null
}

function extractToolTitle(payload: Record<string, unknown> | null): string | null {
  return asTrimmedString(payload?.title)
}

function stripTrailingExitCode(value: string): {
  output: string | null
  exitCode?: number | undefined
} {
  const trimmed = value.trim()
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(trimmed)
  if (!match?.groups) {
    return {
      output: trimmed.length > 0 ? trimmed : null,
    }
  }
  const exitCode = Number.parseInt(match.groups.code ?? '', 10)
  const normalizedOutput = match.groups.output?.trim() ?? ''
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  }
}

function extractWorkLogItemType(
  payload: Record<string, unknown> | null
): WorkLogEntry['itemType'] | undefined {
  if (typeof payload?.itemType === 'string' && isToolLifecycleItemType(payload.itemType)) {
    return payload.itemType
  }
  return undefined
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null
): WorkLogEntry['requestKind'] | undefined {
  if (
    payload?.requestKind === 'command' ||
    payload?.requestKind === 'file-read' ||
    payload?.requestKind === 'file-change'
  ) {
    return payload.requestKind
  }
  return requestKindFromRequestType(payload?.requestType)
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown) {
  const normalized = asTrimmedString(value)
  if (!normalized || seen.has(normalized)) {
    return
  }
  seen.add(normalized)
  target.push(normalized)
}

function collectChangedFiles(value: unknown, target: string[], seen: Set<string>, depth: number) {
  if (depth > 4 || target.length >= 12) {
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1)
      if (target.length >= 12) {
        return
      }
    }
    return
  }

  const record = asRecord(value)
  if (!record) {
    return
  }

  pushChangedFile(target, seen, record.path)
  pushChangedFile(target, seen, record.filePath)
  pushChangedFile(target, seen, record.relativePath)
  pushChangedFile(target, seen, record.filename)
  pushChangedFile(target, seen, record.newPath)
  pushChangedFile(target, seen, record.oldPath)

  for (const nestedKey of [
    'item',
    'result',
    'input',
    'data',
    'changes',
    'files',
    'edits',
    'patch',
    'patches',
    'operations',
  ]) {
    if (!(nestedKey in record)) {
      continue
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1)
    if (target.length >= 12) {
      return
    }
  }
}

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const itemType = extractWorkLogItemType(payload)
  const requestKind = extractWorkLogRequestKind(payload)
  if (itemType !== 'file_change' && requestKind !== 'file-change') {
    return []
  }
  const changedFiles: string[] = []
  const seen = new Set<string>()
  collectChangedFiles(asRecord(payload?.data), changedFiles, seen, 0)
  return changedFiles
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== 'tool.updated' && activity.kind !== 'tool.completed') {
    return false
  }

  const payload = asRecord(activity.payload)
  return typeof payload?.detail === 'string' && payload.detail.startsWith('ExitPlanMode:')
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (entry.activityKind !== 'tool.updated' && entry.activityKind !== 'tool.completed') {
    return undefined
  }
  const normalizedLabel = (entry.toolTitle ?? entry.label)
    .replace(/\s+(?:complete|completed)\s*$/i, '')
    .trim()
  const detail = entry.detail?.trim() ?? ''
  const itemType = entry.itemType ?? ''
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined
  }
  return [itemType, normalizedLabel, detail].join('\u001f')
}

function toDerivedWorkLogEntry(activity: OrchestrationThreadActivity): DerivedWorkLogEntry {
  const payload = asRecord(activity.payload)
  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    label: activity.summary,
    tone: activity.tone === 'approval' ? 'info' : activity.tone,
    activityKind: activity.kind,
  }

  const detail =
    typeof payload?.detail === 'string' ? stripTrailingExitCode(payload.detail).output : null
  if (detail) {
    entry.detail = detail
  }

  const command = extractToolCommand(payload)
  if (command) {
    entry.command = command
  }
  const changedFiles = extractChangedFiles(payload)
  if (changedFiles.length > 0) {
    entry.changedFiles = changedFiles
  }
  const title = extractToolTitle(payload)
  if (title) {
    entry.toolTitle = title
  }
  const itemType = extractWorkLogItemType(payload)
  if (itemType) {
    entry.itemType = itemType
  }
  const requestKind = extractWorkLogRequestKind(payload)
  if (requestKind) {
    entry.requestKind = requestKind
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry)
  if (collapseKey) {
    entry.collapseKey = collapseKey
  }
  return entry
}

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = []
  for (const entry of entries) {
    const previous = collapsed.at(-1)
    if (
      previous &&
      previous.activityKind !== 'tool.completed' &&
      (previous.activityKind === 'tool.updated' || previous.activityKind === 'tool.completed') &&
      (entry.activityKind === 'tool.updated' || entry.activityKind === 'tool.completed') &&
      previous.collapseKey !== undefined &&
      previous.collapseKey === entry.collapseKey
    ) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry)
      continue
    }
    collapsed.push(entry)
  }
  return collapsed
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry
): DerivedWorkLogEntry {
  const changedFiles = [
    ...new Set([...(previous.changedFiles ?? []), ...(next.changedFiles ?? [])]),
  ]
  const merged: DerivedWorkLogEntry = {
    ...previous,
    ...next,
  }

  const detail = next.detail ?? previous.detail
  if (detail) {
    merged.detail = detail
  }

  const command = next.command ?? previous.command
  if (command) {
    merged.command = command
  }

  if (changedFiles.length > 0) {
    merged.changedFiles = changedFiles
  }

  const toolTitle = next.toolTitle ?? previous.toolTitle
  if (toolTitle) {
    merged.toolTitle = toolTitle
  }

  const itemType = next.itemType ?? previous.itemType
  if (itemType) {
    merged.itemType = itemType
  }

  const requestKind = next.requestKind ?? previous.requestKind
  if (requestKind) {
    merged.requestKind = requestKind
  }

  const collapseKey = next.collapseKey ?? previous.collapseKey
  if (collapseKey) {
    merged.collapseKey = collapseKey
  }

  return merged
}

export function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity
): number {
  if (
    left.sequence !== undefined &&
    right.sequence !== undefined &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence
  }
  if (left.sequence !== undefined && right.sequence === undefined) {
    return 1
  }
  if (left.sequence === undefined && right.sequence !== undefined) {
    return -1
  }

  const createdAtComparison = left.createdAt.localeCompare(right.createdAt)
  if (createdAtComparison !== 0) {
    return createdAtComparison
  }

  const lifecycleRankComparison =
    compareActivityLifecycleRank(left.kind) - compareActivityLifecycleRank(right.kind)
  if (lifecycleRankComparison !== 0) {
    return lifecycleRankComparison
  }

  return left.id.localeCompare(right.id)
}

function compareActivityLifecycleRank(kind: string): number {
  if (kind.endsWith('.started') || kind === 'tool.started') {
    return 0
  }
  if (kind.endsWith('.progress') || kind.endsWith('.updated')) {
    return 1
  }
  if (kind.endsWith('.completed') || kind.endsWith('.resolved')) {
    return 2
  }
  return 1
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): WorkLogEntry[] {
  const entries = [...activities]
    .toSorted(compareActivitiesByOrder)
    .filter(activity => (latestTurnId ? activity.turnId === latestTurnId : true))
    .filter(activity => activity.kind !== 'tool.started')
    .filter(activity => activity.kind !== 'task.started' && activity.kind !== 'task.completed')
    .filter(activity => activity.kind !== 'context-window.updated')
    .filter(activity => activity.summary !== 'Checkpoint captured')
    .filter(activity => !isOpencodeStartupTelemetryActivity(activity))
    .filter(activity => !isPlanBoundaryToolActivity(activity))
    .map(toDerivedWorkLogEntry)
  return collapseDerivedWorkLogEntries(entries).map(toWorkLogEntry)
}

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[]
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map(message => ({
    id: message.id,
    kind: 'message',
    createdAt: message.createdAt,
    message,
  }))
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map(proposedPlan => ({
    id: proposedPlan.id,
    kind: 'proposed-plan',
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }))
  const workRows: TimelineEntry[] = workEntries.map(entry => ({
    id: entry.id,
    kind: 'work',
    createdAt: entry.createdAt,
    entry,
  }))
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
}

export function deriveCompletionDividerBeforeEntryId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestTurn: Pick<
    OrchestrationLatestTurn,
    'assistantMessageId' | 'startedAt' | 'completedAt'
  > | null
): string | null {
  if (!latestTurn?.startedAt || !latestTurn.completedAt) {
    return null
  }

  if (latestTurn.assistantMessageId) {
    const exactMatch = timelineEntries.find(
      timelineEntry =>
        timelineEntry.kind === 'message' &&
        timelineEntry.message.role === 'assistant' &&
        timelineEntry.message.id === latestTurn.assistantMessageId
    )
    if (exactMatch) {
      return exactMatch.id
    }
  }

  const turnStartedAt = Date.parse(latestTurn.startedAt)
  const turnCompletedAt = Date.parse(latestTurn.completedAt)
  if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
    return null
  }

  let inRangeMatch: string | null = null
  let fallbackMatch: string | null = null
  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== 'message' || timelineEntry.message.role !== 'assistant') {
      continue
    }
    const messageAt = Date.parse(timelineEntry.message.createdAt)
    if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
      continue
    }
    fallbackMatch = timelineEntry.id
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = timelineEntry.id
    }
  }
  return inRangeMatch ?? fallbackMatch
}

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[]
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt))
  const result: Record<TurnId, number> = {}
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index]
    if (!summary) continue
    result[summary.turnId] = index + 1
  }
  return result
}
