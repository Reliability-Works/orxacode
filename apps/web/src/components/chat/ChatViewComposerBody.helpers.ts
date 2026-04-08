/**
 * Pure helpers for ChatViewComposerBody.
 */

export function deriveComposerPlaceholder(
  isApproval: boolean,
  approvalDetail: string | undefined,
  hasPendingProgress: boolean,
  showPlanFollowUp: boolean,
  hasPlan: boolean,
  phase: string
): string {
  if (isApproval) return approvalDetail ?? 'Resolve this approval request to continue'
  if (hasPendingProgress)
    return 'Type your own answer, or leave this blank to use the selected option'
  if (showPlanFollowUp && hasPlan)
    return 'Add feedback to refine the plan, or leave this blank to implement it'
  if (phase === 'disconnected') return 'Ask for follow-up changes or attach images'
  return 'Ask anything, @tag files/folders, or use / to show available commands'
}
