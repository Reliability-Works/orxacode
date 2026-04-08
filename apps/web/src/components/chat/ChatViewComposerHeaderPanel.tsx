/**
 * Composer header panel — approval / user-input / plan follow-up banner.
 *
 * Extracted from ChatView.tsx.
 */

import { ComposerPendingApprovalPanel } from './ComposerPendingApprovalPanel'
import { ComposerPendingUserInputPanel } from './ComposerPendingUserInputPanel'
import { ComposerPlanFollowUpBanner } from './ComposerPlanFollowUpBanner'
import { proposedPlanTitle } from '../../proposedPlan'
import { useChatViewCtx } from './ChatViewContext'

export function ChatViewComposerHeaderPanel() {
  const c = useChatViewCtx()
  const { ad, p } = c
  const { activePendingApproval, pendingUserInputs } = ad
  const { activeProposedPlan, showPlanFollowUpPrompt } = p
  if (activePendingApproval) {
    return (
      <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
        <ComposerPendingApprovalPanel
          approval={activePendingApproval}
          pendingCount={ad.pendingApprovals.length}
        />
      </div>
    )
  }
  if (pendingUserInputs.length > 0) {
    return (
      <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
        <ComposerPendingUserInputPanel
          pendingUserInputs={pendingUserInputs}
          respondingRequestIds={c.ls.respondingRequestIds}
          answers={ad.activePendingDraftAnswers}
          questionIndex={ad.activePendingQuestionIndex}
          onSelectOption={c.onSelectActivePendingUserInputOption}
          onAdvance={c.onAdvanceActivePendingUserInput}
        />
      </div>
    )
  }
  if (showPlanFollowUpPrompt && activeProposedPlan) {
    return (
      <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
        <ComposerPlanFollowUpBanner
          key={activeProposedPlan.id}
          planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
        />
      </div>
    )
  }
  return null
}
