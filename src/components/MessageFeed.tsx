import { memo, useMemo, useRef, type CSSProperties } from 'react'
import type { SessionMessageBundle } from '@shared/ipc'
import { MessageCardFrame } from './chat/MessageCardFrame'
import { ThinkingRow } from './chat/ThinkingRow'
import { WorkingIndicator } from './chat/WorkingIndicator'
import { VirtualizedTimeline } from './chat/VirtualizedTimeline'
import { UnifiedTimelineRowView } from './chat/UnifiedTimelineRow'
import {
  estimateUnifiedTimelineRowHeight,
  type UnifiedTimelineRenderRow,
} from './chat/unified-timeline-model'
import { projectOpencodeSessionPresentation } from '../lib/opencode-session-presentation'
import type { UnifiedProjectedSessionPresentation } from '../lib/session-presentation'

type Props = {
  messages?: SessionMessageBundle[]
  presentation?: UnifiedProjectedSessionPresentation | null
  sessionNotices?: SessionFeedNotice[]
  showAssistantPlaceholder?: boolean
  optimisticUserPrompt?: {
    text: string
    timestamp: number
  } | null
  assistantLabel?: string
  workspaceDirectory?: string | null
  bottomClearance?: number
  onOpenFileReference?: (reference: string) => void
  sessionId?: string
}

type SessionFeedNotice = {
  id: string
  time: number
  label: string
  detail?: string
  tone?: 'info' | 'error'
}

type FooterProps = {
  showAssistantPlaceholder: boolean
  hasMessages: boolean
  hasVisibleContent: boolean
  optimisticUserPrompt: Props['optimisticUserPrompt']
  assistantLabel: string
  placeholderTimestamp?: number
  latestActivity?: { label: string } | null
  latestActivityContent?: string | null
}

const VIRTUALIZATION_ROW_THRESHOLD = 80

const AssistantPlaceholderFooter = memo(function AssistantPlaceholderFooter({
  optimisticUserPrompt,
  assistantLabel,
  placeholderTimestamp,
  latestActivity,
  latestActivityContent,
}: Omit<FooterProps, 'showAssistantPlaceholder' | 'hasMessages' | 'hasVisibleContent'>) {
  return (
    <>
      {optimisticUserPrompt ? (
        <div className="center-pane-rail center-pane-rail--row">
          <MessageCardFrame role="user" label="User" timestamp={optimisticUserPrompt.timestamp}>
            <div className="message-parts">
              <section className="message-part message-part--text">
                <div className="message-text">{optimisticUserPrompt.text}</div>
              </section>
            </div>
          </MessageCardFrame>
        </div>
      ) : null}
      <div className="center-pane-rail center-pane-rail--row">
        <MessageCardFrame role="assistant" label={assistantLabel} timestamp={placeholderTimestamp}>
          <div className="message-parts">
            <section className="message-part thinking-panel">
              <div className="message-thinking">
                <ThinkingRow
                  summary={latestActivity?.label ?? 'Thinking'}
                  content={latestActivityContent ?? ''}
                />
              </div>
            </section>
          </div>
        </MessageCardFrame>
      </div>
      <div className="center-pane-rail center-pane-rail--row">
        <WorkingIndicator active startTimestamp={placeholderTimestamp || undefined} />
      </div>
    </>
  )
})

function MessageFeedFooter(props: FooterProps) {
  const {
    showAssistantPlaceholder,
    hasMessages,
    hasVisibleContent,
    optimisticUserPrompt,
    assistantLabel,
    placeholderTimestamp,
    latestActivity,
    latestActivityContent,
  } = props

  if (!showAssistantPlaceholder || !(hasMessages || hasVisibleContent)) return undefined

  return (
    <AssistantPlaceholderFooter
      optimisticUserPrompt={optimisticUserPrompt}
      assistantLabel={assistantLabel}
      placeholderTimestamp={placeholderTimestamp}
      latestActivity={latestActivity}
      latestActivityContent={latestActivityContent}
    />
  )
}

// Sub-component: Merge notices into rendered rows
function useFeedRowsWithNotices(
  renderedRows: UnifiedTimelineRenderRow[],
  sessionNotices: SessionFeedNotice[]
): UnifiedTimelineRenderRow[] {
  return useMemo<UnifiedTimelineRenderRow[]>(() => {
    if (sessionNotices.length === 0) return renderedRows

    const noticeRows: Array<{ time: number; row: UnifiedTimelineRenderRow }> = sessionNotices.map(
      notice => ({
        time: notice.time,
        row: {
          id: `notice:${notice.id}`,
          kind: 'notice' as const,
          label: notice.label,
          detail: notice.detail,
          tone: notice.tone,
          timestamp: notice.time,
        },
      })
    )

    const result = [...renderedRows]
    for (const { time, row: noticeRow } of noticeRows) {
      let insertAt = result.length
      for (let i = result.length - 1; i >= 0; i--) {
        const row = result[i]!
        const rowTime = 'timestamp' in row ? ((row as { timestamp?: number }).timestamp ?? 0) : 0
        if (rowTime <= time) {
          insertAt = i + 1
          break
        }
        if (i === 0) insertAt = 0
      }
      result.splice(insertAt, 0, noticeRow)
    }
    return result
  }, [renderedRows, sessionNotices])
}

export const MessageFeed = memo(function MessageFeed({
  messages = [],
  presentation,
  sessionNotices = [],
  showAssistantPlaceholder = false,
  optimisticUserPrompt = null,
  assistantLabel = 'Orxa',
  workspaceDirectory,
  bottomClearance = 24,
  onOpenFileReference,
  sessionId,
}: Props) {
  const messageFeedRef = useRef<HTMLDivElement | null>(null)
  const messageFeedStyle = useMemo(
    () =>
      ({
        '--message-feed-bottom-clearance': `${Math.max(24, Math.round(bottomClearance))}px`,
      }) as CSSProperties,
    [bottomClearance]
  )
  const computedPresentation = useMemo(
    () =>
      presentation ??
      projectOpencodeSessionPresentation({ messages, assistantLabel, workspaceDirectory }),
    [assistantLabel, messages, presentation, workspaceDirectory]
  )
  const {
    rows: renderedRows,
    latestActivity,
    latestActivityContent,
    placeholderTimestamp,
  } = computedPresentation
  const feedRows = useFeedRowsWithNotices(renderedRows, sessionNotices)
  const shouldVirtualize = feedRows.length >= VIRTUALIZATION_ROW_THRESHOLD
  const hasVisibleContent = renderedRows.length > 0 || Boolean(optimisticUserPrompt)

  const footer = MessageFeedFooter({
    showAssistantPlaceholder,
    hasMessages: messages.length > 0,
    hasVisibleContent,
    optimisticUserPrompt,
    assistantLabel,
    placeholderTimestamp,
    latestActivity,
    latestActivityContent,
  })

  const emptyState =
    !hasVisibleContent &&
    !(showAssistantPlaceholder && (messages.length > 0 || Boolean(optimisticUserPrompt))) ? (
      <div className="center-pane-rail">
        <div className="messages-empty">No messages yet. Start by sending a prompt.</div>
      </div>
    ) : undefined

  return (
    <VirtualizedTimeline
      rows={feedRows}
      scrollRef={messageFeedRef}
      className="messages-scroll"
      onScroll={undefined}
      style={messageFeedStyle}
      virtualize={shouldVirtualize}
      sessionId={sessionId}
      emptyState={emptyState}
      estimateSize={estimateUnifiedTimelineRowHeight}
      renderRow={row => (
        <div className="center-pane-rail center-pane-rail--row">
          <UnifiedTimelineRowView
            key={row.id}
            row={row}
            onOpenFileReference={onOpenFileReference}
          />
        </div>
      )}
      footer={footer}
    />
  )
})
