/**
 * Composer footer panel — provider picker + traits + primary actions row.
 *
 * Extracted from ChatView.tsx. Split into leading/actions sub-components to
 * satisfy max-lines-per-function.
 */

import React from 'react'
import { cn } from '~/lib/utils'
import { ProviderModelPicker } from './ProviderModelPicker'
import { CompactComposerControlsMenu } from './CompactComposerControlsMenu'
import { ComposerPrimaryActions } from './ComposerPrimaryActions'
import { ComposerPendingApprovalActions } from './ComposerPendingApprovalActions'
import { ContextWindowMeter } from './ContextWindowMeter'
import { ChatViewComposerControlsExpanded } from './ChatViewComposerControlsExpanded'
import { useChatViewCtx } from './ChatViewContext'

function ComposerFooterLeading({
  providerTraitsMenuContent,
  providerTraitsPicker,
}: {
  providerTraitsMenuContent: React.ReactNode
  providerTraitsPicker: React.ReactNode
}) {
  const c = useChatViewCtx()
  const { td, p } = c
  const { composerFooterLeadingRef } = c.scroll.refs
  const { isComposerFooterCompact } = c.scroll
  const {
    runtimeMode,
    interactionMode,
    lockedProvider,
    selectedProvider,
    selectedModelForPickerWithCustomFallback,
    providerStatuses,
    modelOptionsByProvider,
    composerProviderState,
  } = td
  const planSidebarOpen = c.ls.planSidebarOpen
  return (
    <div
      ref={composerFooterLeadingRef}
      className={cn(
        'flex min-w-0 flex-1 items-center',
        isComposerFooterCompact
          ? 'gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:min-w-max sm:overflow-visible'
      )}
    >
      <ProviderModelPicker
        compact={isComposerFooterCompact}
        provider={selectedProvider}
        model={selectedModelForPickerWithCustomFallback}
        lockedProvider={lockedProvider}
        providers={providerStatuses}
        modelOptionsByProvider={modelOptionsByProvider}
        {...(composerProviderState.modelPickerIconClassName
          ? { activeProviderIconClassName: composerProviderState.modelPickerIconClassName }
          : {})}
        onProviderModelChange={c.onProviderModelSelect}
      />
      {isComposerFooterCompact ? (
        <CompactComposerControlsMenu
          activePlan={Boolean(p.activePlan || p.sidebarProposedPlan || planSidebarOpen)}
          interactionMode={interactionMode}
          planSidebarOpen={planSidebarOpen}
          runtimeMode={runtimeMode}
          traitsMenuContent={providerTraitsMenuContent}
          onToggleInteractionMode={c.toggleInteractionMode}
          onTogglePlanSidebar={c.togglePlanSidebar}
          onToggleRuntimeMode={c.toggleRuntimeMode}
        />
      ) : (
        <ChatViewComposerControlsExpanded providerTraitsPicker={providerTraitsPicker} />
      )}
    </div>
  )
}

function ComposerFooterActions() {
  const c = useChatViewCtx()
  const { td, ad, p, store } = c
  const { composerFooterActionsRef } = c.scroll.refs
  const { isComposerPrimaryActionsCompact } = c.scroll
  return (
    <div
      ref={composerFooterActionsRef}
      data-chat-composer-actions="right"
      data-chat-composer-primary-actions-compact={
        isComposerPrimaryActionsCompact ? 'true' : 'false'
      }
      className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
    >
      {ad.activeContextWindow ? <ContextWindowMeter usage={ad.activeContextWindow} /> : null}
      {c.ld.isPreparingWorktree ? (
        <span className="text-muted-foreground/70 text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={isComposerPrimaryActionsCompact}
        pendingAction={
          ad.activePendingProgress
            ? {
                questionIndex: ad.activePendingProgress.questionIndex,
                isLastQuestion: ad.activePendingProgress.isLastQuestion,
                canAdvance: ad.activePendingProgress.canAdvance,
                isResponding: ad.activePendingIsResponding,
                isComplete: Boolean(ad.activePendingResolvedAnswers),
              }
            : null
        }
        isRunning={td.phase === 'running'}
        showPlanFollowUpPrompt={ad.pendingUserInputs.length === 0 && p.showPlanFollowUpPrompt}
        promptHasText={(store.prompt ?? '').trim().length > 0}
        isSendBusy={c.ld.isSendBusy}
        isConnecting={false}
        isPreparingWorktree={c.ld.isPreparingWorktree}
        hasSendableContent={store.composerSendState.hasSendableContent}
        onPreviousPendingQuestion={c.onPreviousActivePendingUserInputQuestion}
        onInterrupt={() => void c.onInterrupt()}
        onImplementPlanInNewThread={() => void c.onImplementPlanInNewThread()}
      />
    </div>
  )
}

export function ChatViewComposerFooterPanel({
  providerTraitsMenuContent,
  providerTraitsPicker,
}: {
  providerTraitsMenuContent: React.ReactNode
  providerTraitsPicker: React.ReactNode
}) {
  const c = useChatViewCtx()
  const { composerFooterRef } = c.scroll.refs
  const { isComposerFooterCompact } = c.scroll
  const { activePendingApproval } = c.ad
  const { respondingRequestIds } = c.ls
  if (activePendingApproval) {
    return (
      <div className="flex items-center justify-end gap-2 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
        <ComposerPendingApprovalActions
          requestId={activePendingApproval.requestId}
          isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
          onRespondToApproval={c.onRespondToApproval}
        />
      </div>
    )
  }
  return (
    <div
      ref={composerFooterRef}
      data-chat-composer-footer="true"
      data-chat-composer-footer-compact={isComposerFooterCompact ? 'true' : 'false'}
      className={cn(
        'flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-hidden px-2.5 pb-2.5 sm:px-3 sm:pb-3',
        isComposerFooterCompact ? 'gap-1.5' : 'gap-2 sm:gap-0'
      )}
    >
      <ComposerFooterLeading
        providerTraitsMenuContent={providerTraitsMenuContent}
        providerTraitsPicker={providerTraitsPicker}
      />
      <ComposerFooterActions />
    </div>
  )
}
