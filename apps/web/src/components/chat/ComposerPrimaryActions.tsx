import { memo } from 'react'
import { ChevronDownIcon, ChevronLeftIcon } from 'lucide-react'
import { cn } from '~/lib/utils'
import { Button } from '../ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'

interface PendingActionState {
  questionIndex: number
  isLastQuestion: boolean
  canAdvance: boolean
  isResponding: boolean
  isComplete: boolean
}

interface ComposerPrimaryActionsProps {
  compact: boolean
  pendingAction: PendingActionState | null
  isRunning: boolean
  showPlanFollowUpPrompt: boolean
  promptHasText: boolean
  isSendBusy: boolean
  isConnecting: boolean
  isPreparingWorktree: boolean
  hasSendableContent: boolean
  onPreviousPendingQuestion: () => void
  onInterrupt: () => void
  onImplementPlanInNewThread: () => void
}

const formatPendingPrimaryActionLabel = (input: {
  compact: boolean
  isLastQuestion: boolean
  isResponding: boolean
}) => {
  if (input.isResponding) {
    return 'Submitting...'
  }
  if (input.compact) {
    return input.isLastQuestion ? 'Submit' : 'Next'
  }
  return input.isLastQuestion ? 'Submit answers' : 'Next question'
}

function renderPendingPrimaryActions(
  compact: boolean,
  pendingAction: PendingActionState,
  onPreviousPendingQuestion: () => void
) {
  const disableSubmit =
    pendingAction.isResponding ||
    (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)

  return (
    <div className={cn('flex items-center justify-end', compact ? 'gap-1.5' : 'gap-2')}>
      {pendingAction.questionIndex > 0 ? (
        compact ? (
          <Button
            size="icon-sm"
            variant="outline"
            className="rounded-full"
            onClick={onPreviousPendingQuestion}
            disabled={pendingAction.isResponding}
            aria-label="Previous question"
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={onPreviousPendingQuestion}
            disabled={pendingAction.isResponding}
          >
            Previous
          </Button>
        )
      ) : null}
      <Button
        type="submit"
        size="sm"
        className={cn('rounded-full', compact ? 'px-3' : 'px-4')}
        disabled={disableSubmit}
      >
        {formatPendingPrimaryActionLabel({
          compact,
          isLastQuestion: pendingAction.isLastQuestion,
          isResponding: pendingAction.isResponding,
        })}
      </Button>
    </div>
  )
}

function renderRunningPrimaryAction(input: { onInterrupt: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white transition-all duration-150 hover:bg-rose-500 hover:scale-105 sm:h-8 sm:w-8"
        onClick={input.onInterrupt}
        aria-label="Stop generation"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
      </button>
    </div>
  )
}

function renderPlanFollowUpActions(input: {
  compact: boolean
  isConnecting: boolean
  isSendBusy: boolean
  onImplementPlanInNewThread: () => void
  promptHasText: boolean
}) {
  if (input.promptHasText) {
    return (
      <Button
        type="submit"
        size="sm"
        className={cn('rounded-full', input.compact ? 'h-9 px-3 sm:h-8' : 'h-9 px-4 sm:h-8')}
        disabled={input.isSendBusy || input.isConnecting}
      >
        {input.isConnecting || input.isSendBusy ? 'Sending...' : 'Refine'}
      </Button>
    )
  }

  return (
    <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
      <Button
        type="submit"
        size="sm"
        className={cn('h-9 rounded-l-full rounded-r-none sm:h-8', input.compact ? 'px-3' : 'px-4')}
        disabled={input.isSendBusy || input.isConnecting}
      >
        {input.isConnecting || input.isSendBusy ? 'Sending...' : 'Implement'}
      </Button>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="default"
              className="h-9 rounded-l-none rounded-r-full border-l-white/12 px-2 sm:h-8"
              aria-label="Implementation actions"
              disabled={input.isSendBusy || input.isConnecting}
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end" side="top">
          <MenuItem
            disabled={input.isSendBusy || input.isConnecting}
            onClick={() => void input.onImplementPlanInNewThread()}
          >
            Implement in a new thread
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}

function sendButtonAriaLabel(input: {
  isConnecting: boolean
  isPreparingWorktree: boolean
  isSendBusy: boolean
}) {
  if (input.isConnecting) {
    return 'Connecting'
  }
  if (input.isPreparingWorktree) {
    return 'Preparing worktree'
  }
  if (input.isSendBusy) {
    return 'Sending'
  }
  return 'Send message'
}

function renderDefaultSendAction(input: {
  hasSendableContent: boolean
  isConnecting: boolean
  isPreparingWorktree: boolean
  isSendBusy: boolean
}) {
  return (
    <button
      type="submit"
      className="flex h-9 w-9 enabled:cursor-pointer items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-all duration-150 hover:bg-primary hover:scale-105 disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100 sm:h-8 sm:w-8"
      disabled={input.isSendBusy || input.isConnecting || !input.hasSendableContent}
      aria-label={sendButtonAriaLabel(input)}
    >
      {input.isConnecting || input.isSendBusy ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="animate-spin"
          aria-hidden="true"
        >
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="20 12"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  isConnecting,
  isPreparingWorktree,
  hasSendableContent,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  if (pendingAction) {
    return renderPendingPrimaryActions(compact, pendingAction, onPreviousPendingQuestion)
  }

  if (isRunning) {
    return renderRunningPrimaryAction({ onInterrupt })
  }

  if (showPlanFollowUpPrompt) {
    return renderPlanFollowUpActions({
      compact,
      isConnecting,
      isSendBusy,
      onImplementPlanInNewThread,
      promptHasText,
    })
  }

  return renderDefaultSendAction({
    hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
  })
})
