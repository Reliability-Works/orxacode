/**
 * Messages scroll pane + scroll-to-bottom pill.
 *
 * Extracted from ChatView.tsx.
 */

import { MessagesTimeline } from './MessagesTimeline'
import { ChatViewScrollPill } from './ChatViewScrollPill'
import { useChatViewCtx } from './ChatViewContext'

export function ChatViewMessagesPane() {
  const c = useChatViewCtx()
  const { td, ad, store, gitCwd } = c
  const {
    setMessagesScrollContainerRef,
    onMessagesScroll,
    onMessagesClickCapture,
    onMessagesWheel,
    onMessagesPointerDown,
    onMessagesPointerUp,
    onMessagesPointerCancel,
    onMessagesTouchStart,
    onMessagesTouchMove,
    onMessagesTouchEnd,
    messagesScrollElement,
    showScrollToBottom,
    scrollMessagesToBottom,
  } = c.scroll
  const { nowTick, expandedWorkGroups, isRevertingCheckpoint } = c.ls
  if (!td.activeThread) return null
  const { resolvedTheme, settings } = store
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={setMessagesScrollContainerRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 sm:py-4"
        onScroll={onMessagesScroll}
        onClickCapture={onMessagesClickCapture}
        onWheel={onMessagesWheel}
        onPointerDown={onMessagesPointerDown}
        onPointerUp={onMessagesPointerUp}
        onPointerCancel={onMessagesPointerCancel}
        onTouchStart={onMessagesTouchStart}
        onTouchMove={onMessagesTouchMove}
        onTouchEnd={onMessagesTouchEnd}
        onTouchCancel={onMessagesTouchEnd}
      >
        <MessagesTimeline
          key={td.activeThread.id}
          threadId={td.activeThread.id}
          hasMessages={ad.timelineEntries.length > 0}
          isWorking={ad.isWorking}
          activeTurnInProgress={ad.isWorking || !ad.latestTurnSettled}
          activeTurnStartedAt={ad.activeWorkStartedAt}
          scrollContainer={messagesScrollElement}
          timelineEntries={ad.timelineEntries}
          completionDividerBeforeEntryId={ad.completionDividerBeforeEntryId}
          completionSummary={ad.completionSummary}
          turnDiffSummaryByAssistantMessageId={ad.turnDiffSummaryByAssistantMessageId}
          nowIso={new Date(nowTick).toISOString()}
          expandedWorkGroups={expandedWorkGroups}
          onToggleWorkGroup={c.onToggleWorkGroup}
          onOpenGitSidebar={c.openGitSidebar}
          revertTurnCountByUserMessageId={ad.revertTurnCountByUserMessageId}
          onRevertUserMessage={c.onRevertUserMessage}
          isRevertingCheckpoint={isRevertingCheckpoint}
          onImageExpand={c.onExpandTimelineImage}
          markdownCwd={gitCwd ?? undefined}
          resolvedTheme={resolvedTheme}
          timestampFormat={settings.timestampFormat}
          workspaceRoot={td.activeProject?.cwd ?? undefined}
        />
      </div>
      {showScrollToBottom ? (
        <ChatViewScrollPill onScrollToBottom={() => scrollMessagesToBottom('smooth')} />
      ) : null}
    </div>
  )
}
