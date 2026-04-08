import { computeMessageDurationStart } from './MessagesTimeline.logic'
import { type deriveTimelineEntries } from '../../session-logic'

export const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8

export type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number]
export type TimelineMessage = Extract<TimelineEntry, { kind: 'message' }>['message']
export type TimelineProposedPlan = Extract<TimelineEntry, { kind: 'proposed-plan' }>['proposedPlan']
export type TimelineWorkEntry = Extract<TimelineEntry, { kind: 'work' }>['entry']
export type TimelineRow =
  | {
      kind: 'work'
      id: string
      createdAt: string
      groupedEntries: TimelineWorkEntry[]
    }
  | {
      kind: 'message'
      id: string
      createdAt: string
      message: TimelineMessage
      durationStart: string
      showCompletionDivider: boolean
    }
  | {
      kind: 'proposed-plan'
      id: string
      createdAt: string
      proposedPlan: TimelineProposedPlan
    }
  | { kind: 'working'; id: string; createdAt: string | null }

export function estimateTimelineProposedPlanHeight(proposedPlan: TimelineProposedPlan): number {
  const estimatedLines = Math.max(1, Math.ceil(proposedPlan.planMarkdown.length / 72))
  return 120 + Math.min(estimatedLines * 22, 880)
}

export function buildTimelineRows({
  timelineEntries,
  completionDividerBeforeEntryId,
  isWorking,
  activeTurnStartedAt,
}: {
  timelineEntries: ReturnType<typeof deriveTimelineEntries>
  completionDividerBeforeEntryId: string | null
  isWorking: boolean
  activeTurnStartedAt: string | null
}): TimelineRow[] {
  const nextRows: TimelineRow[] = []
  const durationStartByMessageId = computeMessageDurationStart(
    timelineEntries.flatMap(entry => (entry.kind === 'message' ? [entry.message] : []))
  )

  for (let index = 0; index < timelineEntries.length; index += 1) {
    const timelineEntry = timelineEntries[index]
    if (!timelineEntry) continue

    if (timelineEntry.kind === 'work') {
      const groupedEntries = [timelineEntry.entry]
      let cursor = index + 1
      while (cursor < timelineEntries.length) {
        const nextEntry = timelineEntries[cursor]
        if (!nextEntry || nextEntry.kind !== 'work') break
        groupedEntries.push(nextEntry.entry)
        cursor += 1
      }
      nextRows.push({
        kind: 'work',
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      })
      index = cursor - 1
      continue
    }

    if (timelineEntry.kind === 'proposed-plan') {
      nextRows.push({
        kind: 'proposed-plan',
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      })
      continue
    }

    nextRows.push({
      kind: 'message',
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart:
        durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt,
      showCompletionDivider:
        timelineEntry.message.role === 'assistant' &&
        completionDividerBeforeEntryId === timelineEntry.id,
    })
  }

  if (isWorking) {
    nextRows.push({
      kind: 'working',
      id: 'working-indicator-row',
      createdAt: activeTurnStartedAt,
    })
  }

  return nextRows
}

export function getFirstUnvirtualizedRowIndex({
  rows,
  activeTurnInProgress,
  activeTurnStartedAt,
  alwaysUnvirtualizedTailRows,
}: {
  rows: TimelineRow[]
  activeTurnInProgress: boolean
  activeTurnStartedAt: string | null
  alwaysUnvirtualizedTailRows: number
}) {
  const firstTailRowIndex = Math.max(rows.length - alwaysUnvirtualizedTailRows, 0)
  if (!activeTurnInProgress) return firstTailRowIndex

  const turnStartedAtMs =
    typeof activeTurnStartedAt === 'string' ? Date.parse(activeTurnStartedAt) : Number.NaN
  let firstCurrentTurnRowIndex = -1
  if (!Number.isNaN(turnStartedAtMs)) {
    firstCurrentTurnRowIndex = rows.findIndex(row => {
      if (row.kind === 'working') return true
      if (!row.createdAt) return false
      const rowCreatedAtMs = Date.parse(row.createdAt)
      return !Number.isNaN(rowCreatedAtMs) && rowCreatedAtMs >= turnStartedAtMs
    })
  }

  if (firstCurrentTurnRowIndex < 0) {
    firstCurrentTurnRowIndex = rows.findIndex(
      row => row.kind === 'message' && row.message.streaming
    )
  }

  if (firstCurrentTurnRowIndex < 0) return firstTailRowIndex

  for (let index = firstCurrentTurnRowIndex - 1; index >= 0; index -= 1) {
    const previousRow = rows[index]
    if (!previousRow || previousRow.kind !== 'message') continue
    if (previousRow.message.role === 'user') {
      return Math.min(index, firstTailRowIndex)
    }
    if (previousRow.message.role === 'assistant' && !previousRow.message.streaming) {
      break
    }
  }

  return Math.min(firstCurrentTurnRowIndex, firstTailRowIndex)
}
