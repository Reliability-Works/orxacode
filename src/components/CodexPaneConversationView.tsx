import { memo, useMemo, type RefObject } from 'react'
import { Zap } from 'lucide-react'
import { VirtualizedTimeline } from './chat/VirtualizedTimeline'
import { UnifiedTimelineRowView } from './chat/UnifiedTimelineRow'
import {
  estimateUnifiedTimelineRowHeight,
  type UnifiedTimelineRenderRow,
} from './chat/unified-timeline-model'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import { projectCodexSessionPresentation } from '../lib/session-presentation'

type CodexConversationViewProps = {
  visibleMessages: CodexMessageItem[]
  trailingReasoning?: CodexMessageItem
  isStreaming: boolean
  scrollContainerRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  handleScroll: () => void
  showEmptyState: boolean
  onOpenFileReference?: (reference: string) => void
  sessionId?: string
}

export const CodexConversationView = memo(function CodexConversationView({
  visibleMessages,
  trailingReasoning,
  isStreaming,
  scrollContainerRef,
  messagesEndRef,
  handleScroll,
  showEmptyState,
  onOpenFileReference,
  sessionId,
}: CodexConversationViewProps) {
  const rows = useMemo<UnifiedTimelineRenderRow[]>(() => {
    const nextMessages = trailingReasoning
      ? [...visibleMessages, trailingReasoning]
      : visibleMessages
    return projectCodexSessionPresentation(nextMessages, isStreaming).rows
  }, [trailingReasoning, visibleMessages, isStreaming])

  return (
    <VirtualizedTimeline
      rows={rows}
      scrollRef={scrollContainerRef}
      className="messages-scroll codex-messages"
      ariaLabel="codex conversation"
      onScroll={handleScroll}
      estimateSize={estimateUnifiedTimelineRowHeight}
      virtualize={false}
      sessionId={sessionId}
      emptyState={
        showEmptyState ? (
          <div className="center-pane-rail">
            <div className="codex-empty">
              <Zap size={24} color="var(--text-muted)" />
              <span>Send a prompt to start coding with Codex.</span>
            </div>
          </div>
        ) : undefined
      }
      renderRow={row => (
        <div className="center-pane-rail center-pane-rail--row">
          <UnifiedTimelineRowView
            key={row.id}
            row={row}
            onOpenFileReference={onOpenFileReference}
          />
        </div>
      )}
      footer={
        <div className="center-pane-rail center-pane-rail--row">
          <div ref={messagesEndRef} />
        </div>
      }
    />
  )
})
