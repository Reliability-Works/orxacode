import { type MessageId, type ThreadId, type TurnId } from '@orxa-code/contracts'
import { type TimestampFormat } from '@orxa-code/contracts/settings'
import { Undo2Icon } from 'lucide-react'

import { formatElapsed } from '../../session-logic'
import { stripPromotedTaskListFromMessage } from '../../session-logic.plan'
import { type TurnDiffSummary } from '../../types'
import { summarizeTurnDiffStats } from '../../lib/turnDiffTree'
import { formatTimestamp } from '../../timestampFormat'
import ChatMarkdown from '../ChatMarkdown'
import { Button } from '../ui/button'
import { ChangedFilesTree } from './ChangedFilesTree'
import { DiffStatLabel } from './DiffStatLabel'
import { hasNonZeroStat } from './DiffStatLabel.logic'
import { buildExpandedImagePreview, type ExpandedImagePreview } from './ExpandedImagePreview'
import { MessageCopyButton } from './MessageCopyButton'
import { type TimelineMessage, type TimelineRow } from './MessagesTimeline.model'
import { ProposedPlanCard } from './ProposedPlanCard'
import { UserMessageBody } from './MessagesTimeline.user'
import { SimpleWorkEntryRow } from './MessagesTimeline.work'
import { deriveDisplayedUserMessageState } from '~/lib/terminalContext'

const MAX_VISIBLE_WORK_LOG_ENTRIES = 6

export type SharedTimelineRowProps = {
  expandedWorkGroups: Record<string, boolean>
  onToggleWorkGroup: (groupId: string) => void
  revertTurnCountByUserMessageId: Map<MessageId, number>
  onRevertUserMessage: (messageId: MessageId) => void
  isRevertingCheckpoint: boolean
  isWorking: boolean
  onImageExpand: (preview: ExpandedImagePreview) => void
  onTimelineImageLoad: () => void
  completionSummary: string | null
  markdownCwd: string | undefined
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>
  allDirectoriesExpandedByTurnId: Record<string, boolean>
  onToggleAllDirectories: (turnId: TurnId) => void
  resolvedTheme: 'light' | 'dark'
  onOpenGitSidebar: () => void
  nowIso: string
  timestampFormat: TimestampFormat
  workspaceRoot: string | undefined
  threadId: ThreadId
}

type AssistantMessageRow = Extract<TimelineRow, { kind: 'message' }>

type AssistantDisplayProps = Pick<
  SharedTimelineRowProps,
  | 'turnDiffSummaryByAssistantMessageId'
  | 'allDirectoriesExpandedByTurnId'
  | 'onToggleAllDirectories'
  | 'resolvedTheme'
  | 'onOpenGitSidebar'
  | 'threadId'
> & {
  row: AssistantMessageRow
}

type TimelineRowContentProps = SharedTimelineRowProps & { row: TimelineRow }

export function TimelineRowContent(props: TimelineRowContentProps) {
  const { row } = props
  return (
    <div
      className="pb-4"
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === 'message' ? row.message.id : undefined}
      data-message-role={row.kind === 'message' ? row.message.role : undefined}
    >
      {row.kind === 'work' && (
        <WorkTimelineRow
          row={row}
          expandedWorkGroups={props.expandedWorkGroups}
          onToggleWorkGroup={props.onToggleWorkGroup}
        />
      )}
      {row.kind === 'message' && row.message.role === 'user' && (
        <UserTimelineRow
          row={row}
          revertTurnCountByUserMessageId={props.revertTurnCountByUserMessageId}
          onRevertUserMessage={props.onRevertUserMessage}
          isRevertingCheckpoint={props.isRevertingCheckpoint}
          isWorking={props.isWorking}
          onImageExpand={props.onImageExpand}
          onTimelineImageLoad={props.onTimelineImageLoad}
          timestampFormat={props.timestampFormat}
        />
      )}
      {row.kind === 'message' && row.message.role === 'assistant' && (
        <AssistantTimelineRow
          row={row}
          completionSummary={props.completionSummary}
          markdownCwd={props.markdownCwd}
          turnDiffSummaryByAssistantMessageId={props.turnDiffSummaryByAssistantMessageId}
          allDirectoriesExpandedByTurnId={props.allDirectoriesExpandedByTurnId}
          onToggleAllDirectories={props.onToggleAllDirectories}
          resolvedTheme={props.resolvedTheme}
          onOpenGitSidebar={props.onOpenGitSidebar}
          threadId={props.threadId}
          nowIso={props.nowIso}
          timestampFormat={props.timestampFormat}
        />
      )}
      {row.kind === 'proposed-plan' && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={props.markdownCwd}
            workspaceRoot={props.workspaceRoot}
          />
        </div>
      )}
      {row.kind === 'working' && <WorkingTimelineRow row={row} nowIso={props.nowIso} />}
    </div>
  )
}

function WorkTimelineRow(props: {
  row: Extract<TimelineRow, { kind: 'work' }>
  expandedWorkGroups: Record<string, boolean>
  onToggleWorkGroup: (groupId: string) => void
}) {
  const groupId = props.row.id
  const groupedEntries = props.row.groupedEntries
  const isExpanded = props.expandedWorkGroups[groupId] ?? false
  const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES
  const visibleEntries =
    hasOverflow && !isExpanded
      ? groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : groupedEntries
  const hiddenCount = groupedEntries.length - visibleEntries.length
  const onlyToolEntries = groupedEntries.every(entry => entry.tone === 'tool')
  const showHeader = hasOverflow || !onlyToolEntries
  const groupLabel = onlyToolEntries ? 'Tool calls' : 'Work log'

  return (
    <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
      {showHeader && (
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {groupLabel} ({groupedEntries.length})
          </p>
          {hasOverflow && (
            <button
              type="button"
              className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
              onClick={() => props.onToggleWorkGroup(groupId)}
            >
              {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          )}
        </div>
      )}
      <div className="space-y-0.5">
        {visibleEntries.map(workEntry => (
          <SimpleWorkEntryRow key={`work-row:${workEntry.id}`} workEntry={workEntry} />
        ))}
      </div>
    </div>
  )
}

function UserTimelineRow(props: {
  row: Extract<TimelineRow, { kind: 'message' }>
  revertTurnCountByUserMessageId: Map<MessageId, number>
  onRevertUserMessage: (messageId: MessageId) => void
  isRevertingCheckpoint: boolean
  isWorking: boolean
  onImageExpand: (preview: ExpandedImagePreview) => void
  onTimelineImageLoad: () => void
  timestampFormat: TimestampFormat
}) {
  const userImages = props.row.message.attachments ?? []
  const displayedUserMessage = deriveDisplayedUserMessageState(props.row.message.text)
  const terminalContexts = displayedUserMessage.contexts
  const canRevertAgentWork = props.revertTurnCountByUserMessageId.has(props.row.message.id)

  return (
    <div className="flex justify-end">
      <div className="group relative max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
        {userImages.length > 0 && (
          <UserTimelineImageGrid
            userImages={userImages}
            onImageExpand={props.onImageExpand}
            onTimelineImageLoad={props.onTimelineImageLoad}
          />
        )}
        {(displayedUserMessage.visibleText.trim().length > 0 || terminalContexts.length > 0) && (
          <UserMessageBody
            text={displayedUserMessage.visibleText}
            terminalContexts={terminalContexts}
          />
        )}
        <div className="mt-1.5 flex items-center justify-end gap-2">
          <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
            {displayedUserMessage.copyText && (
              <MessageCopyButton text={displayedUserMessage.copyText} />
            )}
            {canRevertAgentWork && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={props.isRevertingCheckpoint || props.isWorking}
                onClick={() => props.onRevertUserMessage(props.row.message.id)}
                title="Revert to this message"
              >
                <Undo2Icon className="size-3" />
              </Button>
            )}
          </div>
          <p className="text-right text-[10px] text-muted-foreground/30">
            {formatTimestamp(props.row.message.createdAt, props.timestampFormat)}
          </p>
        </div>
      </div>
    </div>
  )
}

function UserTimelineImageGrid(props: {
  userImages: NonNullable<TimelineMessage['attachments']>
  onImageExpand: (preview: ExpandedImagePreview) => void
  onTimelineImageLoad: () => void
}) {
  return (
    <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
      {props.userImages.map(image => (
        <div
          key={image.id}
          className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
        >
          {image.previewUrl ? (
            <button
              type="button"
              className="h-full w-full cursor-zoom-in"
              aria-label={`Preview ${image.name}`}
              onClick={() => {
                const preview = buildExpandedImagePreview(props.userImages, image.id)
                if (!preview) return
                props.onImageExpand(preview)
              }}
            >
              <img
                src={image.previewUrl}
                alt={image.name}
                className="h-full max-h-[220px] w-full object-cover"
                onLoad={props.onTimelineImageLoad}
                onError={props.onTimelineImageLoad}
              />
            </button>
          ) : (
            <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
              {image.name}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function AssistantTimelineRow(
  props: AssistantDisplayProps & {
    completionSummary: string | null
    markdownCwd: string | undefined
    nowIso: string
    timestampFormat: TimestampFormat
  }
) {
  const promotedMessageText = stripPromotedTaskListFromMessage(props.row.message.text)
  const messageText = promotedMessageText || (props.row.message.streaming ? '' : '(empty response)')

  return (
    <>
      {props.row.showCompletionDivider && (
        <div className="my-3 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
            {props.completionSummary ? `Response • ${props.completionSummary}` : 'Response'}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className="min-w-0 px-1 py-0.5">
        <ChatMarkdown
          text={messageText}
          cwd={props.markdownCwd}
          isStreaming={Boolean(props.row.message.streaming)}
        />
        <AssistantTurnDiffSummary
          row={props.row}
          turnDiffSummaryByAssistantMessageId={props.turnDiffSummaryByAssistantMessageId}
          allDirectoriesExpandedByTurnId={props.allDirectoriesExpandedByTurnId}
          onToggleAllDirectories={props.onToggleAllDirectories}
          resolvedTheme={props.resolvedTheme}
          onOpenGitSidebar={props.onOpenGitSidebar}
          threadId={props.threadId}
        />
        <p className="mt-1.5 text-[10px] text-muted-foreground/30">
          {formatMessageMeta(
            props.row.message.createdAt,
            props.row.message.streaming
              ? formatElapsed(props.row.durationStart, props.nowIso)
              : formatElapsed(props.row.durationStart, props.row.message.completedAt),
            props.timestampFormat
          )}
        </p>
      </div>
    </>
  )
}

function AssistantTurnDiffSummary(props: AssistantDisplayProps) {
  const turnSummary = props.turnDiffSummaryByAssistantMessageId.get(props.row.message.id)
  if (!turnSummary) return null
  const checkpointFiles = turnSummary.files
  if (checkpointFiles.length === 0) return null
  const summaryStat = summarizeTurnDiffStats(checkpointFiles)
  const changedFileCountLabel = String(checkpointFiles.length)
  const allDirectoriesExpanded = props.allDirectoriesExpandedByTurnId[turnSummary.turnId] ?? true

  return (
    <div className="mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore
            onClick={() => props.onToggleAllDirectories(turnSummary.turnId)}
          >
            {allDirectoriesExpanded ? 'Collapse all' : 'Expand all'}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={props.onOpenGitSidebar}>
            View diff
          </Button>
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${turnSummary.turnId}`}
        threadId={props.threadId}
        turnId={turnSummary.turnId}
        checkpointTurnCount={turnSummary.checkpointTurnCount}
        files={checkpointFiles}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={props.resolvedTheme}
      />
    </div>
  )
}

function WorkingTimelineRow(props: {
  row: Extract<TimelineRow, { kind: 'working' }>
  nowIso: string
}) {
  return (
    <div className="py-0.5 pl-1.5">
      <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70">
        <span className="inline-flex items-center gap-[3px]">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
        </span>
        <span>
          {props.row.createdAt
            ? `Working for ${formatWorkingTimer(props.row.createdAt, props.nowIso) ?? '0s'}`
            : 'Working...'}
        </span>
      </div>
    </div>
  )
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso)
  const endedAtMs = Date.parse(endIso)
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`

  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat)
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`
}
