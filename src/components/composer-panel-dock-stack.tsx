import { memo, useLayoutEffect, useRef, type ReactNode } from 'react'
import { BackgroundAgentsPanel } from './chat/BackgroundAgentsPanel'
import { FollowupDock } from './chat/FollowupDock'
import { GuardrailDock } from './chat/GuardrailDock'
import { PermissionDock } from './chat/PermissionDock'
import { QueuedMessagesDock } from './chat/QueuedMessagesDock'
import { ReviewChangesDock, type SessionChangeTarget } from './chat/ReviewChangesDock'
import { TodoDock } from './chat/TodoDock'
import type { UnifiedBackgroundAgentSummary } from '../lib/session-presentation'
import type { SessionGuardrailPrompt } from '../lib/session-controls'

export type ComposerDockStackProps = {
  queuedMessages?: { id: string }[]
  sendingQueuedId?: string
  queuedActionKind?: 'send' | 'steer'
  onPrimaryQueuedAction?: (id: string) => void
  onEditQueued?: (id: string) => void
  onRemoveQueued?: (id: string) => void
  backgroundAgents?: UnifiedBackgroundAgentSummary[]
  selectedBackgroundAgentId?: string | null
  onOpenBackgroundAgent?: (id: string) => void
  onCloseBackgroundAgent?: () => void
  onArchiveBackgroundAgent?: (agent: UnifiedBackgroundAgentSummary) => void
  backgroundAgentDetail?: ReactNode
  backgroundAgentTaskText?: string | null
  backgroundAgentDetailLoading?: boolean
  backgroundAgentDetailError?: string | null
  backgroundAgentTaggingHint?: string | null
  todoItems?: { id: string }[]
  todoOpen?: boolean
  onTodoToggle?: () => void
  sessionChangeTargets?: SessionChangeTarget[]
  onOpenReviewChange?: (path: string) => void
  onRevertSessionChange?: (targetId: string) => void | Promise<void>
  guardrailPrompt?: SessionGuardrailPrompt | null
  onDismissGuardrailWarning?: () => void
  onContinueGuardrailOnce?: () => void
  onDisableGuardrailsForSession?: () => void
  onOpenSettings?: () => void
  pendingPermission?: {
    description: string
    filePattern?: string
    command?: string[]
    onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => void
  } | null
  followupSuggestions?: string[]
  onFollowupSelect?: (text: string) => void
  onFollowupDismiss?: () => void
  onDockHeightChange?: (height: number) => void
}

function renderQueuedMessagesSection(props: ComposerDockStackProps) {
  const {
    queuedMessages,
    sendingQueuedId,
    queuedActionKind,
    onPrimaryQueuedAction,
    onEditQueued,
    onRemoveQueued,
  } = props
  if (!queuedMessages || queuedMessages.length === 0) {
    return null
  }
  if (!onPrimaryQueuedAction || !onEditQueued || !onRemoveQueued) {
    return null
  }
  return (
    <QueuedMessagesDock
      messages={queuedMessages as never}
      sendingId={sendingQueuedId}
      actionKind={queuedActionKind}
      onPrimaryAction={onPrimaryQueuedAction}
      onEdit={onEditQueued}
      onRemove={onRemoveQueued}
    />
  )
}

function renderBackgroundAgentsSection(props: ComposerDockStackProps) {
  const {
    backgroundAgents,
    selectedBackgroundAgentId,
    onOpenBackgroundAgent,
    onCloseBackgroundAgent,
    onArchiveBackgroundAgent,
    backgroundAgentDetail,
    backgroundAgentTaskText,
    backgroundAgentDetailLoading,
    backgroundAgentDetailError,
    backgroundAgentTaggingHint,
  } = props
  if (!backgroundAgents || backgroundAgents.length === 0) {
    return null
  }
  if (!onOpenBackgroundAgent || !onCloseBackgroundAgent) {
    return null
  }
  return (
    <BackgroundAgentsPanel
      agents={backgroundAgents}
      selectedAgentId={selectedBackgroundAgentId}
      onOpenAgent={onOpenBackgroundAgent}
      onBack={onCloseBackgroundAgent}
      onArchiveAgent={onArchiveBackgroundAgent}
      detailBody={backgroundAgentDetail}
      detailTaskText={backgroundAgentTaskText}
      detailLoading={backgroundAgentDetailLoading}
      detailError={backgroundAgentDetailError}
      taggingHint={backgroundAgentTaggingHint}
    />
  )
}

function renderTaskSection(props: ComposerDockStackProps) {
  const {
    onTodoToggle,
    sessionChangeTargets,
    todoOpen,
    todoItems,
    onOpenReviewChange,
    onRevertSessionChange,
  } = props
  if (!onTodoToggle) {
    return null
  }
  if (sessionChangeTargets && sessionChangeTargets.length > 0) {
    return (
      <ReviewChangesDock
        targets={sessionChangeTargets as never}
        open={todoOpen ?? false}
        onToggle={onTodoToggle}
        onOpenPath={onOpenReviewChange}
        onRevertTarget={onRevertSessionChange}
      />
    )
  }
  if (todoItems && todoItems.length > 0) {
    return <TodoDock items={todoItems as never} open={todoOpen ?? false} onToggle={onTodoToggle} />
  }
  return null
}

export const ComposerDockStack = memo(function ComposerDockStack(props: ComposerDockStackProps) {
  const dockRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const { onDockHeightChange } = props
    if (!onDockHeightChange) return
    const el = dockRef.current
    if (!el) return
    const report = () => onDockHeightChange(Math.round(el.getBoundingClientRect().height))
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [props])

  return (
    <div ref={dockRef} className="composer-docks-float">
      {renderQueuedMessagesSection(props)}
      {renderBackgroundAgentsSection(props)}
      {renderTaskSection(props)}
      {props.guardrailPrompt ? (
        <GuardrailDock
          prompt={props.guardrailPrompt}
          onDismissWarning={props.onDismissGuardrailWarning}
          onContinueOnce={props.onContinueGuardrailOnce}
          onDisableForSession={props.onDisableGuardrailsForSession}
          onOpenSettings={props.onOpenSettings}
        />
      ) : null}
      {props.pendingPermission ? (
        <PermissionDock
          description={props.pendingPermission.description}
          filePattern={props.pendingPermission.filePattern}
          command={props.pendingPermission.command}
          onDecide={props.pendingPermission.onDecide}
        />
      ) : null}
      {props.followupSuggestions && props.followupSuggestions.length > 0 && props.onFollowupSelect ? (
        <FollowupDock
          suggestions={props.followupSuggestions}
          onSelect={props.onFollowupSelect}
          onDismiss={props.onFollowupDismiss}
        />
      ) : null}
    </div>
  )
})
