import {
  isToolLifecycleItemType,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  type ToolFilePatch,
  type ToolLifecycleAction,
  type ToolLifecycleItemType,
  type TurnId,
} from '@orxa-code/contracts'
import { asObjectRecord, asTrimmedString } from '@orxa-code/shared/records'

import { isOpencodeStartupTelemetryActivity } from './opencodeStartupTelemetry'
import { extractFilePatches } from './session-logic.filePatches'
import { isFileActionKind, resolveEffectivePathAction } from './session-logic.perPathActions'
import {
  deriveSubagentToolLifecycleCollapseKey,
  isVisibleSubagentToolStartActivity,
} from './session-logic.subagentWorklog'
import { extractWorkLogAction, fallbackWorkLogAction } from './session-logic.workAction'
import {
  extractChangedFilesFromCommand,
  extractChangedFilesFromPayload,
} from './session-logic.workLogChangedFiles'
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
  action?: ToolLifecycleAction
  perPathActions?: Readonly<Record<string, ToolLifecycleAction>>
  filePatches?: ReadonlyArray<ToolFilePatch>
}

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity['kind']
  collapseKey?: string
}

function annotateEntriesWithPerPathActions(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
  initialWrittenPaths: ReadonlySet<string>
): DerivedWorkLogEntry[] {
  const writtenPaths = new Set(initialWrittenPaths)
  return entries.map(entry => {
    const { action, changedFiles } = entry
    if (!action || !isFileActionKind(action) || !changedFiles || changedFiles.length === 0) {
      return entry
    }
    const perPathActions: Record<string, ToolLifecycleAction> = {}
    for (const path of changedFiles) {
      perPathActions[path] = resolveEffectivePathAction(action, path, writtenPaths)
    }
    return { ...entry, perPathActions }
  })
}

export type TimelineEntry =
  | { id: string; kind: 'message'; createdAt: string; message: ChatMessage }
  | { id: string; kind: 'proposed-plan'; createdAt: string; proposedPlan: ProposedPlan }
  | { id: string; kind: 'work'; createdAt: string; entry: WorkLogEntry }

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
    ...(entry.action !== undefined ? { action: entry.action } : {}),
    ...(entry.perPathActions !== undefined ? { perPathActions: entry.perPathActions } : {}),
    ...(entry.filePatches !== undefined ? { filePatches: entry.filePatches } : {}),
  }
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
  const data = asObjectRecord(payload?.data)
  const item = asObjectRecord(data?.item)
  const itemResult = asObjectRecord(item?.result)
  const itemInput = asObjectRecord(item?.input)
  const dataInput = asObjectRecord(data?.input)
  const candidates = [
    normalizeCommandValue(item?.command),
    normalizeCommandValue(itemInput?.command),
    normalizeCommandValue(itemResult?.command),
    normalizeCommandValue(dataInput?.command),
    normalizeCommandValue(dataInput?.cmd),
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

function extractChangedFiles(payload: Record<string, unknown> | null): string[] {
  const itemType = extractWorkLogItemType(payload)
  const requestKind = extractWorkLogRequestKind(payload)
  const isFileChange = itemType === 'file_change' || requestKind === 'file-change'
  return extractChangedFilesFromPayload(payload, isFileChange)
}

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== 'tool.updated' && activity.kind !== 'tool.completed') {
    return false
  }

  const payload = asObjectRecord(activity.payload)
  return typeof payload?.detail === 'string' && payload.detail.startsWith('ExitPlanMode:')
}

function deriveToolLifecycleCollapseKey(
  entry: DerivedWorkLogEntry,
  payload: Record<string, unknown> | null
): string | undefined {
  const subagentKey = deriveSubagentToolLifecycleCollapseKey(entry, payload)
  const isCollapsibleStarted = subagentKey !== undefined && entry.activityKind === 'tool.started'
  if (
    !isCollapsibleStarted &&
    entry.activityKind !== 'tool.updated' &&
    entry.activityKind !== 'tool.completed'
  ) {
    return undefined
  }
  if (subagentKey) {
    return subagentKey
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
  const payload = asObjectRecord(activity.payload)
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
  const action = extractWorkLogAction(payload) ?? fallbackWorkLogAction(itemType, title, command)
  if (action) {
    entry.action = action === 'create' ? 'edit' : action
  }
  if (!entry.changedFiles && command && isFileActionKind(action)) {
    const commandFiles = extractChangedFilesFromCommand(command)
    if (commandFiles.length > 0) {
      entry.changedFiles = commandFiles
    }
  }
  const filePatches = extractFilePatches(payload)
  if (filePatches.length > 0) {
    entry.filePatches = filePatches
  }
  const collapseKey = deriveToolLifecycleCollapseKey(entry, payload)
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
    const previousIsCollapsible =
      previous?.activityKind === 'tool.updated' ||
      previous?.activityKind === 'tool.completed' ||
      (previous?.activityKind === 'tool.started' && previous?.itemType === 'collab_agent_tool_call')
    const entryIsCollapsible =
      entry.activityKind === 'tool.updated' ||
      entry.activityKind === 'tool.completed' ||
      (entry.activityKind === 'tool.started' && entry.itemType === 'collab_agent_tool_call')
    if (
      previous &&
      previous.activityKind !== 'tool.completed' &&
      previousIsCollapsible &&
      entryIsCollapsible &&
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

const MERGE_PREFER_NEXT_KEYS = [
  'detail',
  'command',
  'toolTitle',
  'itemType',
  'requestKind',
  'action',
  'collapseKey',
] as const satisfies ReadonlyArray<keyof DerivedWorkLogEntry>

function assignPreferredField<K extends (typeof MERGE_PREFER_NEXT_KEYS)[number]>(
  target: DerivedWorkLogEntry,
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
  key: K
) {
  const value = next[key] ?? previous[key]
  if (value) {
    ;(target as unknown as Record<string, unknown>)[key] = value
  }
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry
): DerivedWorkLogEntry {
  const merged: DerivedWorkLogEntry = { ...previous, ...next }
  for (const key of MERGE_PREFER_NEXT_KEYS) {
    assignPreferredField(merged, previous, next, key)
  }
  const changedFiles = [
    ...new Set([...(previous.changedFiles ?? []), ...(next.changedFiles ?? [])]),
  ]
  if (changedFiles.length > 0) merged.changedFiles = changedFiles
  const mergedFilePatches = [...(previous.filePatches ?? []), ...(next.filePatches ?? [])]
  if (mergedFilePatches.length > 0) merged.filePatches = mergedFilePatches
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

function collectPriorTurnWrittenPaths(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): Set<string> {
  const writtenPaths = new Set<string>()
  if (!latestTurnId) return writtenPaths
  for (const activity of [...activities].toSorted(compareActivitiesByOrder)) {
    if (activity.turnId === latestTurnId) break
    if (activity.kind !== 'tool.completed' || isPlanBoundaryToolActivity(activity)) continue
    const { action, changedFiles } = toDerivedWorkLogEntry(activity)
    if (!action || !isFileActionKind(action) || !changedFiles?.length) continue
    for (const path of changedFiles) {
      if (action === 'delete') writtenPaths.delete(path)
      else writtenPaths.add(path)
    }
  }
  return writtenPaths
}

function isDisplayableWorkActivity(
  activity: OrchestrationThreadActivity,
  latestTurnId: TurnId | undefined
): boolean {
  if (latestTurnId && activity.turnId !== latestTurnId) return false
  if (activity.kind === 'tool.started' && !isVisibleSubagentToolStartActivity(activity))
    return false
  if (activity.kind === 'task.started' || activity.kind === 'task.completed') return false
  if (activity.kind === 'context-window.updated') return false
  if (activity.summary === 'Checkpoint captured') return false
  if (isOpencodeStartupTelemetryActivity(activity)) return false
  if (isPlanBoundaryToolActivity(activity)) return false
  return true
}

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurnId: TurnId | undefined
): WorkLogEntry[] {
  const priorWrittenPaths = collectPriorTurnWrittenPaths(activities, latestTurnId)
  const entries = [...activities]
    .toSorted(compareActivitiesByOrder)
    .filter(activity => isDisplayableWorkActivity(activity, latestTurnId))
    .map(toDerivedWorkLogEntry)
  const collapsed = collapseDerivedWorkLogEntries(entries)
  return annotateEntriesWithPerPathActions(collapsed, priorWrittenPaths).map(toWorkLogEntry)
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
