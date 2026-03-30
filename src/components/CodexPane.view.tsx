import type { RefObject } from 'react'
import { Zap } from 'lucide-react'
import type { CodexMessageItem } from '../hooks/codex-session-types'
import type { CodexUsageAlert } from './CodexPane.helpers'
import { CodexPaneComposerSurface } from './CodexPaneComposerSurface'
import { CodexConversationView } from './CodexPaneConversationView'
import type { CodexPaneComposerPanelProps } from './CodexPaneComposerPanel'

export type CodexPaneViewProps = {
  sessionId: string
  isAvailable: boolean
  connectionStatus: string
  thread: { id: string } | null
  messages: CodexMessageItem[]
  isStreaming: boolean
  activePlanItem: { id: string } | null
  dismissedPlanIds: Set<string>
  planItems: Array<{ status: string }>
  pendingApproval: unknown
  pendingUserInput: unknown
  planReady: boolean
  scrollContainerRef: RefObject<HTMLDivElement | null>
  messagesEndRef: RefObject<HTMLDivElement | null>
  handleScroll: () => void
  onOpenFileReference?: (reference: string) => void
  visibleMessages: CodexMessageItem[]
  trailingReasoning?: CodexMessageItem
  composerAlert: CodexUsageAlert | null
  questionDockProps:
    | {
        questions: Array<{ id: string; text: string; options?: Array<{ value?: string; label: string }> }>
        onSubmit: (answers: Record<string, string | string[]>) => void
        onReject: () => void
      }
    | null
  pendingPlanProps:
    | {
        onAccept: () => void
        onSubmitChanges: (changes: string) => void
        onDismiss: () => void
      }
    | null
  composerProps: CodexPaneComposerPanelProps
}

export function CodexPaneView({
  sessionId,
  isAvailable,
  connectionStatus,
  thread,
  isStreaming,
  scrollContainerRef,
  messagesEndRef,
  handleScroll,
  onOpenFileReference,
  visibleMessages,
  trailingReasoning,
  composerAlert,
  questionDockProps,
  pendingPlanProps,
  composerProps,
}: CodexPaneViewProps) {
  if (!isAvailable) {
    return (
      <div className="codex-pane">
        <div className="codex-unavailable">
          <Zap size={32} color="var(--text-muted)" />
          <span>Codex is not available. Make sure the codex CLI is installed.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="codex-pane">
      <CodexConversationView
        visibleMessages={visibleMessages}
        trailingReasoning={trailingReasoning}
        isStreaming={isStreaming}
        scrollContainerRef={scrollContainerRef}
        messagesEndRef={messagesEndRef}
        handleScroll={handleScroll}
        showEmptyState={visibleMessages.length === 0 && connectionStatus === 'connected' && thread !== null}
        onOpenFileReference={onOpenFileReference}
        sessionId={sessionId}
      />
      <CodexPaneComposerSurface
        codexUsageAlert={composerAlert}
        questionDockProps={questionDockProps}
        pendingPlanProps={pendingPlanProps}
        composerProps={composerProps}
      />
    </div>
  )
}
