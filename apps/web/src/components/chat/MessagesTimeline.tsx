import { type MessageId, type TurnId } from '@orxa-code/contracts'
import { type TimestampFormat } from '@orxa-code/contracts/settings'
import { useCallback, useMemo, useRef, useState } from 'react'
import { type VirtualItem } from '@tanstack/react-virtual'

import { deriveTimelineEntries } from '../../session-logic'
import { type TurnDiffSummary } from '../../types'
import { type ExpandedImagePreview } from './ExpandedImagePreview'
import { buildTimelineRows, type TimelineRow } from './MessagesTimeline.model'
import { TimelineRowContent, type SharedTimelineRowProps } from './MessagesTimeline.rows'
import { useTimelineRootWidth, useTimelineVirtualizerState } from './MessagesTimeline.virtualizer'

interface MessagesTimelineProps {
  hasMessages: boolean
  isWorking: boolean
  activeTurnInProgress: boolean
  activeTurnStartedAt: string | null
  scrollContainer: HTMLDivElement | null
  timelineEntries: ReturnType<typeof deriveTimelineEntries>
  completionDividerBeforeEntryId: string | null
  completionSummary: string | null
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>
  nowIso: string
  expandedWorkGroups: Record<string, boolean>
  onToggleWorkGroup: (groupId: string) => void
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void
  revertTurnCountByUserMessageId: Map<MessageId, number>
  onRevertUserMessage: (messageId: MessageId) => void
  isRevertingCheckpoint: boolean
  onImageExpand: (preview: ExpandedImagePreview) => void
  markdownCwd: string | undefined
  resolvedTheme: 'light' | 'dark'
  timestampFormat: TimestampFormat
  workspaceRoot: string | undefined
}

// SharedTimelineRowProps is defined in MessagesTimeline.rows and re-used here

function EmptyTimelineState() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground/30">Send a message to start the conversation.</p>
    </div>
  )
}

function TimelineRowRenderer(props: { row: TimelineRow } & SharedTimelineRowProps) {
  return <TimelineRowContent {...props} />
}

function buildSharedTimelineRowProps(
  props: MessagesTimelineProps,
  onTimelineImageLoad: () => void,
  allDirectoriesExpandedByTurnId: Record<string, boolean>,
  onToggleAllDirectories: (turnId: TurnId) => void
): SharedTimelineRowProps {
  return {
    completionSummary: props.completionSummary,
    expandedWorkGroups: props.expandedWorkGroups,
    onToggleWorkGroup: props.onToggleWorkGroup,
    revertTurnCountByUserMessageId: props.revertTurnCountByUserMessageId,
    onRevertUserMessage: props.onRevertUserMessage,
    isRevertingCheckpoint: props.isRevertingCheckpoint,
    isWorking: props.isWorking,
    onImageExpand: props.onImageExpand,
    onTimelineImageLoad,
    markdownCwd: props.markdownCwd,
    turnDiffSummaryByAssistantMessageId: props.turnDiffSummaryByAssistantMessageId,
    allDirectoriesExpandedByTurnId,
    onToggleAllDirectories,
    resolvedTheme: props.resolvedTheme,
    onOpenTurnDiff: props.onOpenTurnDiff,
    nowIso: props.nowIso,
    timestampFormat: props.timestampFormat,
    workspaceRoot: props.workspaceRoot,
  }
}

function VirtualizedTimelineRows(
  props: {
    rowVirtualizer: ReturnType<typeof useTimelineVirtualizerState>['rowVirtualizer']
    virtualRows: VirtualItem[]
    rows: TimelineRow[]
  } & SharedTimelineRowProps
) {
  return (
    <div className="relative" style={{ height: `${props.rowVirtualizer.getTotalSize()}px` }}>
      {props.virtualRows.map(virtualRow => {
        const row = props.rows[virtualRow.index]
        if (!row) return null
        return (
          <div
            key={`virtual-row:${row.id}`}
            data-index={virtualRow.index}
            ref={props.rowVirtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <TimelineRowRenderer row={row} {...props} />
          </div>
        )
      })}
    </div>
  )
}

export function MessagesTimeline(props: MessagesTimelineProps) {
  const timelineRootRef = useRef<HTMLDivElement | null>(null)
  const timelineWidthPx = useTimelineRootWidth({
    timelineRootRef,
    hasMessages: props.hasMessages,
    isWorking: props.isWorking,
  })
  const rows = useMemo(
    () =>
      buildTimelineRows({
        timelineEntries: props.timelineEntries,
        completionDividerBeforeEntryId: props.completionDividerBeforeEntryId,
        isWorking: props.isWorking,
        activeTurnStartedAt: props.activeTurnStartedAt,
      }),
    [
      props.timelineEntries,
      props.completionDividerBeforeEntryId,
      props.isWorking,
      props.activeTurnStartedAt,
    ]
  )
  const {
    rowVirtualizer,
    virtualizedRowCount,
    virtualRows,
    nonVirtualizedRows,
    onTimelineImageLoad,
  } = useTimelineVirtualizerState({
    rows,
    activeTurnInProgress: props.activeTurnInProgress,
    activeTurnStartedAt: props.activeTurnStartedAt,
    scrollContainer: props.scrollContainer,
    timelineWidthPx,
  })
  const [allDirectoriesExpandedByTurnId, setAllDirectoriesExpandedByTurnId] = useState<
    Record<string, boolean>
  >({})
  const onToggleAllDirectories = useCallback((turnId: TurnId) => {
    setAllDirectoriesExpandedByTurnId(current => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }))
  }, [])

  if (!props.hasMessages && !props.isWorking) {
    return <EmptyTimelineState />
  }

  const sharedRowProps = buildSharedTimelineRowProps(
    props,
    onTimelineImageLoad,
    allDirectoriesExpandedByTurnId,
    onToggleAllDirectories
  )

  return (
    <div
      ref={timelineRootRef}
      data-timeline-root="true"
      className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden"
    >
      {virtualizedRowCount > 0 && (
        <VirtualizedTimelineRows
          rowVirtualizer={rowVirtualizer}
          virtualRows={virtualRows}
          rows={rows}
          {...sharedRowProps}
        />
      )}
      {nonVirtualizedRows.map(row => (
        <div key={`non-virtual-row:${row.id}`}>
          <TimelineRowRenderer row={row} {...sharedRowProps} />
        </div>
      ))}
    </div>
  )
}
